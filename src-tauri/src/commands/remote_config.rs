use crate::{
    config::remote::{
        validate_remote_config as validate, RemoteConfigInput, RemoteConfigValidationResult,
    },
    error::AppResult,
};

#[tauri::command]
pub fn validate_remote_config(
    config: RemoteConfigInput,
) -> AppResult<RemoteConfigValidationResult> {
    validate(config).map(RemoteConfigValidationResult::from)
}
