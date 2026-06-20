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

    /* ---------- Mock translation overlay ---------- */
    var STYLE_ID = '__mc_translation_style';
    function injectStyle() {{
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.__mc-translation {{',
            '  margin-top: 4px;',
            '  padding: 6px 8px;',
            '  border-top: 1px dashed rgba(94, 112, 231, 0.35);',
            '  color: #5d6fdc;',
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
            '  background: #5e70e7;',
            '  color: white;',
            '  text-align: center;',
            '  font-size: 10px;',
            '  line-height: 16px;',
            '  font-weight: 700;',
            '  margin-right: 4px;',
            '}}',
            '.__mc-preview {{',
            '  position: absolute;',
            '  left: 16px;',
            '  right: 16px;',
            '  bottom: 64px;',
            '  padding: 8px 12px;',
            '  border-radius: 8px;',
            '  background: rgba(94, 112, 231, 0.95);',
            '  color: white;',
            '  font-size: 13px;',
            '  line-height: 1.4;',
            '  box-shadow: 0 6px 18px rgba(94, 112, 231, 0.35);',
            '  z-index: 9999;',
            '  pointer-events: none;',
            '  display: flex;',
            '  align-items: flex-start;',
            '  gap: 8px;',
            '}}',
            '.__mc-preview::before {{',
            '  content: "Mock 翻译预览";',
            '  flex-shrink: 0;',
            '  padding: 2px 6px;',
            '  border-radius: 4px;',
            '  background: rgba(255, 255, 255, 0.25);',
            '  font-size: 10px;',
            '  font-weight: 600;',
            '}}'
        ].join('\n');
        document.head.appendChild(style);
    }}

    function mockTranslate(text) {{
        if (!text) return '';
        var hasCjk = /[一-鿿]/.test(text);
        if (hasCjk) {{
            return '[Mock EN] ' + text.replace(/[一-鿿]/g, '*');
        }}
        return '[Mock 中文] ' + text + '（模拟翻译占位）';
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
    function ensurePreview() {{
        if (previewEl && document.body.contains(previewEl)) return previewEl;
        previewEl = document.createElement('div');
        previewEl.className = '__mc-preview';
        previewEl.style.display = 'none';
        document.body.appendChild(previewEl);
        return previewEl;
    }}

    function updatePreview() {{
        var input = document.querySelector('footer [contenteditable="true"]') ||
                    document.querySelector('[data-tab="10"][contenteditable="true"]');
        var el = ensurePreview();
        if (!input) {{ el.style.display = 'none'; return; }}
        var text = (input.innerText || '').trim();
        if (!text) {{ el.style.display = 'none'; return; }}
        el.style.display = 'flex';
        el.textContent = '';
        var span = document.createElement('span');
        span.textContent = mockTranslate(text);
        el.appendChild(span);
    }}

    function tick() {{
        try {{ injectStyle(); }} catch (_) {{}}
        try {{ annotateMessages(); }} catch (_) {{}}
        try {{ updatePreview(); }} catch (_) {{}}
    }}
    setInterval(tick, 800);
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
