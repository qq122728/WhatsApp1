use tauri::{AppHandle, State};

use crate::{
    account_panel::{emit_state_to_main, AccountPanelManager},
    error::AppResult,
};

fn validate_account_id(id: &str) -> AppResult<()> {
    use crate::error::{AppError, ErrorCode};
    let valid = (8..=64).contains(&id.len())
        && id
            .chars()
            .enumerate()
            .all(|(i, c)| c.is_ascii_alphanumeric() || (i > 0 && matches!(c, '_' | '-')));
    if valid {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::InvalidArgument,
            "Account ID must be 8-64 safe alphanumeric characters.",
        ))
    }
}

/// Open (or focus) the embedded WhatsApp panel for an account.
#[tauri::command]
pub async fn wa_panel_open(
    app: AppHandle,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    validate_account_id(&account_id)?;
    manager.open(&app, &account_id).await
}

/// Show a panel that has already been opened (and switch away from others).
#[tauri::command]
pub async fn wa_panel_show(
    app: AppHandle,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    validate_account_id(&account_id)?;
    manager.show(&app, &account_id).await
}

/// Hide the panel (keeps the webview alive — session is preserved).
#[tauri::command]
pub async fn wa_panel_hide(
    app: AppHandle,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    validate_account_id(&account_id)?;
    manager.hide(&app, &account_id).await
}

/// Set the exact child-webview rectangle measured from the React host element.
#[tauri::command]
pub async fn wa_panel_set_bounds(
    app: AppHandle,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    validate_account_id(&account_id)?;
    manager
        .set_bounds(&app, &account_id, x, y, width, height)
        .await
}

/// Close and destroy the panel for this account.
#[tauri::command]
pub async fn wa_panel_close(
    app: AppHandle,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    validate_account_id(&account_id)?;
    manager.close(&app, &account_id).await
}

/// Resize all open panels to match the current window size.
/// Call this from React whenever the window is resized.
#[tauri::command]
pub async fn wa_panel_resize(
    app: AppHandle,
    manager: State<'_, AccountPanelManager>,
) -> AppResult<()> {
    manager.resize_all(&app).await
}

/// List all open panel account IDs.
#[tauri::command]
pub async fn wa_panel_list(manager: State<'_, AccountPanelManager>) -> AppResult<Vec<String>> {
    Ok(manager.list_open().await)
}

/// Called by the initialization script injected into the child webview.
/// Receives auth state changes and forwards them as Tauri events to the main window.
#[tauri::command]
pub async fn wa_panel_report_state(
    app: AppHandle,
    account_id: String,
    state: String,
) -> AppResult<()> {
    emit_state_to_main(&app, &account_id, &state)
}
