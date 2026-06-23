use tauri::{AppHandle, Manager, State, Webview};

use crate::{
    account_panel::{is_safe_account_id, AccountPanelManager},
    error::{AppError, AppResult, ErrorCode},
    translation::TranslationConfig,
};

fn validate_account_id(id: &str) -> AppResult<()> {
    if is_safe_account_id(id) {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::InvalidArgument,
            "Account ID must be 8-64 safe alphanumeric characters.",
        ))
    }
}

fn ensure_host_caller(caller: &Webview) -> AppResult<()> {
    if caller.label().starts_with("wa-") {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "Panel commands can only be called by the client host.",
        ));
    }
    Ok(())
}

/// Open (or focus) the embedded WhatsApp panel for an account.
#[tauri::command]
pub async fn wa_panel_open(
    app: AppHandle,
    caller: Webview,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    ensure_host_caller(&caller)?;
    validate_account_id(&account_id)?;
    manager.open(&app, &account_id).await
}

/// Show a panel that has already been opened (and switch away from others).
#[tauri::command]
pub async fn wa_panel_show(
    app: AppHandle,
    caller: Webview,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    ensure_host_caller(&caller)?;
    validate_account_id(&account_id)?;
    manager.show(&app, &account_id).await
}

/// Hide the panel (keeps the webview alive — session is preserved).
#[tauri::command]
pub async fn wa_panel_hide(
    app: AppHandle,
    caller: Webview,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    ensure_host_caller(&caller)?;
    validate_account_id(&account_id)?;
    manager.hide(&app, &account_id).await
}

/// Set the exact child-webview rectangle measured from the React host element.
#[tauri::command]
pub async fn wa_panel_set_bounds(
    app: AppHandle,
    caller: Webview,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    ensure_host_caller(&caller)?;
    validate_account_id(&account_id)?;
    manager
        .set_bounds(&app, &account_id, x, y, width, height)
        .await
}

/// Update the non-secret translation settings for one account.
#[tauri::command]
pub async fn wa_panel_set_translation_config(
    app: AppHandle,
    caller: tauri::Webview,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
    config: TranslationConfig,
) -> AppResult<()> {
    validate_account_id(&account_id)?;
    ensure_host_caller(&caller)?;
    manager
        .set_translation_config(&app, &account_id, config)
        .await
}

/// Close and destroy the panel for this account.
#[tauri::command]
pub async fn wa_panel_close(
    app: AppHandle,
    caller: Webview,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    ensure_host_caller(&caller)?;
    validate_account_id(&account_id)?;
    manager.close(&app, &account_id).await
}

/// Close the panel and clear only this account's local WhatsApp session.
#[tauri::command]
pub async fn wa_account_reset_session(
    app: AppHandle,
    caller: Webview,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    ensure_host_caller(&caller)?;
    validate_account_id(&account_id)?;
    manager.clear_account_data(&app, &account_id).await
}

/// Permanently remove this account's local WhatsApp session data.
///
/// Account metadata is removed by the frontend only after this command succeeds.
#[tauri::command]
pub async fn wa_account_delete(
    app: AppHandle,
    caller: Webview,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    ensure_host_caller(&caller)?;
    validate_account_id(&account_id)?;
    manager.clear_account_data(&app, &account_id).await?;
    manager.remove_translation_config(&account_id).await;
    Ok(())
}

/// Resize all open panels to match the current window size.
/// Call this from React whenever the window is resized.
#[tauri::command]
pub async fn wa_panel_resize(
    app: AppHandle,
    caller: Webview,
    manager: State<'_, AccountPanelManager>,
) -> AppResult<()> {
    ensure_host_caller(&caller)?;
    manager.resize_all(&app).await
}

/// List all open panel account IDs.
#[tauri::command]
pub async fn wa_panel_list(
    caller: Webview,
    manager: State<'_, AccountPanelManager>,
) -> AppResult<Vec<String>> {
    ensure_host_caller(&caller)?;
    Ok(manager.list_open().await)
}

/// List WhatsApp account profile directories that already exist on this device.
#[tauri::command]
pub async fn wa_account_list_profiles(app: AppHandle, caller: Webview) -> AppResult<Vec<String>> {
    ensure_host_caller(&caller)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| {
            AppError::new(
                ErrorCode::WaPanelFailed,
                "App data directory could not be resolved.",
            )
        })?
        .join("panels")
        .join("whatsapp");

    let mut entries = match tokio::fs::read_dir(&root).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(AppError::new(
                ErrorCode::WaPanelFailed,
                format!("Could not read WhatsApp profiles: {error}"),
            ));
        }
    };

    let mut ids = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|error| {
        AppError::new(
            ErrorCode::WaPanelFailed,
            format!("Could not scan WhatsApp profiles: {error}"),
        )
    })? {
        let is_dir = entry
            .file_type()
            .await
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false);
        if !is_dir {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with("wa_") && is_safe_account_id(&id) {
            ids.push(id);
        }
    }
    ids.sort();
    Ok(ids)
}
