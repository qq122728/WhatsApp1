use std::{collections::HashMap, time::Instant};

use chrono::Utc;
use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position,
    Rect, Size, WebviewUrl,
};
use tokio::sync::Mutex;

use crate::{
    error::{AppError, AppResult, ErrorCode},
    translation::TranslationConfig,
};

fn panel_label(account_id: &str) -> String {
    format!("wa-{account_id}")
}

fn parked_panel_bounds() -> Rect {
    Rect {
        position: Position::Logical(LogicalPosition::new(-10_000.0, -10_000.0)),
        size: Size::Logical(LogicalSize::new(720.0, 640.0)),
    }
}

fn park_panel(webview: &tauri::Webview) -> AppResult<()> {
    webview
        .set_bounds(parked_panel_bounds())
        .map_err(|error| AppError::new(ErrorCode::WaPanelFailed, error.to_string()))?;
    webview
        .show()
        .map_err(|error| AppError::new(ErrorCode::WaPanelFailed, error.to_string()))
}

fn host_webview(app: &AppHandle) -> AppResult<tauri::Webview> {
    app.get_webview("main")
        .or_else(|| {
            app.webviews()
                .into_values()
                .find(|webview| !webview.label().starts_with("wa-"))
        })
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::WaPanelFailed,
                "Client host webview was not found.",
            )
        })
}

fn profile_dir(app: &AppHandle, account_id: &str) -> AppResult<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("panels").join("whatsapp").join(account_id))
        .map_err(|_| {
            AppError::new(
                ErrorCode::DiskFull,
                "App data directory could not be resolved.",
            )
        })
}

fn legacy_profile_dir(app: &AppHandle, account_id: &str) -> AppResult<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("profiles").join("whatsapp").join(account_id))
        .map_err(|_| {
            AppError::new(
                ErrorCode::DiskFull,
                "App data directory could not be resolved.",
            )
        })
}

async fn remove_profile_dir(path: &std::path::Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }

    let mut last_error = None;
    for attempt in 0..8 {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                if attempt < 7 {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
            }
        }
    }

    Err(AppError::new(
        ErrorCode::WaPanelFailed,
        format!(
            "Could not clear the WhatsApp profile: {}",
            last_error
                .map(|error| error.to_string())
                .unwrap_or_else(|| "unknown filesystem error".to_string())
        ),
    ))
}

