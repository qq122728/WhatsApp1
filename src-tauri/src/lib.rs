mod account_panel;
mod commands;
mod config;
pub mod contracts;
pub mod error;
pub mod platform_sidecar;
pub mod remote_control;

use account_panel::AccountPanelManager;
use platform_sidecar::PlatformSidecarManager;
use remote_control::service::RemoteControlManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RemoteControlManager::default())
        .manage(PlatformSidecarManager::default())
        .manage(AccountPanelManager::default())
        .on_window_event(|window, event| {
            if !matches!(
                event,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                return;
            }

            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let manager = app.state::<AccountPanelManager>();
                let _ = manager.resize_all(&app).await;
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::remote_config::validate_remote_config,
            commands::remote_control::remote_control_connect,
            commands::remote_control::remote_control_disconnect,
            commands::remote_control::remote_control_status,
            commands::whatsapp::whatsapp_begin_login,
            commands::whatsapp::whatsapp_login_status,
            commands::whatsapp::whatsapp_close_login,
            commands::panels::wa_panel_open,
            commands::panels::wa_panel_show,
            commands::panels::wa_panel_hide,
            commands::panels::wa_panel_set_bounds,
            commands::panels::wa_panel_close,
            commands::panels::wa_account_reset_session,
            commands::panels::wa_account_delete,
            commands::panels::wa_panel_resize,
            commands::panels::wa_panel_list,
            commands::panels::wa_panel_report_state,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MultiConnect")
}
