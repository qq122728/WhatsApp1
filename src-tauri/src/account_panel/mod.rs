use std::collections::HashMap;

use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position,
    Rect, Size, WebviewUrl,
};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult, ErrorCode};

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

fn init_script(account_id: &str) -> String {
    format!(
        r#"
(function() {{
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
                window.__TAURI_INTERNALS__.invoke('wa_panel_report_state', {{
                    accountId: '{account_id}',
                    state: state
                }});
            }} catch (_e) {{}}
        }}
    }}
    setInterval(_mcCheck, 2000);

    /* ---------- Translation overlay ---------- */
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

    function mockTranslate(text) {{
        if (!text) return '';
        var hasCjk = /[\u3400-\u9fff]/.test(text);
        if (hasCjk) {{
            return text.replace(/[\u3400-\u9fff]/g, '*');
        }}
        return text + '（测试译文）';
    }}

    function annotateMessages() {{
        var bubbles = document.querySelectorAll('.message-in:not([data-mc-translated])');
        bubbles.forEach(function(b) {{
            var textEl = b.querySelector('.selectable-text span') ||
                         b.querySelector('span.selectable-text') ||
                         b.querySelector('[dir="ltr"] span') ||
                         b.querySelector('[dir="rtl"] span');
            if (!textEl || !textEl.textContent) return;
            var original = textEl.textContent.trim();
            if (!original) return;
            var tip = document.createElement('div');
            tip.className = '__mc-translation';
            tip.textContent = mockTranslate(original);
            var bubble = b.querySelector('.copyable-text') || b;
            bubble.appendChild(tip);
            b.setAttribute('data-mc-translated', '1');
        }});
    }}

    var previewEl = null;
    var previewInput = null;
    var previewSource = '';
    var previewTranslation = '';
    var previewDismissedSource = '';
    var previewTimer = 0;
    var bypassNextSend = false;

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

    function setComposerText(input, value) {{
        input.focus();
        var selection = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
        var inserted = false;
        try {{
            inserted = document.execCommand('insertText', false, value);
        }} catch (_error) {{}}
        if (!inserted) {{
            input.textContent = value;
            var event = typeof InputEvent === 'function'
                ? new InputEvent('input', {{
                    bubbles: true,
                    inputType: 'insertText',
                    data: value
                }})
                : new Event('input', {{ bubbles: true }});
            input.dispatchEvent(event);
        }}
    }}

    function findSendButton(target) {{
        if (!target || !target.closest) return null;
        var button = target.closest(
            'button[aria-label="Send"],' +
            'button[aria-label="发送"],' +
            'button[data-testid="compose-btn-send"],' +
            '[data-testid="send"]'
        );
        if (button) return button;
        var icon = target.closest('[data-icon="send"]');
        return icon ? icon.closest('button') : null;
    }}

    function handleSendClick(event) {{
        var sendButton = findSendButton(event.target);
        if (!sendButton || bypassNextSend) return;

        var input = findComposer();
        var currentText = input ? (input.innerText || '').trim() : '';
        var previewVisible =
            previewEl &&
            previewEl.style.display !== 'none' &&
            !previewEl.classList.contains('loading');
        var canSendTranslation =
            previewVisible &&
            previewTranslation &&
            currentText === previewSource;
        if (!canSendTranslation) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        previewDismissedSource = previewTranslation;
        setComposerText(input, previewTranslation);
        previewEl.style.display = 'none';

        window.setTimeout(function() {{
            var replacedText = (input.innerText || '').trim();
            if (replacedText !== previewTranslation) {{
                previewDismissedSource = '';
                renderPreview(input, previewSource, false);
                return;
            }}
            bypassNextSend = true;
            sendButton.click();
            window.setTimeout(function() {{
                bypassNextSend = false;
            }}, 0);
        }}, 80);
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
        mode.textContent = '测试模式';
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
            previewDismissedSource = previewTranslation;
            setComposerText(previewInput, previewTranslation);
            previewEl.style.display = 'none';
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
        hint.textContent = '替换后仍需手动发送';
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

    function renderPreview(input, text, loading) {{
        var el = ensurePreview();
        previewInput = input;
        var body = el.querySelector('.__mc-preview-body');
        var language = el.querySelector('.__mc-preview-language');
        var hasCjk = /[\u3400-\u9fff]/.test(text);
        language.textContent = hasCjk ? '英语' : '中文';
        body.textContent = loading ? '正在生成译文…' : previewTranslation;
        el.classList.toggle('loading', loading);
        el.classList.toggle('long', !loading && previewTranslation.length > 120);
        if (loading || previewTranslation.length <= 120) {{
            el.classList.remove('expanded');
            el.querySelector('.__mc-preview-expand').textContent = '展开';
        }}
        positionPreview(input);
        el.style.display = 'block';
    }}

    function updatePreview() {{
        var input = findComposer();
        var el = ensurePreview();
        if (!input) {{
            el.style.display = 'none';
            return;
        }}
        var text = (input.innerText || '').trim();
        if (!text) {{
            clearTimeout(previewTimer);
            previewSource = '';
            previewTranslation = '';
            previewDismissedSource = '';
            el.style.display = 'none';
            return;
        }}
        if (previewDismissedSource === text) {{
            el.style.display = 'none';
            return;
        }}
        if (previewSource !== text) {{
            clearTimeout(previewTimer);
            previewSource = text;
            previewTranslation = '';
            renderPreview(input, text, true);
            previewTimer = setTimeout(function() {{
                if (previewSource !== text) return;
                previewTranslation = mockTranslate(text);
                renderPreview(input, text, false);
            }}, 400);
            return;
        }}
        positionPreview(input);
    }}

    function tick() {{
        try {{ injectStyle(); }} catch (_) {{}}
        try {{ annotateMessages(); }} catch (_) {{}}
        try {{ updatePreview(); }} catch (_) {{}}
    }}
    document.addEventListener('click', handleSendClick, true);
    setInterval(tick, 250);
}})();
"#,
        account_id = account_id
    )
}

#[derive(Default)]
pub struct AccountPanelManager {
    panels: Mutex<HashMap<String, String>>,
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

        let script = init_script(account_id);

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
        Ok(())
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