fn init_script(account_id: &str, panel_token: &str) -> String {
    format!(
        r#"
(function() {{
    var MC_ACCOUNT_ID = '{account_id}';
    var MC_PANEL_TOKEN = '{panel_token}';
    try {{
        if (typeof window.__MC_TRANSLATION_OVERLAY_DISPOSE__ === 'function') {{
            window.__MC_TRANSLATION_OVERLAY_DISPOSE__();
        }}
    }} catch (_disposeError) {{}}
    var __mcTranslationListeners = [];
    var __mcTranslationIntervals = [];

    function mcAddListener(target, type, listener, options) {{
        target.addEventListener(type, listener, options);
        __mcTranslationListeners.push([target, type, listener, options]);
    }}

    function mcSetInterval(listener, delay) {{
        var intervalId = window.setInterval(listener, delay);
        __mcTranslationIntervals.push(intervalId);
        return intervalId;
    }}

    window.__MC_TRANSLATION_OVERLAY_DISPOSE__ = function() {{
        __mcTranslationListeners.forEach(function(entry) {{
            try {{
                entry[0].removeEventListener(entry[1], entry[2], entry[3]);
            }} catch (_removeError) {{}}
        }});
        __mcTranslationListeners = [];
        __mcTranslationIntervals.forEach(function(intervalId) {{
            try {{
                window.clearInterval(intervalId);
            }} catch (_clearError) {{}}
        }});
        __mcTranslationIntervals = [];
        try {{
            window.clearTimeout(previewTimer);
        }} catch (_timerError) {{}}
        try {{
            window.clearTimeout(incomingScanTimer);
        }} catch (_incomingTimerError) {{}}
        try {{
            if (previewEl) previewEl.remove();
        }} catch (_previewError) {{}}
        try {{
            window.__MC_TRANSLATION_CONFIG_UPDATED__ = null;
        }} catch (_configCallbackError) {{}}
    }};

    /* ---------- Auth state reporting ---------- */
    var _last = '';
    function _mcParseUnreadText(text) {{
        var raw = String(text || '').trim();
        if (!raw) return 0;
        if (/^\d+$/.test(raw)) return parseInt(raw, 10) || 0;
        var plus = raw.match(/(\d+)\s*\+/);
        if (plus) return parseInt(plus[1], 10) || 0;
        var number = raw.match(/\d+/);
        return number ? (parseInt(number[0], 10) || 0) : 0;
    }}
    function _mcLooksUnreadBadge(node) {{
        var aria = String(node.getAttribute('aria-label') || '');
        var testId = String(node.getAttribute('data-testid') || '');
        if (/unread|未读|未讀/i.test(aria) || /unread/i.test(testId)) return true;
        var text = String(node.innerText || node.textContent || '').trim();
        if (!/^\d+\+?$/.test(text)) return false;
        var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
        if (!rect || rect.width > 44 || rect.height > 30) return false;
        var style = window.getComputedStyle ? window.getComputedStyle(node) : null;
        var background = style ? String(style.backgroundColor || '') : '';
        return !!background && !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(background);
    }}
    function _mcUnreadCount() {{
        var total = 0;
        var seen = [];
        function add(node) {{
            if (!node || seen.indexOf(node) >= 0) return;
            seen.push(node);
            total += _mcParseUnreadText(node.innerText || node.textContent || node.getAttribute('aria-label') || '');
        }}
        Array.prototype.forEach.call(document.querySelectorAll(
            '#pane-side [aria-label*="unread"],' +
            '#pane-side [aria-label*="未读"],' +
            '#pane-side [aria-label*="未讀"],' +
            '#pane-side span[aria-label*="unread"],' +
            '#pane-side span[aria-label*="未读"],' +
            '#pane-side span[aria-label*="未讀"],' +
            '#pane-side [data-testid*="unread"],' +
            '#pane-side span[dir="auto"]'
        ), function(node) {{
            if (_mcLooksUnreadBadge(node)) {{
                add(node);
            }}
        }});
        return Math.max(0, Math.min(total, 999));
    }}
    function _mcVisibleText() {{
        var text = '';
        try {{
            text = (document.body && (document.body.innerText || document.body.textContent)) || '';
        }} catch (_textError) {{}}
        return String(text || '').replace(/\s+/g, ' ').slice(0, 6000);
    }}
    function _mcDetectAccountIssue(auth, qr) {{
        var text = _mcVisibleText();
        var bannedPattern = /(can no longer use whatsapp|can't use whatsapp|cannot use whatsapp|not allowed to use whatsapp|banned from using whatsapp|temporarily banned|account has been banned|this account is not allowed|unable to use whatsapp|此.{{0,8}}(账号|帳號|帐号|電話號碼|电话号码).{{0,20}}(无法|不能|無法|不可).{{0,12}}whatsapp|被.{{0,10}}(禁止|封禁|停用|限制).{{0,12}}whatsapp|账号.{{0,8}}(封禁|停用|受限)|帳號.{{0,8}}(封禁|停用|受限))/i;
        if (bannedPattern.test(text)) {{
            return {{
                state: 'error',
                reasonCode: 'PLATFORM_REJECTED',
                summary: '疑似封号/受限：WhatsApp 页面提示账号无法使用或被限制。'
            }};
        }}
        var loginPattern = /(scan the qr code|link with phone number|log in with phone number|use whatsapp on your computer|扫描.*二维码|扫码登录|使用手机.*扫描|关联设备|連結裝置|連接裝置)/i;
        if (!auth && (qr || loginPattern.test(text))) {{
            return {{
                state: 'awaiting_qr',
                reasonCode: 'AUTH_EXPIRED',
                summary: '需要扫码或手机确认登录。'
            }};
        }}
        return {{
            state: auth ? 'authenticated' : qr ? 'awaiting_qr' : 'starting',
            reasonCode: '',
            summary: ''
        }};
    }}
    function _mcCheck() {{
        var text = _mcVisibleText();
        var auth = !!(
            document.querySelector('#pane-side') ||
            document.querySelector('[data-testid="chat-list"]') ||
            document.querySelector('[aria-label*="Chat list"]') ||
            /(search or start a new chat|search or start new chat|搜索或开始新聊天|搜索或開始新聊天)/i.test(text) ||
            document.querySelector('[aria-label*="聊天列表"]')
        );
        var qr = !!(
            document.querySelector('canvas[aria-label*="QR"]') ||
            document.querySelector('[data-testid="qrcode"]') ||
            document.querySelector('canvas')
        );
        var issue = _mcDetectAccountIssue(auth, qr);
        var state = issue.state;
        var unreadCount = auth ? _mcUnreadCount() : 0;
        var snapshot = state + ':' + unreadCount + ':' + (issue.reasonCode || '') + ':' + (issue.summary || '');
        if (snapshot !== _last) {{
            _last = snapshot;
            try {{
                var payload = {{
                    accountId: MC_ACCOUNT_ID,
                    token: MC_PANEL_TOKEN,
                    state: state,
                    unreadCount: unreadCount
                }};
                if (issue.reasonCode) payload.reasonCode = issue.reasonCode;
                if (issue.summary) payload.summary = issue.summary;
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                    event: 'mc://panel-state',
                    payload: payload
                }});
            }} catch (_e) {{}}
        }}
    }}
    mcSetInterval(_mcCheck, 2000);

    /* ---------- Translation overlay ---------- */
    window.__MC_TRANSLATION_CONFIG__ = window.__MC_TRANSLATION_CONFIG__ || {{
        translationChannel: 'GPT-4O-MINI',
        translationStyle: '自然口语',
        regionalTone: '通用自然',
        targetLanguage: '英语（美国）',
        sourceLanguage: '中文（简体）',
        sendTranslation: false,
        receiveTranslation: false,
        blockChinese: true,
        fontSize: 16,
        fontColor: '#18A058',
        translationCacheRetentionDays: 45,
        translationCachePerAccountLimit: 260,
        incomingAutoTranslate: true,
        translationCacheClearAt: 0
    }};
    var STYLE_ID = '__mc_translation_style';
    function injectStyle() {{
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.__mc-translation {{',
            '  margin-top: 4px;',
            '  padding: 6px 8px;',
            '  border-top: 1px dashed rgba(24, 160, 88, 0.28);',
            '  color: #197451;',
            '  font-size: 12px;',
            '  line-height: 1.5;',
            '  font-family: inherit;',
            '  display: flex;',
            '  align-items: flex-start;',
            '  gap: 4px;',
            '}}',
            '.__mc-translation::before {{',
            '  content: "译";',
            '  display: inline-block;',
            '  flex-shrink: 0;',
            '  width: 16px;',
            '  height: 16px;',
            '  border-radius: 4px;',
            '  background: #18a058;',
            '  color: white;',
            '  text-align: center;',
            '  font-size: 10px;',
            '  line-height: 16px;',
            '  font-weight: 700;',
            '  margin-right: 4px;',
            '}}',
            '.__mc-incoming-translation {{',
              '  box-sizing: border-box;',
              '  max-width: min(520px, 92%);',
              '  margin: 4px 0 1px 54px;',
            '  padding: 6px 8px;',
            '  border-left: 3px solid rgba(24, 160, 88, 0.48);',
            '  border-radius: 7px;',
            '  color: #16754f;',
            '  background: rgba(235, 250, 242, 0.92);',
            '  font-family: inherit;',
            '  font-size: 12px;',
            '  line-height: 1.45;',
            '  white-space: pre-wrap;',
              '  word-break: break-word;',
              '  display: flex;',
              '  align-items: flex-start;',
              '  gap: 6px;',
            '}}',
            '.__mc-incoming-translation::before {{',
              '  content: "译文";',
              '  display: inline-flex;',
              '  align-items: center;',
              '  justify-content: center;',
              '  min-width: 34px;',
              '  height: 18px;',
              '  padding: 0 5px;',
              '  border-radius: 999px;',
              '  color: #fff;',
              '  background: #18a058;',
              '  font-size: 10px;',
              '  font-weight: 700;',
              '  line-height: 18px;',
              '  flex-shrink: 0;',
            '}}',
            '.__mc-incoming-translation.loading {{',
              '  color: #6d7780;',
              '  background: rgba(244, 247, 249, 0.95);',
              '  border-left-color: rgba(117, 130, 142, 0.35);',
            '}}',
            '.__mc-incoming-translation.loading::before {{',
              '  content: "翻译中";',
              '  background: #8491a3;',
            '}}',
            '.__mc-incoming-translation.error {{',
              '  color: #b53340;',
              '  background: rgba(255, 245, 246, 0.96);',
              '  border-left-color: rgba(198, 58, 70, 0.45);',
            '}}',
            '.__mc-incoming-translation.error::before {{',
              '  content: "失败";',
              '  background: #cf3f4f;',
            '}}',
            '.__mc-incoming-translation.idle::before {{',
              '  content: "未译";',
              '  color: #16754f;',
              '  background: rgba(24, 160, 88, 0.12);',
            '}}',
            '.__mc-incoming-translation.cached::before {{',
              '  content: "缓存";',
              '  background: #0e8f68;',
            '}}',
            '.__mc-incoming-translation-body {{',
              '  min-width: 0;',
              '  flex: 1;',
            '}}',
            '.__mc-incoming-translation-actions {{',
              '  margin-left: auto;',
              '  display: inline-flex;',
              '  align-items: center;',
              '  gap: 5px;',
              '  flex-shrink: 0;',
            '}}',
            '.__mc-incoming-translation button {{',
            '  height: 24px;',
            '  padding: 0 8px;',
            '  border: 1px solid rgba(24, 160, 88, 0.32);',
            '  border-radius: 999px;',
            '  color: #16754f;',
            '  background: #ffffff;',
            '  font: inherit;',
            '  font-size: 11px;',
            '  cursor: pointer;',
            '}}',
            '.__mc-incoming-translation button:hover {{',
            '  background: #e9f8f1;',
            '}}',
            '.__mc-preview {{',
            '  position: fixed;',
            '  display: none;',
            '  box-sizing: border-box;',
            '  overflow: hidden;',
            '  border: 1px solid rgba(92, 120, 144, 0.22);',
            '  border-radius: 12px;',
            '  color: #233138;',
            '  background: rgba(255, 255, 255, 0.98);',
            '  box-shadow: 0 10px 30px rgba(11, 20, 26, 0.16);',
            '  font-family: inherit;',
            '  z-index: 2147483000;',
            '  pointer-events: auto;',
            '}}',
            '.__mc-preview-head {{',
            '  min-height: 38px;',
            '  padding: 0 10px 0 12px;',
            '  border-bottom: 1px solid #edf1f3;',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 7px;',
            '}}',
            '.__mc-preview-title {{',
            '  color: #34434b;',
            '  font-size: 12px;',
            '  font-weight: 600;',
            '}}',
            '.__mc-preview-language, .__mc-preview-mode {{',
            '  padding: 2px 6px;',
            '  border-radius: 999px;',
            '  color: #187a55;',
            '  background: #e9f8f1;',
            '  font-size: 10px;',
            '  line-height: 16px;',
            '}}',
            '.__mc-preview-mode {{',
            '  color: #697781;',
            '  background: #f0f3f5;',
            '}}',
            '.__mc-preview-actions {{',
            '  margin-left: auto;',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 3px;',
            '}}',
            '.__mc-preview button {{',
            '  height: 26px;',
            '  padding: 0 7px;',
            '  border: 0;',
            '  border-radius: 6px;',
            '  color: #61717a;',
            '  background: transparent;',
            '  font: inherit;',
            '  font-size: 11px;',
            '  font-weight: 500;',
            '  cursor: pointer;',
            '}}',
            '.__mc-preview button:hover {{',
            '  color: #087b57;',
            '  background: #edf8f4;',
            '}}',
            '.__mc-preview-close {{',
            '  width: 26px;',
            '  padding: 0 !important;',
            '  font-size: 16px !important;',
            '}}',
            '.__mc-preview-body {{',
            '  margin: 0;',
            '  padding: 10px 12px 8px;',
            '  color: #26343b;',
            '  font-size: 13px;',
            '  line-height: 1.55;',
            '  white-space: pre-wrap;',
            '  overflow-wrap: anywhere;',
            '  display: -webkit-box;',
            '  -webkit-box-orient: vertical;',
            '  -webkit-line-clamp: 3;',
            '  overflow: hidden;',
            '}}',
            '.__mc-preview.expanded .__mc-preview-body {{',
            '  display: block;',
            '  max-height: 180px;',
            '  overflow-y: auto;',
            '}}',
            '.__mc-preview.loading .__mc-preview-body {{',
            '  color: #7a8991;',
            '}}',
            '.__mc-preview.error {{',
            '  border-color: rgba(201, 65, 76, 0.35);',
            '}}',
            '.__mc-preview.error .__mc-preview-body {{',
            '  color: #b53340;',
            '}}',
            '.__mc-preview-foot {{',
            '  min-height: 26px;',
            '  padding: 0 12px 7px;',
            '  color: #839198;',
            '  font-size: 10px;',
            '  display: flex;',
            '  align-items: center;',
            '  justify-content: space-between;',
            '}}',
            '.__mc-preview-expand {{',
            '  display: none;',
            '}}',
            '.__mc-preview.long .__mc-preview-expand {{',
            '  display: inline-flex;',
            '  align-items: center;',
            '}}'
        ].join('\n');
        document.head.appendChild(style);
    }}

    function translationConfig() {{
        return window.__MC_TRANSLATION_CONFIG__ || {{}};
    }}

    function clampNumber(value, fallback, min, max) {{
        var parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.min(max, Math.round(parsed)));
    }}

    function translationPersistLimit() {{
        return clampNumber(
            translationConfig().translationCachePerAccountLimit,
            TRANSLATION_PERSIST_DEFAULT_LIMIT,
            20,
            2000
        );
    }}

    function translationPersistMaxAgeMs() {{
        var days = clampNumber(
            translationConfig().translationCacheRetentionDays,
            TRANSLATION_PERSIST_DEFAULT_MAX_AGE_DAYS,
            1,
            365
        );
        return 1000 * 60 * 60 * 24 * days;
    }}

    function containsCjk(text) {{
        return /[\u3400-\u9fff]/.test(text || '');
    }}

    function shouldGateRawSourceSend(text, config) {{
        return !!text && config.blockChinese !== false && containsCjk(text);
    }}

    function renderBlockedChinese(input, text, config) {{
        previewDismissedSource = '';
        previewTranslation = '';
        renderPreview(
            input,
            text,
            'error',
            config && config.sendTranslation === false
                ? '已禁止直接发送中文。请先打开“自己的语言”翻译，或关闭“禁止中文”。'
                : '译文还没有准备好，已阻止中文原文发送。请等待翻译完成后再发送。',
            (config && config.translationChannel) || 'OpenAI'
        );
    }}

    function normalizeTranslationError(error) {{
        var candidate = error;
        if (candidate && typeof candidate.message === 'string') {{
            candidate = candidate.message;
        }}
        if (typeof candidate === 'string') {{
            try {{
                candidate = JSON.parse(candidate);
            }} catch (_parseError) {{
                return {{ code: '', message: candidate }};
            }}
        }}
        return {{
            code: candidate && typeof candidate.code === 'string'
                ? candidate.code
                : '',
            message: candidate && typeof candidate.message === 'string'
                ? candidate.message
                : ''
        }};
    }}

    function translationErrorMessage(error) {{
        var normalized = normalizeTranslationError(error);
        var code = normalized.code;
        if (code === 'TRANSLATION_NOT_CONFIGURED') {{
            return 'OpenAI Key 或翻译通道尚未配置，请检查设置后重启客户端。';
        }}
        if (code === 'TRANSLATION_QUOTA') {{
            return 'OpenAI 额度不足或请求过于频繁，请稍后重试。';
        }}
        if (code === 'TRANSLATION_TIMEOUT' || code === 'NETWORK_TIMEOUT') {{
            return '翻译请求超时，请检查网络后重试。';
        }}
        return normalized.message
            ? normalized.message
            : '翻译失败，请稍后重试。';
    }}

    var previewEl = null;
    var previewInput = null;
    var previewSource = '';
    var previewConfigKey = '';
    var previewTranslation = '';
    var previewDismissedSource = '';
    var pendingReplaceSource = '';
    var pendingReplaceInput = null;
    var replaceInFlight = false;
    var previewTimer = 0;
    var previewRequestId = 0;
    var replaceRequestId = 0;
    var incomingTranslateRequestId = 0;
    var lastReplaceGestureAt = 0;
    var translationCache = new Map();
    var incomingPendingTranslations = new Map();
    var TRANSLATION_CACHE_LIMIT = 80;
    var TRANSLATION_PERSIST_PREFIX = '__mc_translation_cache_v2:';
    var TRANSLATION_PERSIST_INDEX_KEY = '__mc_translation_cache_index_v2:' + MC_ACCOUNT_ID;
    var TRANSLATION_PERSIST_CLEAR_KEY = '__mc_translation_cache_clear_v2:' + MC_ACCOUNT_ID;
    var TRANSLATION_PERSIST_DEFAULT_LIMIT = 260;
    var TRANSLATION_PERSIST_DEFAULT_MAX_AGE_DAYS = 45;
    var TRANSLATION_DEBOUNCE_MS = 350;
    var TRANSLATION_REQUEST_TIMEOUT_MS = 22000;
    var NATIVE_REPLACE_GESTURE_WINDOW_MS = 15000;
    var INCOMING_TRANSLATION_LIMIT = 16;
    var INCOMING_AUTO_WINDOW = 12;
    var INCOMING_AUTO_MAX_IN_FLIGHT = 2;
    var INCOMING_SCAN_INTERVAL_MS = 1100;
    var INCOMING_MAX_CHARS = 3000;
    var incomingAutoInFlight = 0;
    var lastIncomingScanAt = 0;
    var incomingScanTimer = 0;

    function findComposer() {{
        return document.querySelector('footer [contenteditable="true"]') ||
               document.querySelector('[data-tab="10"][contenteditable="true"]');
    }}

    function copyText(value) {{
        if (navigator.clipboard && navigator.clipboard.writeText) {{
            return navigator.clipboard.writeText(value);
        }}
        return new Promise(function(resolve, reject) {{
            var textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {{
                document.execCommand('copy');
                resolve();
            }} catch (error) {{
                reject(error);
            }} finally {{
                textarea.remove();
            }}
        }});
    }}

    function normalizeComposerText(value) {{
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\u200b/g, '')
            .trim();
    }}

    function composerText(input) {{
        return normalizeComposerText(input ? (input.innerText || input.textContent || '') : '');
    }}

    function audioMimeForUpload(file) {{
        var name = String((file && file.name) || '').toLowerCase();
        if (/\.m4a$/.test(name) || /\.mp4$/.test(name)) return 'audio/mp4';
        if (/\.mp3$/.test(name) || /\.mpeg$/.test(name)) return 'audio/mpeg';
        if (/\.ogg$/.test(name) || /\.oga$/.test(name) || /\.opus$/.test(name)) return 'audio/ogg';
        if (/\.wav$/.test(name)) return 'audio/wav';
        if (/\.aac$/.test(name)) return 'audio/aac';
        return '';
    }}

    function normalizeAudioUploadFiles(input) {{
        if (!input || input.__mcNormalizingAudioUpload || !input.files || !input.files.length) return;
        if (typeof DataTransfer === 'undefined' || typeof File === 'undefined') return;
        var changed = false;
        var transfer;
        try {{
            transfer = new DataTransfer();
        }} catch (_transferError) {{
            return;
        }}
        Array.prototype.forEach.call(input.files, function(file) {{
            var expectedType = audioMimeForUpload(file);
            if (!expectedType) {{
                transfer.items.add(file);
                return;
            }}
            if (file.type === expectedType) {{
                transfer.items.add(file);
                return;
            }}
            changed = true;
            try {{
                transfer.items.add(new File([file], file.name, {{
                    type: expectedType,
                    lastModified: file.lastModified || Date.now()
                }}));
            }} catch (_fileError) {{
                transfer.items.add(file);
            }}
        }});
        if (!changed) return;
        try {{
            input.__mcNormalizingAudioUpload = true;
            input.files = transfer.files;
        }} catch (_assignError) {{
        }} finally {{
            input.__mcNormalizingAudioUpload = false;
        }}
    }}

    function handleFileInputChange(event) {{
        var input = event && event.target;
        if (!input || !input.matches || !input.matches('input[type="file"]')) return;
        normalizeAudioUploadFiles(input);
    }}

    function hasPendingAttachmentSend(target) {{
        if (target && target.closest && target.closest(
            '[data-testid="media-editor"],' +
            '[data-testid="media-preview"],' +
            '[data-testid="document-preview"],' +
            '[data-animate-modal-popup="true"]'
        )) {{
            return true;
        }}
        return !!document.querySelector(
            '[data-testid="media-editor"],' +
            '[data-testid="media-preview"],' +
            '[data-testid="document-preview"]'
        );
    }}

    function selectComposerContent(input) {{
        input.focus();
        try {{
            document.execCommand('selectAll', false, null);
            var selected = String(window.getSelection ? window.getSelection() : '');
            if (normalizeComposerText(selected) === composerText(input)) {{
                return;
            }}
        }} catch (_selectAllError) {{}}
        var selection = window.getSelection();
        if (!selection) return;
        var range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
    }}

    function dispatchComposerInput(input) {{
        input.dispatchEvent(new Event('input', {{ bubbles: true }}));
        input.dispatchEvent(new Event('change', {{ bubbles: true }}));
    }}

    function placeCaretAtEnd(input) {{
        input.focus();
        var selection = window.getSelection();
        if (!selection) return;
        var range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }}

    function hardSetComposerText(input, value) {{
        try {{
            while (input.firstChild) {{
                input.removeChild(input.firstChild);
            }}
            String(value).split(/\r?\n/).forEach(function(line) {{
                var paragraph = document.createElement('p');
                if (line) {{
                    var span = document.createElement('span');
                    span.setAttribute('data-lexical-text', 'true');
                    span.textContent = line;
                    paragraph.appendChild(span);
                }} else {{
                    paragraph.appendChild(document.createElement('br'));
                }}
                input.appendChild(paragraph);
            }});
            if (!input.firstChild) {{
                var emptyParagraph = document.createElement('p');
                emptyParagraph.appendChild(document.createElement('br'));
                input.appendChild(emptyParagraph);
            }}
        }} catch (_hardSetError) {{
            try {{
                input.textContent = value;
            }} catch (_directSetError) {{}}
        }}
        placeCaretAtEnd(input);
        dispatchComposerInput(input);
    }}

    function replaceComposerSelection(input, value) {{
        selectComposerContent(input);
        var inserted = false;
        try {{
            inserted = document.execCommand('insertText', false, value);
        }} catch (_insertError) {{}}
        if (!inserted) {{
            hardSetComposerText(input, value);
            return false;
        }}
        return true;
    }}

    function isComposerFocused(input) {{
        if (!input || !document.body.contains(input) || !document.hasFocus()) {{
            return false;
        }}
        var active = document.activeElement;
        return active === input || input.contains(active);
    }}

    function prepareComposerForNativeReplace(input) {{
        if (!input || !document.body.contains(input) || !document.hasFocus()) {{
            return false;
        }}
        try {{
            input.focus();
            selectComposerContent(input);
        }} catch (_focusError) {{
            return false;
        }}
        return isComposerFocused(input);
    }}

    function nativeReplaceComposerText(input, value, timeoutMs) {{
        return new Promise(function(resolve) {{
            if (!window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) {{
                resolve(false);
                return;
            }}
            if (Date.now() - lastReplaceGestureAt > NATIVE_REPLACE_GESTURE_WINDOW_MS) {{
                resolve(false);
                return;
            }}
            if (!prepareComposerForNativeReplace(input)) {{
                resolve(false);
                return;
            }}
            var nonce = 'r' + (++replaceRequestId);
            var settled = false;
            window.__mcReplaceCallbacks = window.__mcReplaceCallbacks || {{}};
            var timeout = window.setTimeout(function() {{
                if (settled) return;
                settled = true;
                delete window.__mcReplaceCallbacks[nonce];
                resolve(false);
            }}, timeoutMs || 2600);
            window.__mcReplaceCallbacks[nonce] = function(success) {{
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                delete window.__mcReplaceCallbacks[nonce];
                resolve(!!success);
            }};
            window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                event: 'mc://replace-composer',
                payload: {{
                    requestId: nonce,
                    accountId: MC_ACCOUNT_ID,
                    token: MC_PANEL_TOKEN,
                    text: value
                }}
            }}).catch(function() {{
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                delete window.__mcReplaceCallbacks[nonce];
                resolve(false);
            }});
        }});
    }}

    function replaceComposerText(input, value, timeoutMs) {{
        return new Promise(function(resolve) {{
            var effectiveTimeout = Math.max(timeoutMs || 1600, 3200);
            var deadline = Date.now() + effectiveTimeout;
            var expected = normalizeComposerText(value);
            var currentInput = input && document.body.contains(input) ? input : findComposer();
            if (!currentInput) {{
                resolve(false);
                return;
            }}
            previewInput = currentInput;
            function verifyUntilDeadline() {{
                var verifyingInput = input && document.body.contains(input) ? input : findComposer();
                if (!verifyingInput) {{
                    resolve(false);
                    return;
                }}
                previewInput = verifyingInput;
                var actual = composerText(verifyingInput);
                if (actual === expected) {{
                    resolve(true);
                    return;
                }}
                if (Date.now() >= deadline) {{
                    resolve(false);
                    return;
                }}
                window.setTimeout(verifyUntilDeadline, 90);
            }}
            nativeReplaceComposerText(currentInput, value, effectiveTimeout)
                .then(function(nativeReplaced) {{
                    if (!nativeReplaced) {{
                        resolve(false);
                        return;
                    }}
                    window.setTimeout(verifyUntilDeadline, 180);
                }})
                .catch(function() {{
                    resolve(false);
                }});
        }});
    }}

    function renderReplaceFailed(input, sourceText, translationText) {{
        previewDismissedSource = '';
        previewTranslation = translationText;
        renderPreview(
            input,
            sourceText,
            'error',
            '替换输入框失败，请重试。',
            translationConfig().translationChannel
        );
    }}

    function replaceAndArmSend(input, sourceText, translationText) {{
        if (replaceInFlight) {{
            return Promise.resolve(false);
        }}
        replaceInFlight = true;
        return replaceComposerText(input, translationText, 1600)
            .then(function(replaced) {{
                replaceInFlight = false;
                if (!replaced) {{
                    renderReplaceFailed(input, sourceText, translationText);
                    return false;
                }}
                previewDismissedSource = translationText;
                if (previewEl) previewEl.style.display = 'none';
                return true;
            }})
            .catch(function() {{
                replaceInFlight = false;
                renderReplaceFailed(input, sourceText, translationText);
                return false;
            }});
    }}

    function consumePendingReplace(input, text) {{
        if (!pendingReplaceSource || pendingReplaceSource !== text || !previewTranslation) {{
            return false;
        }}
        var targetInput = pendingReplaceInput && document.body.contains(pendingReplaceInput)
            ? pendingReplaceInput
            : input;
        pendingReplaceSource = '';
        pendingReplaceInput = null;
        replaceAndArmSend(targetInput, text, previewTranslation);
        return true;
    }}

    function requestImmediateTranslation(input, text, config) {{
        pendingReplaceSource = text;
        pendingReplaceInput = input;
        previewDismissedSource = '';
        previewSource = '';
        previewConfigKey = '';
        previewTranslation = '';
        clearTimeout(previewTimer);
        renderPreview(input, text, 'loading', '', config.translationChannel);

        var previousDebounce = TRANSLATION_DEBOUNCE_MS;
        TRANSLATION_DEBOUNCE_MS = 0;
        try {{
            updatePreview();
        }} finally {{
            TRANSLATION_DEBOUNCE_MS = previousDebounce;
        }}
    }}

    function translationCacheKey(text, config) {{
        return [
            config.translationChannel || '',
            config.translationStyle || '',
            config.regionalTone || '',
            config.sourceLanguage || '',
            config.targetLanguage || '',
            text
        ].join('|');
    }}

    function translationStorageHash(value) {{
        var hash = 0x811c9dc5;
        for (var index = 0; index < value.length; index++) {{
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }}
        return (hash >>> 0).toString(16);
    }}

    function translationStorageKey(key) {{
        return TRANSLATION_PERSIST_PREFIX + MC_ACCOUNT_ID + ':' + translationStorageHash(key);
    }}

    function readTranslationIndex() {{
        try {{
            var raw = window.localStorage.getItem(TRANSLATION_PERSIST_INDEX_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.filter(function(item) {{
                return item && typeof item.key === 'string' && typeof item.storageKey === 'string';
            }}) : [];
        }} catch (_indexError) {{
            return [];
        }}
    }}

    function writeTranslationIndex(index) {{
        try {{
            window.localStorage.setItem(TRANSLATION_PERSIST_INDEX_KEY, JSON.stringify(index));
        }} catch (_indexWriteError) {{}}
    }}

    function pruneTranslationStorage(index) {{
        var now = Date.now();
        var maxAgeMs = translationPersistMaxAgeMs();
        var maxEntries = translationPersistLimit();
        var seen = {{}};
        var next = [];
        index.forEach(function(item) {{
            if (!item || !item.storageKey || seen[item.storageKey]) return;
            seen[item.storageKey] = true;
            var createdAt = Number(item.createdAt || 0);
            if (createdAt && now - createdAt > maxAgeMs) {{
                try {{ window.localStorage.removeItem(item.storageKey); }} catch (_removeOldError) {{}}
                return;
            }}
            next.push(item);
        }});
        while (next.length > maxEntries) {{
            var oldest = next.shift();
            if (oldest && oldest.storageKey) {{
                try {{ window.localStorage.removeItem(oldest.storageKey); }} catch (_removeOverflowError) {{}}
            }}
        }}
        writeTranslationIndex(next);
        return next;
    }}

    function readPersistentTranslation(key) {{
        if (!key) return null;
        try {{
            var storageKey = translationStorageKey(key);
            var raw = window.localStorage.getItem(storageKey);
            if (!raw) return null;
            var entry = JSON.parse(raw);
            if (!entry || entry.cacheKey !== key || !entry.payload || !entry.payload.translatedText) {{
                window.localStorage.removeItem(storageKey);
                return null;
            }}
            var createdAt = Number(entry.createdAt || 0);
            if (createdAt && Date.now() - createdAt > translationPersistMaxAgeMs()) {{
                window.localStorage.removeItem(storageKey);
                pruneTranslationStorage(readTranslationIndex());
                return null;
            }}
            rememberTranslation(key, entry.payload, false);
            return entry.payload;
        }} catch (_readPersistentError) {{
            return null;
        }}
    }}

    function writePersistentTranslation(key, payload) {{
        if (!key || !payload || !payload.translatedText) return;
        try {{
            if (String(payload.translatedText).length > 10000) return;
            var storageKey = translationStorageKey(key);
            var now = Date.now();
            window.localStorage.setItem(storageKey, JSON.stringify({{
                version: 2,
                cacheKey: key,
                payload: payload,
                createdAt: now
            }}));
            var index = readTranslationIndex().filter(function(item) {{
                return item.storageKey !== storageKey;
            }});
            index.push({{ key: key, storageKey: storageKey, createdAt: now }});
            pruneTranslationStorage(index);
        }} catch (_writePersistentError) {{}}
    }}

    function clearPersistentTranslationStorage() {{
        try {{
            readTranslationIndex().forEach(function(item) {{
                if (item && item.storageKey) {{
                    try {{ window.localStorage.removeItem(item.storageKey); }} catch (_removeCacheError) {{}}
                }}
            }});
            window.localStorage.removeItem(TRANSLATION_PERSIST_INDEX_KEY);
            translationCache.clear();
        }} catch (_clearPersistentError) {{}}
    }}

    function applyTranslationCacheClearMarker() {{
        var clearAt = Number(translationConfig().translationCacheClearAt || 0);
        if (!clearAt) return;
        var stored = Number(window.localStorage.getItem(TRANSLATION_PERSIST_CLEAR_KEY) || 0);
        if (stored >= clearAt) return;
        clearPersistentTranslationStorage();
        try {{
            window.localStorage.setItem(TRANSLATION_PERSIST_CLEAR_KEY, String(clearAt));
        }} catch (_clearMarkerWriteError) {{}}
    }}

    function rememberTranslation(key, payload, persist) {{
        if (!key || !payload || !payload.translatedText) return;
        if (translationCache.has(key)) translationCache.delete(key);
        translationCache.set(key, payload);
        while (translationCache.size > TRANSLATION_CACHE_LIMIT) {{
            var oldest = translationCache.keys().next().value;
            translationCache.delete(oldest);
        }}
        if (persist !== false) writePersistentTranslation(key, payload);
    }}

    try {{
        applyTranslationCacheClearMarker();
        pruneTranslationStorage(readTranslationIndex());
    }} catch (_initialPruneError) {{}}

    function requestPanelTranslation(text, requestConfig, timeoutMs) {{
        return new Promise(function(resolve) {{
            if (!window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) {{
                resolve({{ success: false, payload: {{ message: '翻译通道未就绪。' }} }});
                return;
            }}
            var nonce = 'rx' + (++incomingTranslateRequestId);
            var settled = false;
            window.__mcTranslateCallbacks = window.__mcTranslateCallbacks || {{}};
            var timeout = window.setTimeout(function() {{
                if (settled) return;
                settled = true;
                delete window.__mcTranslateCallbacks[nonce];
                resolve({{ success: false, payload: {{ code: 'TRANSLATION_TIMEOUT', message: '翻译请求超时，请稍后重试。' }} }});
            }}, timeoutMs || TRANSLATION_REQUEST_TIMEOUT_MS);
            window.__mcTranslateCallbacks[nonce] = function(success, payloadJson) {{
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                delete window.__mcTranslateCallbacks[nonce];
                var payload;
                try {{ payload = JSON.parse(payloadJson); }} catch (_e) {{ payload = {{}}; }}
                resolve({{ success: !!success, payload: payload || {{}} }});
            }};
            window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                event: 'mc://translate-request',
                payload: {{
                    requestId: nonce,
                    accountId: MC_ACCOUNT_ID,
                    token: MC_PANEL_TOKEN,
                    text: text,
                    purpose: requestConfig.purpose || 'incoming',
                    sourceLanguage: requestConfig.sourceLanguage,
                    targetLanguage: requestConfig.targetLanguage
                }}
            }}).catch(function() {{
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                delete window.__mcTranslateCallbacks[nonce];
                resolve({{ success: false, payload: {{ message: '翻译请求未能发送。' }} }});
            }});
        }});
    }}

    function incomingTranslationConfig(config) {{
        return Object.assign({{}}, config, {{
            sourceLanguage: '自动检测',
            targetLanguage: '中文（简体）'
        }});
    }}

    function normalizeIncomingText(value) {{
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\u200b/g, '')
            .replace(/\n{{3,}}/g, '\n\n')
            .trim();
    }}

    function shouldTranslateIncomingText(text) {{
        if (!text) return false;
        if (text.length > INCOMING_MAX_CHARS) return false;
        return !containsCjk(text);
    }}

    function isMessageVisible(message) {{
        if (!message || !message.getBoundingClientRect) return false;
        var rect = message.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        var topLimit = 86;
        var bottomLimit = Math.max(topLimit + 120, window.innerHeight - 70);
        return rect.bottom > topLimit && rect.top < bottomLimit;
    }}

    function findIncomingMessages() {{
        var direct = Array.prototype.slice.call(document.querySelectorAll('.message-in'))
            .filter(isMessageVisible);
        if (direct.length) return direct.slice(-INCOMING_TRANSLATION_LIMIT);
        return Array.prototype.slice.call(document.querySelectorAll('[data-testid="msg-container"]'))
            .filter(function(node) {{
                return isMessageVisible(node) &&
                    !node.closest('.message-out') &&
                    !!node.querySelector('span.selectable-text, [data-pre-plain-text]');
            }})
            .slice(-INCOMING_TRANSLATION_LIMIT);
    }}

    function incomingMessageText(message) {{
        var candidates = Array.prototype.slice.call(
            message.querySelectorAll('span.selectable-text.copyable-text, span.selectable-text, [data-pre-plain-text]')
        );
        for (var index = candidates.length - 1; index >= 0; index--) {{
            var text = normalizeIncomingText(candidates[index].innerText || candidates[index].textContent || '');
            if (text) return text;
        }}
        return '';
    }}

    function incomingHost(message) {{
        var host = null;
        try {{
            host = message.querySelector(':scope > .__mc-incoming-translation');
        }} catch (_scopeError) {{
            host = message.querySelector('.__mc-incoming-translation');
        }}
        if (!host) {{
            host = document.createElement('div');
            host.className = '__mc-incoming-translation';
            message.appendChild(host);
        }}
        return host;
    }}

    function renderIncomingHost(host, state, message, onRetry) {{
        host.className = '__mc-incoming-translation' + (state ? ' ' + state : '');
        host.setAttribute('data-state', state || 'idle');
        host.textContent = '';

        var body = document.createElement('span');
        body.className = '__mc-incoming-translation-body';
        body.textContent = message || (state === 'idle' ? '点击翻译这条消息' : '');
        host.appendChild(body);

        if (state === 'ready' || state === 'cached') {{
            var readyActions = document.createElement('span');
            readyActions.className = '__mc-incoming-translation-actions';
            var copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.textContent = '复制';
            copyButton.addEventListener('click', function(event) {{
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                copyText(message || '').then(function() {{
                    copyButton.textContent = '已复制';
                    setTimeout(function() {{ copyButton.textContent = '复制'; }}, 1200);
                }}).catch(function() {{}});
            }});
            readyActions.appendChild(copyButton);
            host.appendChild(readyActions);
            return;
        }}

        if (state === 'idle' || state === 'error') {{
            var actions = document.createElement('span');
            actions.className = '__mc-incoming-translation-actions';
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = state === 'error' ? '重试翻译' : '翻译';
            button.addEventListener('click', function(event) {{
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (typeof onRetry === 'function') onRetry();
            }});
            actions.appendChild(button);
            host.appendChild(actions);
        }}
    }}

    function requestIncomingTranslation(message, text, config, automatic) {{
        var host = incomingHost(message);
        var incomingConfig = incomingTranslationConfig(config);
        var cacheKey = translationCacheKey(text, incomingConfig);
        var cached = translationCache.get(cacheKey) || readPersistentTranslation(cacheKey);
        host.setAttribute('data-source', text);
        if (cached && cached.translatedText) {{
            renderIncomingHost(host, 'cached', cached.translatedText);
            return;
        }}
        if (host.getAttribute('data-state') === 'loading') return;
        renderIncomingHost(host, 'loading', '正在翻译成中文…');

        function applyResult(result) {{
            if (host.getAttribute('data-source') !== text) return;
            if (result && result.success && result.payload && result.payload.translatedText) {{
                rememberTranslation(cacheKey, result.payload);
                renderIncomingHost(host, 'ready', result.payload.translatedText);
                return;
            }}
            renderIncomingHost(
                host,
                'error',
                translationErrorMessage(result && result.payload),
                function() {{ requestIncomingTranslation(message, text, config, false); }}
            );
        }}

        var pending = incomingPendingTranslations.get(cacheKey);
        if (pending) {{
            pending.then(applyResult).catch(function() {{
                if (host.getAttribute('data-source') !== text) return;
                renderIncomingHost(
                    host,
                    'error',
                    '翻译失败，请重试。',
                    function() {{ requestIncomingTranslation(message, text, config, false); }}
                );
            }});
            return;
        }}

        var autoTracked = !!automatic;
        if (autoTracked) incomingAutoInFlight++;
        function finishAuto() {{
            if (!autoTracked) return;
            autoTracked = false;
            incomingAutoInFlight = Math.max(0, incomingAutoInFlight - 1);
        }}
        var request = requestPanelTranslation(text, incomingConfig, TRANSLATION_REQUEST_TIMEOUT_MS);
        incomingPendingTranslations.set(cacheKey, request);
        request
            .then(function(result) {{
                incomingPendingTranslations.delete(cacheKey);
                applyResult(result);
                finishAuto();
            }})
            .catch(function() {{
                incomingPendingTranslations.delete(cacheKey);
                if (host.getAttribute('data-source') !== text) {{
                    finishAuto();
                    return;
                }}
                renderIncomingHost(
                    host,
                    'error',
                    '翻译失败，请重试。',
                    function() {{ requestIncomingTranslation(message, text, config, false); }}
                );
                finishAuto();
            }});
    }}

    function updateIncomingTranslations() {{
        var config = translationConfig();
        if (config.receiveTranslation === false) return;
        if (document.visibilityState === 'hidden') return;
        var now = Date.now();
        if (now - lastIncomingScanAt < INCOMING_SCAN_INTERVAL_MS) return;
        lastIncomingScanAt = now;
        var messages = findIncomingMessages().slice().reverse();
        messages.forEach(function(message, indexFromNewest) {{
            var text = incomingMessageText(message);
            var existingHost = message.querySelector('.__mc-incoming-translation');
            if (!shouldTranslateIncomingText(text)) {{
                if (existingHost) existingHost.remove();
                return;
            }}
            var host = incomingHost(message);
            if (host.getAttribute('data-source') !== text) {{
                host.setAttribute('data-source', text);
                host.setAttribute('data-state', 'idle');
                host.textContent = '';
            }}
            var incomingConfig = incomingTranslationConfig(config);
            var cached = translationCache.get(translationCacheKey(text, incomingConfig))
                || readPersistentTranslation(translationCacheKey(text, incomingConfig));
            if (cached && cached.translatedText) {{
                renderIncomingHost(host, 'cached', cached.translatedText);
                return;
            }}
            var state = host.getAttribute('data-state') || 'idle';
            if (state === 'ready' || state === 'cached' || state === 'loading' || state === 'error') return;
            if (
                config.incomingAutoTranslate !== false &&
                indexFromNewest < INCOMING_AUTO_WINDOW &&
                incomingAutoInFlight < INCOMING_AUTO_MAX_IN_FLIGHT
            ) {{
                requestIncomingTranslation(message, text, config, true);
            }} else {{
                renderIncomingHost(
                    host,
                    'idle',
                    '',
                    function() {{ requestIncomingTranslation(message, text, config, false); }}
                );
            }}
        }});
    }}

    function scheduleIncomingScan() {{
        if (incomingScanTimer) return;
        incomingScanTimer = window.setTimeout(function() {{
            incomingScanTimer = 0;
            lastIncomingScanAt = 0;
            try {{ updateIncomingTranslations(); }} catch (_) {{}}
        }}, 180);
    }}

    function asSendButton(candidate) {{
        return candidate ? (candidate.closest('button,[role="button"]') || candidate) : null;
    }}

    function findSendButton(target) {{
        if (!target || !target.closest) return null;
        var button = asSendButton(target.closest(
            'button[aria-label="Send"],' +
            'button[aria-label="发送"],' +
            'button[data-testid="compose-btn-send"],' +
            '[data-testid="send"]'
        ));
        if (button) return button;
        var icon = target.closest('[data-icon="send"]');
        return asSendButton(icon);
    }}

    function handleSendClick(event) {{
        var sendButton = findSendButton(event.target);
        if (!sendButton) return;
        if (hasPendingAttachmentSend(event.target)) return;

        var input = findComposer();
        var currentText = composerText(input);
        var config = translationConfig();
        if (previewDismissedSource === currentText) {{
            if (shouldGateRawSourceSend(currentText, config)) {{
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                renderBlockedChinese(input, currentText, config);
            }}
            return;
        }}
        var previewVisible =
            previewEl &&
            previewEl.style.display !== 'none' &&
            !previewEl.classList.contains('loading') &&
            !previewEl.classList.contains('error');
        var canSendTranslation =
            previewVisible &&
            previewTranslation &&
            currentText === previewSource;
        if (!canSendTranslation && !shouldGateRawSourceSend(currentText, config)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        lastReplaceGestureAt = Date.now();

        if (!canSendTranslation) {{
            if (config.sendTranslation === false) {{
                renderBlockedChinese(input, currentText, config);
                return;
            }}
            requestImmediateTranslation(input, currentText, config);
            return;
        }}

        var sourceAtClick = previewSource;
        var translationAtClick = previewTranslation;
        replaceAndArmSend(input, sourceAtClick, translationAtClick);
        return;
        replaceComposerText(input, translationAtClick, 1400).then(function(replaced) {{
            if (!replaced) {{
                previewDismissedSource = '';
                previewTranslation = translationAtClick;
                renderPreview(
                    input,
                    sourceAtClick,
                    'error',
                    '替换输入框失败，请点“替换原文”重试或手动发送译文。',
                    translationConfig().translationChannel
                );
                return;
            }}
            previewDismissedSource = translationAtClick;
            previewEl.style.display = 'none';
        }});
    }}

    function isPlainEnter(event) {{
        return event.key === 'Enter' &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.isComposing;
    }}

    function isEventInsideComposer(event, input) {{
        return !!(
            input &&
            event.target &&
            (event.target === input || input.contains(event.target))
        );
    }}

    function handleComposerEnter(event) {{
        if (!isPlainEnter(event)) return;
        if (hasPendingAttachmentSend(event.target)) return;
        var input = findComposer();
        if (!isEventInsideComposer(event, input)) return;
        var config = translationConfig();

        var currentText = composerText(input);
        if (!currentText) return;
        if (config.sendTranslation === false && !shouldGateRawSourceSend(currentText, config)) return;

        if (previewDismissedSource === currentText) {{
            if (shouldGateRawSourceSend(currentText, config)) {{
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                renderBlockedChinese(input, currentText, config);
            }}
            return;
        }}

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        lastReplaceGestureAt = Date.now();

        if (config.sendTranslation === false) {{
            renderBlockedChinese(input, currentText, config);
            return;
        }}

        if (previewTranslation && previewSource === currentText) {{
            replaceAndArmSend(input, currentText, previewTranslation);
            return;
        }}

        requestImmediateTranslation(input, currentText, config);
    }}

    function positionPreview(input) {{
        if (!previewEl || !input) return;
        var footer = input.closest('footer') || input.parentElement;
        if (!footer) return;
        var rect = footer.getBoundingClientRect();
        if (rect.width < 260 || rect.height < 20) {{
            previewEl.style.display = 'none';
            return;
        }}
        previewEl.style.left = Math.round(rect.left + 10) + 'px';
        previewEl.style.right = Math.round(window.innerWidth - rect.right + 10) + 'px';
        previewEl.style.bottom = Math.round(window.innerHeight - rect.top + 8) + 'px';
    }}

    function ensurePreview() {{
        if (previewEl && document.body.contains(previewEl)) return previewEl;
        previewEl = document.createElement('section');
        previewEl.className = '__mc-preview';
        previewEl.style.display = 'none';
        previewEl.setAttribute('aria-label', '译文预览');

        var head = document.createElement('div');
        head.className = '__mc-preview-head';
        var title = document.createElement('strong');
        title.className = '__mc-preview-title';
        title.textContent = '译文预览';
        var language = document.createElement('span');
        language.className = '__mc-preview-language';
        language.textContent = '英语';
        var mode = document.createElement('span');
        mode.className = '__mc-preview-mode';
        mode.textContent = 'OpenAI';
        var actions = document.createElement('div');
        actions.className = '__mc-preview-actions';

        var copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = '复制';
        copy.addEventListener('click', function() {{
            if (!previewTranslation) return;
            copyText(previewTranslation).then(function() {{
                copy.textContent = '已复制';
                setTimeout(function() {{ copy.textContent = '复制'; }}, 1200);
            }}).catch(function() {{}});
        }});

        var replace = document.createElement('button');
        replace.type = 'button';
        replace.textContent = '替换原文';
        replace.addEventListener('click', function() {{
            if (!previewInput || !previewTranslation) return;
            var sourceBeforeReplace = previewSource;
            var translationBeforeReplace = previewTranslation;
            replace.disabled = true;
            lastReplaceGestureAt = Date.now();
            replaceAndArmSend(previewInput, sourceBeforeReplace, translationBeforeReplace)
                .then(function() {{ replace.disabled = false; }});
            return;
            replaceComposerText(previewInput, translationBeforeReplace, 1400)
                .then(function(replaced) {{
                    replace.disabled = false;
                    if (replaced) {{
                        previewDismissedSource = translationBeforeReplace;
                        previewEl.style.display = 'none';
                        return;
                    }}
                    previewDismissedSource = '';
                    previewTranslation = translationBeforeReplace;
                    renderPreview(
                        previewInput,
                        sourceBeforeReplace,
                        'error',
                        '替换输入框失败，请重试。',
                        translationConfig().translationChannel
                    );
                }})
                .catch(function() {{
                    replace.disabled = false;
                }});
        }});

        var close = document.createElement('button');
        close.type = 'button';
        close.className = '__mc-preview-close';
        close.setAttribute('aria-label', '关闭译文预览');
        close.textContent = '×';
        close.addEventListener('click', function() {{
            previewDismissedSource = previewSource;
            previewEl.style.display = 'none';
        }});

        actions.appendChild(copy);
        actions.appendChild(replace);
        actions.appendChild(close);
        head.appendChild(title);
        head.appendChild(language);
        head.appendChild(mode);
        head.appendChild(actions);

        var body = document.createElement('p');
        body.className = '__mc-preview-body';
        var foot = document.createElement('div');
        foot.className = '__mc-preview-foot';
        var hint = document.createElement('span');
        hint.textContent = '第一次点击绿色按钮只替换译文，再点击一次才发送';
        hint.textContent = '第一次按 Enter 或绿色按钮只生成/替换译文，再按一次才发送';
        var expand = document.createElement('button');
        expand.type = 'button';
        expand.className = '__mc-preview-expand';
        expand.textContent = '展开';
        expand.addEventListener('click', function() {{
            var expanded = previewEl.classList.toggle('expanded');
            expand.textContent = expanded ? '收起' : '展开';
            positionPreview(previewInput);
        }});
        foot.appendChild(hint);
        foot.appendChild(expand);

        previewEl.appendChild(head);
        previewEl.appendChild(body);
        previewEl.appendChild(foot);
        document.body.appendChild(previewEl);
        return previewEl;
    }}

    function renderPreview(input, text, state, message, model) {{
        var el = ensurePreview();
        previewInput = input;
        var body = el.querySelector('.__mc-preview-body');
        var language = el.querySelector('.__mc-preview-language');
        var mode = el.querySelector('.__mc-preview-mode');
        var config = translationConfig();
        var hasCjk = /[\u3400-\u9fff]/.test(text);
        language.textContent =
            config.targetLanguage || (hasCjk ? '英语' : '中文');
        mode.textContent = model || config.translationChannel || 'OpenAI';
        body.textContent =
            state === 'loading'
                ? '正在通过 OpenAI 生成译文…'
                : message;
        body.style.fontSize = (config.fontSize || 16) + 'px';
        body.style.color =
            state === 'error' ? '#b53340' : (config.fontColor || '#26343b');
        el.classList.toggle('loading', state === 'loading');
        el.classList.toggle('error', state === 'error');
        el.classList.toggle(
            'long',
            state === 'ready' && previewTranslation.length > 120
        );
        if (state !== 'ready' || previewTranslation.length <= 120) {{
            el.classList.remove('expanded');
            el.querySelector('.__mc-preview-expand').textContent = '展开';
        }}
        positionPreview(input);
        el.style.display = 'block';
    }}

    function updatePreview() {{
        var input = findComposer();
        var el = ensurePreview();
        var config = translationConfig();
        if (!input) {{
            el.style.display = 'none';
            return;
        }}
        if (config.sendTranslation === false) {{
            clearTimeout(previewTimer);
            previewSource = '';
            previewConfigKey = '';
            previewTranslation = '';
            el.style.display = 'none';
            return;
        }}
        var text = composerText(input);
        if (pendingReplaceSource && pendingReplaceSource !== text) {{
            pendingReplaceSource = '';
            pendingReplaceInput = null;
        }}
        if (!text) {{
            clearTimeout(previewTimer);
            previewSource = '';
            previewConfigKey = '';
            previewTranslation = '';
            previewDismissedSource = '';
            el.style.display = 'none';
            return;
        }}
        if (previewDismissedSource === text) {{
            el.style.display = 'none';
            return;
        }}
        var configKey = [
            config.translationChannel,
            config.sourceLanguage,
            config.targetLanguage
        ].join('|');
        if (previewSource !== text || previewConfigKey !== configKey) {{
            clearTimeout(previewTimer);
            var requestId = ++previewRequestId;
            var cacheKey = translationCacheKey(text, config);
            var cached = translationCache.get(cacheKey) || readPersistentTranslation(cacheKey);
            previewSource = text;
            previewConfigKey = configKey;
            previewTranslation = '';
            if (cached && cached.translatedText) {{
                previewTranslation = cached.translatedText;
                renderPreview(
                    input,
                    text,
                    'ready',
                    previewTranslation,
                    cached.model || config.translationChannel
                );
                consumePendingReplace(input, text);
                return;
            }}
            renderPreview(
                input,
                text,
                'loading',
                '',
                config.translationChannel
            );
            previewTimer = setTimeout(function() {{
                if (previewSource !== text || requestId !== previewRequestId) return;
                var nonce = String(requestId);
                window.__mcTranslateCallbacks = window.__mcTranslateCallbacks || {{}};
                var timeout = window.setTimeout(function() {{
                    delete window.__mcTranslateCallbacks[nonce];
                    if (previewSource !== text || requestId !== previewRequestId) return;
                    if (pendingReplaceSource === text) {{
                        pendingReplaceSource = '';
                        pendingReplaceInput = null;
                    }}
                    previewTranslation = '';
                    renderPreview(
                        input,
                        text,
                        'error',
                        '翻译请求超时，请稍后重试。',
                        config.translationChannel
                    );
                }}, TRANSLATION_REQUEST_TIMEOUT_MS);
                window.__mcTranslateCallbacks[nonce] = function(success, payloadJson) {{
                    window.clearTimeout(timeout);
                    delete window.__mcTranslateCallbacks[nonce];
                    if (previewSource !== text || requestId !== previewRequestId) return;
                    var payload;
                    try {{ payload = JSON.parse(payloadJson); }} catch (_e) {{ payload = {{}}; }}
                    if (success) {{
                        previewTranslation = (payload && payload.translatedText) || '';
                        if (!previewTranslation) {{
                            renderPreview(
                                input,
                                text,
                                'error',
                                'OpenAI 返回了空译文。',
                                payload.model || config.translationChannel
                            );
                            return;
                        }}
                        rememberTranslation(cacheKey, payload);
                        renderPreview(
                            input,
                            text,
                            'ready',
                            previewTranslation,
                            payload.model || config.translationChannel
                        );
                        consumePendingReplace(input, text);
                    }} else {{
                        if (pendingReplaceSource === text) {{
                            pendingReplaceSource = '';
                            pendingReplaceInput = null;
                        }}
                        previewTranslation = '';
                        renderPreview(
                            input,
                            text,
                            'error',
                            translationErrorMessage(payload),
                            config.translationChannel
                        );
                    }}
                }};
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                    event: 'mc://translate-request',
                    payload: {{
                        requestId: nonce,
                        accountId: MC_ACCOUNT_ID,
                        token: MC_PANEL_TOKEN,
                        text: text,
                        purpose: 'outgoing'
                    }}
                }}).catch(function(_e) {{
                    window.clearTimeout(timeout);
                    delete window.__mcTranslateCallbacks[nonce];
                    if (previewSource !== text || requestId !== previewRequestId) return;
                    if (pendingReplaceSource === text) {{
                        pendingReplaceSource = '';
                        pendingReplaceInput = null;
                    }}
                    previewTranslation = '';
                    renderPreview(
                        input,
                        text,
                        'error',
                        '翻译请求未能发送。',
                        config.translationChannel
                    );
                }});
            }}, TRANSLATION_DEBOUNCE_MS);
            return;
        }}
        positionPreview(input);
    }}

    function tick() {{
        try {{ injectStyle(); }} catch (_) {{}}
        try {{ updatePreview(); }} catch (_) {{}}
        try {{ updateIncomingTranslations(); }} catch (_) {{}}
    }}
    window.__MC_TRANSLATION_CONFIG_UPDATED__ = function() {{
        try {{ applyTranslationCacheClearMarker(); }} catch (_) {{}}
        try {{ pruneTranslationStorage(readTranslationIndex()); }} catch (_) {{}}
        try {{ updatePreview(); }} catch (_) {{}}
        try {{ updateIncomingTranslations(); }} catch (_) {{}}
    }};
    mcAddListener(document, 'click', handleSendClick, true);
    mcAddListener(document, 'keydown', handleComposerEnter, true);
    mcAddListener(document, 'change', handleFileInputChange, true);
    mcAddListener(document, 'scroll', scheduleIncomingScan, true);
    mcAddListener(document, 'wheel', scheduleIncomingScan, true);
    mcAddListener(window, 'resize', scheduleIncomingScan, true);
    mcSetInterval(tick, 250);
}})();
"#,
        account_id = account_id,
        panel_token = panel_token
    )
}

