use tauri::AppHandle;

use crate::{
    error::AppResult,
    google_config::{self, GoogleConfigStatus, GoogleConnectionTest},
};

#[tauri::command]
pub fn google_config_status(app: AppHandle) -> AppResult<GoogleConfigStatus> {
    google_config::status(&app)
}

#[tauri::command]
pub fn google_config_save(app: AppHandle, api_key: String) -> AppResult<GoogleConfigStatus> {
    google_config::save_api_key(&app, api_key)
}

#[tauri::command]
pub fn google_config_clear(app: AppHandle) -> AppResult<GoogleConfigStatus> {
    google_config::clear_api_key(&app)
}

#[tauri::command]
pub async fn google_config_test(
    app: AppHandle,
    api_key: Option<String>,
) -> AppResult<GoogleConnectionTest> {
    google_config::test_api_key(&app, api_key).await
}
