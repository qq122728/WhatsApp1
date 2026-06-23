use tauri::AppHandle;

use crate::{
    deepl_config::{self, DeepLConfigStatus, DeepLConnectionTest},
    error::AppResult,
};

#[tauri::command]
pub fn deepl_config_status(app: AppHandle) -> AppResult<DeepLConfigStatus> {
    deepl_config::status(&app)
}

#[tauri::command]
pub fn deepl_config_save(app: AppHandle, api_key: String) -> AppResult<DeepLConfigStatus> {
    deepl_config::save_api_key(&app, api_key)
}

#[tauri::command]
pub fn deepl_config_clear(app: AppHandle) -> AppResult<DeepLConfigStatus> {
    deepl_config::clear_api_key(&app)
}

#[tauri::command]
pub async fn deepl_config_test(
    app: AppHandle,
    api_key: Option<String>,
) -> AppResult<DeepLConnectionTest> {
    deepl_config::test_api_key(&app, api_key).await
}