#[derive(Default)]
pub struct AccountPanelManager {
    panels: Mutex<HashMap<String, String>>,
    panel_tokens: Mutex<HashMap<String, String>>,
    translation_configs: Mutex<HashMap<String, TranslationConfig>>,
}

impl AccountPanelManager {
    pub async fn open(&self, app: &AppHandle, account_id: &str) -> AppResult<()> {
        let label = panel_label(account_id);

        if app.get_webview(&label).is_some() {
            return self.show(app, account_id).await;
        }

        // Only one account panel is on-screen at a time. Other panels stay alive
        // off-screen so WhatsApp can keep updating unread state.
        {
            let panels = self.panels.lock().await;
            for lbl in panels.values() {
                if let Some(wv) = app.get_webview(lbl) {
                    let _ = park_panel(&wv);
                }
            }
        }

        let profile = profile_dir(app, account_id)?;
        std::fs::create_dir_all(&profile).map_err(|e| {
            AppError::new(
                ErrorCode::DiskFull,
                format!("Cannot create profile dir: {e}"),
            )
        })?;

        let url = WebviewUrl::External(
            "https://web.whatsapp.com/"
                .parse()
                .map_err(|_| AppError::new(ErrorCode::InvalidArgument, "Invalid URL."))?,
        );

        let panel_token = uuid::Uuid::new_v4().to_string();
        let script = init_script(account_id, &panel_token);

        let builder = WebviewBuilder::new(&label, url)
            .data_directory(profile)
            .initialization_script(&script);

        let host_window = host_webview(app)?.window();
        let panel = host_window
            .add_child(
                builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1.0, 1.0),
            )
            .map_err(|e| AppError::new(ErrorCode::WaPanelFailed, e.to_string()))?;
        panel
            .set_bounds(parked_panel_bounds())
            .map_err(|e| AppError::new(ErrorCode::WaPanelFailed, e.to_string()))?;
        panel
            .show()
            .map_err(|e| AppError::new(ErrorCode::WaPanelFailed, e.to_string()))?;

