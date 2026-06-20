use tauri::{AppHandle, State};

use crate::{
    account_panel::AccountPanelManager,
    error::{AppError, AppResult, ErrorCode},
    translation::TranslationConfig,
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
    if caller.label().starts_with("wa-") {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "Translation settings can only be changed by the client host.",
        ));
    }
    manager
        .set_translation_config(&app, &account_id, config)
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

/// Close the panel and clear only this account's local WhatsApp session.
#[tauri::command]
pub async fn wa_account_reset_session(
    app: AppHandle,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
    validate_account_id(&account_id)?;
    manager.clear_account_data(&app, &account_id).await
}

/// Permanently remove this account's local WhatsApp session data.
///
/// Account metadata is removed by the frontend only after this command succeeds.
#[tauri::command]
pub async fn wa_account_delete(
    app: AppHandle,
    manager: State<'_, AccountPanelManager>,
    account_id: String,
) -> AppResult<()> {
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
    manager: State<'_, AccountPanelManager>,
) -> AppResult<()> {
    manager.resize_all(&app).await
}

/// List all open panel account IDs.
#[tauri::command]
pub async fn wa_panel_list(manager: State<'_, AccountPanelManager>) -> AppResult<Vec<String>> {
    Ok(manager.list_open().await)
}
