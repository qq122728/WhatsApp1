use tauri::State;

use crate::{
    config::remote::RemoteConfigInput,
    error::AppResult,
    remote_control::{
        protocol::RemoteAccountSummary,
        service::{RemoteControlManager, RemoteControlStatus},
    },
};

#[tauri::command]
pub async fn remote_control_connect(
    manager: State<'_, RemoteControlManager>,
    config: RemoteConfigInput,
) -> AppResult<RemoteControlStatus> {
    manager.connect(config).await
}

#[tauri::command]
pub async fn remote_control_disconnect(
    manager: State<'_, RemoteControlManager>,
) -> AppResult<RemoteControlStatus> {
    Ok(manager.disconnect().await)
}

#[tauri::command]
pub async fn remote_control_status(
    manager: State<'_, RemoteControlManager>,
) -> AppResult<RemoteControlStatus> {
    Ok(manager.status().await)
}

#[tauri::command]
pub async fn remote_control_update_accounts(
    manager: State<'_, RemoteControlManager>,
    accounts: Vec<RemoteAccountSummary>,
) -> AppResult<RemoteControlStatus> {
    Ok(manager.update_accounts(accounts).await)
}