        self.panels
            .lock()
            .await
            .insert(account_id.to_string(), label);
        self.panel_tokens
            .lock()
            .await
            .insert(account_id.to_string(), panel_token);
        Ok(())
    }

    pub async fn show(&self, app: &AppHandle, account_id: &str) -> AppResult<()> {
        let label = panel_label(account_id);

        // Move other child webviews off-screen instead of hiding them. Hidden
        // WebViews can stop running page timers, which breaks unread notices.
        let panels = self.panels.lock().await;
        for (id, lbl) in panels.iter() {
            if id != account_id {
                if let Some(wv) = app.get_webview(lbl) {
                    let _ = park_panel(&wv);
                }
            }
        }
        drop(panels);

        let panel = app
            .get_webview(&label)
            .ok_or_else(|| AppError::new(ErrorCode::WaPanelFailed, "Panel not found."))?;

        panel
            .show()
            .map_err(|e| AppError::new(ErrorCode::WaPanelFailed, e.to_string()))?;
        Ok(())
    }

    pub async fn set_bounds(
        &self,
        app: &AppHandle,
        account_id: &str,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> AppResult<()> {
        if ![x, y, width, height].into_iter().all(f64::is_finite)
            || x < 0.0
            || y < 0.0
            || width < 1.0
            || height < 1.0
        {
            return Err(AppError::new(
                ErrorCode::InvalidArgument,
                "Panel bounds must be finite, positive logical pixels.",
            ));
        }

        let label = panel_label(account_id);
        let panel = app
            .get_webview(&label)
            .ok_or_else(|| AppError::new(ErrorCode::WaPanelFailed, "Panel not found."))?;
        panel
            .set_bounds(Rect {
                position: Position::Logical(LogicalPosition::new(x, y)),
                size: Size::Logical(LogicalSize::new(width, height)),
            })
            .map_err(|e| AppError::new(ErrorCode::WaPanelFailed, e.to_string()))
    }

    pub async fn hide(&self, app: &AppHandle, account_id: &str) -> AppResult<()> {
        let label = panel_label(account_id);
        if let Some(wv) = app.get_webview(&label) {
            park_panel(&wv).map_err(|error| {
                AppError::new(
                    ErrorCode::WaPanelFailed,
                    format!("Could not park the WhatsApp panel: {error}"),
                )
            })?;
        }
        Ok(())
    }

    pub async fn close(&self, app: &AppHandle, account_id: &str) -> AppResult<()> {
        let label = panel_label(account_id);
        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.close();
        }
        self.panels.lock().await.remove(account_id);
        self.panel_tokens.lock().await.remove(account_id);
        Ok(())
    }

    pub async fn panel_token_matches(&self, account_id: &str, token: &str) -> bool {
        self.panel_tokens
            .lock()
            .await
            .get(account_id)
            .is_some_and(|stored| stored == token)
    }

    pub async fn set_translation_config(
        &self,
        app: &AppHandle,
        account_id: &str,
        config: TranslationConfig,
    ) -> AppResult<()> {
        let serialized = serde_json::to_string(&config).map_err(|_| {
            AppError::new(
                ErrorCode::InvalidArgument,
                "Translation configuration could not be serialized.",
            )
        })?;
        self.translation_configs
            .lock()
            .await
            .insert(account_id.to_owned(), config);

        if let Some(panel) = app.get_webview(&panel_label(account_id)) {
            panel
                .eval(format!(
                    "(function(){{window.__MC_TRANSLATION_CONFIG__ = {serialized};var cb=window.__MC_TRANSLATION_CONFIG_UPDATED__;if(typeof cb==='function')try{{cb();}}catch(_e){{}}}})();"
                ))
                .map_err(|error| AppError::new(ErrorCode::WaPanelFailed, error.to_string()))?;
        }
        Ok(())
    }

    pub async fn translation_config(&self, account_id: &str) -> Option<TranslationConfig> {
        self.translation_configs
            .lock()
            .await
            .get(account_id)
            .cloned()
    }

    pub async fn remove_translation_config(&self, account_id: &str) {
        self.translation_configs.lock().await.remove(account_id);
    }

    pub async fn clear_account_data(&self, app: &AppHandle, account_id: &str) -> AppResult<()> {
        self.close(app, account_id).await?;
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        remove_profile_dir(&profile_dir(app, account_id)?).await?;
        remove_profile_dir(&legacy_profile_dir(app, account_id)?).await
    }

    pub async fn resize_all(&self, app: &AppHandle) -> AppResult<()> {
        host_webview(app)?
            .emit("wa-panel-layout-invalidated", ())
            .map_err(|e| AppError::new(ErrorCode::WaPanelFailed, e.to_string()))
    }

    pub async fn list_open(&self) -> Vec<String> {
        self.panels.lock().await.keys().cloned().collect()
    }
}

