use std::collections::HashMap;

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
            if (previewEl) previewEl.remove();
        }} catch (_previewError) {{}}
    }};

    /* ---------- Auth state reporting ---------- */
    var _last = '';
    function _mcCheck() {{
        var auth = !!(
            document.querySelector('#pane-side') ||
            document.querySelector('[data-testid="chat-list"]') ||
            document.querySelector('[aria-label*="Chat list"]') ||
            document.querySelector('[aria-label*="聊天列表"]')
        );
        var qr = !!(
            document.querySelector('canvas[aria-label*="QR"]') ||
            document.querySelector('[data-testid="qrcode"]') ||
            document.querySelector('canvas')
        );
        var state = auth ? 'authenticated' : qr ? 'awaiting_qr' : 'starting';
        if (state !== _last) {{
            _last = state;
            try {{
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                    event: 'mc://panel-state',
                    payload: {{
                        accountId: MC_ACCOUNT_ID,
                        token: MC_PANEL_TOKEN,
                        state: state
                    }}
                }});
            }} catch (_e) {{}}
        }}
    }}
    mcSetInterval(_mcCheck, 2000);

    /* ---------- Translation overlay ---------- */
    window.__MC_TRANSLATION_CONFIG__ = window.__MC_TRANSLATION_CONFIG__ || {{
        translationChannel: 'GPT-4O-MINI',
        targetLanguage: '英语（美国）',
        sourceLanguage: '中文（简体）',
        sendTranslation: false,
        receiveTranslation: false,
        fontSize: 16,
        fontColor: '#18A058'
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
            '}}',
            '.__mc-incoming-translation.loading {{',
            '  color: #6d7780;',
            '  background: rgba(244, 247, 249, 0.95);',
            '  border-left-color: rgba(117, 130, 142, 0.35);',
            '}}',
            '.__mc-incoming-translation.error {{',
            '  color: #b53340;',
            '  background: rgba(255, 245, 246, 0.96);',
            '  border-left-color: rgba(198, 58, 70, 0.45);',
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

    function containsCjk(text) {{
        return /[\u3400-\u9fff]/.test(text || '');
    }}

    function shouldGateRawSourceSend(text, config) {{
        return !!text && config.sendTranslation !== false && containsCjk(text);
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
    var TRANSLATION_CACHE_LIMIT = 80;
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
            config.sourceLanguage || '',
            config.targetLanguage || '',
            text
        ].join('|');
    }}

    function rememberTranslation(key, payload) {{
        if (!key || !payload || !payload.translatedText) return;
        if (translationCache.has(key)) translationCache.delete(key);
        translationCache.set(key, payload);
        while (translationCache.size > TRANSLATION_CACHE_LIMIT) {{
            var oldest = translationCache.keys().next().value;
            translationCache.delete(oldest);
        }}
    }}

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
        if (state === 'ready' || state === 'loading') {{
            host.textContent = message;
            return;
        }}
        var label = document.createElement('span');
        label.textContent = message || '未翻译';
        host.appendChild(label);
        if (state === 'idle' || state === 'error') {{
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = state === 'error' ? '重试翻译' : '翻译';
            button.addEventListener('click', function(event) {{
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (typeof onRetry === 'function') onRetry();
            }});
            host.appendChild(document.createTextNode(' '));
            host.appendChild(button);
        }}
    }}

    function requestIncomingTranslation(message, text, config, automatic) {{
        var host = incomingHost(message);
        var incomingConfig = incomingTranslationConfig(config);
        var cacheKey = translationCacheKey(text, incomingConfig);
        var cached = translationCache.get(cacheKey);
        host.setAttribute('data-source', text);
        if (cached && cached.translatedText) {{
            renderIncomingHost(host, 'ready', cached.translatedText);
            return;
        }}
        if (host.getAttribute('data-state') === 'loading') return;
        renderIncomingHost(host, 'loading', '正在翻译成中文…');
        var autoTracked = !!automatic;
        if (autoTracked) incomingAutoInFlight++;
        function finishAuto() {{
            if (!autoTracked) return;
            autoTracked = false;
            incomingAutoInFlight = Math.max(0, incomingAutoInFlight - 1);
        }}
        requestPanelTranslation(text, incomingConfig, TRANSLATION_REQUEST_TIMEOUT_MS)
            .then(function(result) {{
                if (host.getAttribute('data-source') !== text) {{
                    finishAuto();
                    return;
                }}
                if (result.success && result.payload && result.payload.translatedText) {{
                    rememberTranslation(cacheKey, result.payload);
                    renderIncomingHost(host, 'ready', result.payload.translatedText);
                    finishAuto();
                    return;
                }}
                renderIncomingHost(
                    host,
                    'error',
                    translationErrorMessage(result.payload),
                    function() {{ requestIncomingTranslation(message, text, config, false); }}
                );
                finishAuto();
            }})
            .catch(function() {{
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
            var cached = translationCache.get(translationCacheKey(text, incomingConfig));
            if (cached && cached.translatedText) {{
                renderIncomingHost(host, 'ready', cached.translatedText);
                return;
            }}
            var state = host.getAttribute('data-state') || 'idle';
            if (state === 'ready' || state === 'loading' || state === 'error') return;
            if (
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

        var input = findComposer();
        var currentText = composerText(input);
        var config = translationConfig();
        if (previewDismissedSource === currentText) {{
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
        var input = findComposer();
        if (!isEventInsideComposer(event, input)) return;
        var config = translationConfig();
        if (config.sendTranslation === false) return;

        var currentText = composerText(input);
        if (!currentText) return;

        if (previewDismissedSource === currentText) {{
            return;
        }}

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        lastReplaceGestureAt = Date.now();

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
            var cached = translationCache.get(cacheKey);
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
                        text: text
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
    mcAddListener(document, 'click', handleSendClick, true);
    mcAddListener(document, 'keydown', handleComposerEnter, true);
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

        // Only one account panel is visible at a time.
        {
            let panels = self.panels.lock().await;
            for lbl in panels.values() {
                if let Some(wv) = app.get_webview(lbl) {
                    let _ = wv.hide();
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
            .hide()
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

        // Hide all other child webviews.
        let panels = self.panels.lock().await;
        for (id, lbl) in panels.iter() {
            if id != account_id {
                if let Some(wv) = app.get_webview(lbl) {
                    let _ = wv.hide();
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
            wv.hide().map_err(|error| {
                AppError::new(
                    ErrorCode::WaPanelFailed,
                    format!("Could not hide the WhatsApp panel: {error}"),
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
                .eval(format!("window.__MC_TRANSLATION_CONFIG__ = {serialized};"))
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

pub fn emit_state_to_main(app: &AppHandle, account_id: &str, state: &str) -> AppResult<()> {
    host_webview(app)?
        .emit(
            "wa-panel-state",
            serde_json::json!({ "accountId": account_id, "state": state }),
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

#[derive(serde::Deserialize)]
struct TranslateRequestPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    token: String,
    text: String,
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

    let manager = app.state::<AccountPanelManager>();
    if !manager
        .panel_token_matches(&req.account_id, &req.token)
        .await
    {
        return;
    }
    let outcome = match manager.translation_config(&req.account_id).await {
        Some(mut config) => {
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
    let _ = emit_state_to_main(&app, &parsed.account_id, &parsed.state);
}
