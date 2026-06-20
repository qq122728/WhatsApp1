use tauri::{AppHandle, Manager, State};

use crate::{
    error::{AppError, AppResult, ErrorCode},
    platform_sidecar::{PlatformSidecarManager, WhatsAppStatus},
};

fn whatsapp_profile_dir(app: &AppHandle, account_id: &str) -> AppResult<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("profiles").join("whatsapp").join(account_id))
        .map_err(|_| {
            AppError::new(
                ErrorCode::DiskFull,
                "The application data directory could not be resolved.",
            )
        })
}

#[tauri::command]
pub async fn whatsapp_begin_login(
    app: AppHandle,
    manager: State<'_, PlatformSidecarManager>,
    account_id: String,
) -> AppResult<WhatsAppStatus> {
    let profile_dir = whatsapp_profile_dir(&app, &account_id)?;
    manager
        .start_whatsapp_login(&account_id, &profile_dir)
        .await
}

#[tauri::command]
pub async fn whatsapp_login_status(
    manager: State<'_, PlatformSidecarManager>,
    account_id: String,
) -> AppResult<WhatsAppStatus> {
    manager.whatsapp_status(&account_id).await
}

#[tauri::command]
pub async fn whatsapp_close_login(
    manager: State<'_, PlatformSidecarManager>,
    account_id: String,
) -> AppResult<WhatsAppStatus> {
    manager.close_whatsapp(&account_id).await
}