pub fn emit_state_to_main_with_unread(
    app: &AppHandle,
    account_id: &str,
    state: &str,
    unread_count: u32,
    reason_code: Option<&str>,
    summary: Option<&str>,
) -> AppResult<()> {
    host_webview(app)?
        .emit(
            "wa-panel-state",
            serde_json::json!({
                "accountId": account_id,
                "state": state,
                "unreadCount": unread_count.min(999),
                "reasonCode": reason_code,
                "summary": summary
            }),
        )
        .map_err(|e| AppError::new(ErrorCode::WaPanelFailed, e.to_string()))
}

fn is_safe_account_id(id: &str) -> bool {
    (8..=64).contains(&id.len())
        && id
            .chars()
            .enumerate()
            .all(|(i, c)| c.is_ascii_alphanumeric() || (i > 0 && matches!(c, '_' | '-')))
}

#[derive(Clone, Copy)]
struct TranslationLogMeta<'a> {
    account_id: &'a str,
    purpose: &'a str,
    duration_ms: u128,
    text_chars: usize,
}

fn emit_translation_log(
    app: &AppHandle,
    meta: TranslationLogMeta<'_>,
    success: bool,
    cache_status: Option<&str>,
    provider: Option<&str>,
    model: Option<&str>,
    error_code: Option<&str>,
    message: Option<&str>,
) {
    let _ = host_webview(app).and_then(|host| {
        host.emit(
            "translation-log-entry",
            serde_json::json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "createdAt": Utc::now().to_rfc3339(),
                "accountId": meta.account_id,
                "purpose": meta.purpose,
                "success": success,
                "cacheStatus": cache_status,
                "provider": provider,
                "model": model,
                "durationMs": meta.duration_ms.min(u128::from(u64::MAX)) as u64,
                "textChars": meta.text_chars,
                "errorCode": error_code,
                "message": message,
            }),
        )
        .map_err(|error| AppError::new(ErrorCode::WaPanelFailed, error.to_string()))
    });
}

