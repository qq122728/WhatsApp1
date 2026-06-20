use tauri::AppHandle;

use crate::{
    error::AppResult,
    openai_config::{self, OpenAiConfigStatus, OpenAiConnectionTest},
};

#[tauri::command]
pub fn openai_config_status(app: AppHandle) -> AppResult<OpenAiConfigStatus> {
    openai_config::status(&app)
}

#[tauri::command]
pub fn openai_config_save(app: AppHandle, api_key: String) -> AppResult<OpenAiConfigStatus> {
    openai_config::save_api_key(&app, api_key)
}

#[tauri::command]
pub fn openai_config_clear(app: AppHandle) -> AppResult<OpenAiConfigStatus> {
    openai_config::clear_api_key(&app)
}

#[tauri::command]
pub async fn openai_config_test(
    app: AppHandle,
    api_key: Option<String>,
    model: Option<String>,
) -> AppResult<OpenAiConnectionTest> {
    openai_config::test_api_key(&app, api_key, model).await
}