#[derive(serde::Deserialize)]
struct TranslateRequestPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    token: String,
    text: String,
    purpose: Option<String>,
    #[serde(rename = "sourceLanguage")]
    source_language: Option<String>,
    #[serde(rename = "targetLanguage")]
    target_language: Option<String>,
}

#[derive(serde::Deserialize)]
struct ReplaceComposerPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    token: String,
    text: String,
}

#[derive(serde::Deserialize)]
struct PanelStateEventPayload {
    #[serde(rename = "accountId")]
    account_id: String,
    token: String,
    state: String,
    #[serde(rename = "unreadCount", default)]
    unread_count: u32,
    #[serde(rename = "reasonCode")]
    reason_code: Option<String>,
    summary: Option<String>,
}

pub async fn handle_translate_request_event(app: AppHandle, payload: String) {
    let Ok(req) = serde_json::from_str::<TranslateRequestPayload>(&payload) else {
        return;
    };
    if req.request_id.is_empty()
        || !req.request_id.chars().all(|c| c.is_ascii_alphanumeric())
        || !is_safe_account_id(&req.account_id)
    {
        return;
    }
    let started = Instant::now();
    let purpose = req
        .purpose
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("outgoing")
        .to_owned();
    let text_chars = req.text.chars().count();

    let manager = app.state::<AccountPanelManager>();
    if !manager
        .panel_token_matches(&req.account_id, &req.token)
        .await
    {
        return;
    }
    let outcome = match manager.translation_config(&req.account_id).await {
        Some(mut config) => {
            if purpose == "incoming" {
                if !config.receive_translation {
                    emit_translation_log(
                        &app,
                        TranslationLogMeta {
                            account_id: &req.account_id,
                            purpose: &purpose,
                            duration_ms: started.elapsed().as_millis(),
                            text_chars,
                        },
                        false,
                        None,
                        None,
                        None,
                        Some(ErrorCode::TranslationNotConfigured.as_str()),
                        Some("Incoming translation is disabled for this account."),
                    );
                    return_translate_request(
                        &app,
                        &req,
                        false,
                        serde_json::json!({
                            "code": ErrorCode::TranslationNotConfigured,
                            "message": "Incoming translation is disabled for this account."
                        })
                        .to_string(),
                    );
                    return;
                }
                // The shared translation engine historically uses the
                // `send_translation` flag as a generic "translation enabled"
                // guard. Incoming requests have already been authorized by
                // `receive_translation`, so allow the engine call to proceed.
                config.send_translation = true;
            } else if !config.send_translation {
                emit_translation_log(
                    &app,
                    TranslationLogMeta {
                        account_id: &req.account_id,
                        purpose: &purpose,
                        duration_ms: started.elapsed().as_millis(),
                        text_chars,
                    },
                    false,
                    None,
                    None,
                    None,
                    Some(ErrorCode::TranslationNotConfigured.as_str()),
                    Some("Outgoing translation is disabled for this account."),
                );
                return_translate_request(
                    &app,
                    &req,
                    false,
                    serde_json::json!({
                        "code": ErrorCode::TranslationNotConfigured,
                        "message": "Outgoing translation is disabled for this account."
                    })
                    .to_string(),
                );
                return;
            }
            if let Some(source_language) = req
                .source_language
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.chars().count() <= 80)
            {
                config.source_language = source_language.to_owned();
            }
            if let Some(target_language) = req
                .target_language
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.chars().count() <= 80)
            {
                config.target_language = target_language.to_owned();
            }
            crate::translation::translate(&app, &config, &req.text).await
        }
        None => Err(AppError::new(
            ErrorCode::TranslationNotConfigured,
            "Translation settings have not been synchronized for this account.",
        )),
    };

    match &outcome {
        Ok(result) => emit_translation_log(
            &app,
            TranslationLogMeta {
                account_id: &req.account_id,
                purpose: &purpose,
                duration_ms: started.elapsed().as_millis(),
                text_chars,
            },
            true,
            result.cache_status.as_deref(),
            Some(&result.provider),
            Some(&result.model),
            None,
            None,
        ),
        Err(error) => emit_translation_log(
            &app,
            TranslationLogMeta {
                account_id: &req.account_id,
                purpose: &purpose,
                duration_ms: started.elapsed().as_millis(),
                text_chars,
            },
            false,
            None,
            None,
            None,
            Some(error.code().as_str()),
            Some(error.message()),
        ),
    }

    let (success, body) = match outcome {
        Ok(result) => (
            true,
            serde_json::to_string(&result).unwrap_or_else(|_| "{}".into()),
        ),
        Err(error) => {
            eprintln!(
                "[mc://translate-request] account={} code={} message={}",
                req.account_id,
                error.code(),
                error.message()
            );
            (
                false,
                serde_json::json!({ "code": error.code(), "message": error.message() }).to_string(),
            )
        }
    };

    return_translate_request(&app, &req, success, body);
}

fn return_translate_request(
    app: &AppHandle,
    req: &TranslateRequestPayload,
    success: bool,
    body: String,
) {
    let Some(webview) = app.get_webview(&panel_label(&req.account_id)) else {
        return;
    };
    let payload_literal = serde_json::to_string(&body).unwrap_or_else(|_| "\"\"".into());
    let script = format!(
        "(function(){{var m=window.__mcTranslateCallbacks;if(!m)return;var cb=m['{}'];if(cb)try{{cb({},{});}}catch(_e){{}}}})();",
        req.request_id, success, payload_literal
    );
    let _ = webview.eval(&script);
}

pub async fn handle_replace_composer_event(app: AppHandle, payload: String) {
    let Ok(req) = serde_json::from_str::<ReplaceComposerPayload>(&payload) else {
        return;
    };
    if req.request_id.is_empty()
        || !req.request_id.chars().all(|c| c.is_ascii_alphanumeric())
        || !is_safe_account_id(&req.account_id)
        || req.text.trim().is_empty()
        || req.text.chars().count() > 10_000
    {
        return;
    }

    let manager = app.state::<AccountPanelManager>();
    if !manager
        .panel_token_matches(&req.account_id, &req.token)
        .await
    {
        return;
    }

    let Some(webview) = app.get_webview(&panel_label(&req.account_id)) else {
        return;
    };
    if let Err(error) = webview.set_focus() {
        eprintln!(
            "[mc://replace-composer] account={} focus failed: {}",
            req.account_id, error
        );
        return;
    }
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    let outcome = crate::native_input::replace_focused_text(req.text.clone()).await;
    let (success, body) = match outcome {
        Ok(()) => (true, "{}".to_string()),
        Err(error) => {
            eprintln!(
                "[mc://replace-composer] account={} code={} message={}",
                req.account_id,
                error.code(),
                error.message()
            );
            (
                false,
                serde_json::json!({ "code": error.code(), "message": error.message() }).to_string(),
            )
        }
    };

    let payload_literal = serde_json::to_string(&body).unwrap_or_else(|_| "\"\"".into());
    let script = format!(
        "(function(){{var m=window.__mcReplaceCallbacks;if(!m)return;var cb=m['{}'];if(cb)try{{cb({},{});}}catch(_e){{}}}})();",
        req.request_id, success, payload_literal
    );
    let _ = webview.eval(&script);
}

pub async fn handle_panel_state_event(app: AppHandle, payload: String) {
    let Ok(parsed) = serde_json::from_str::<PanelStateEventPayload>(&payload) else {
        return;
    };
    if !is_safe_account_id(&parsed.account_id) {
        return;
    }
    if !matches!(
        parsed.state.as_str(),
        "starting" | "awaiting_qr" | "authenticated" | "closed" | "error"
    ) {
        return;
    }

    let manager = app.state::<AccountPanelManager>();
    if !manager
        .panel_token_matches(&parsed.account_id, &parsed.token)
        .await
    {
        return;
    }
    let reason_code = parsed
        .reason_code
        .as_deref()
        .filter(|value| {
            matches!(
                *value,
                "AUTH_EXPIRED"
                    | "AUTH_TIMEOUT"
                    | "ACCOUNT_NOT_READY"
                    | "PLATFORM_REJECTED"
                    | "INTERNAL_ERROR"
            )
        })
        .map(str::to_owned);
    let summary = parsed
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(160).collect::<String>());
    let _ = emit_state_to_main_with_unread(
        &app,
        &parsed.account_id,
        &parsed.state,
        parsed.unread_count,
        reason_code.as_deref(),
        summary.as_deref(),
    );
}
