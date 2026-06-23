mod account_panel;
mod commands;
mod config;
pub mod contracts;
mod deepl_config;
pub mod error;
mod google_config;
mod native_input;
mod openai_config;
pub mod platform_sidecar;
pub mod remote_control;
mod translation;

use account_panel::{
    handle_panel_state_event, handle_replace_composer_event, handle_translate_request_event,
    AccountPanelManager,
};
use platform_sidecar::PlatformSidecarManager;
use remote_control::service::RemoteControlManager;
use tauri::{Listener, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RemoteControlManager::default())
        .manage(PlatformSidecarManager::default())
        .manage(AccountPanelManager::default())
        .setup(|app| {
            let translate_handle = app.handle().clone();
            app.listen("mc://translate-request", move |event| {
                let handle = translate_handle.clone();
                let payload = event.payload().to_owned();
                tauri::async_runtime::spawn(async move {
                    handle_translate_request_event(handle, payload).await;
                });
            });

            let state_handle = app.handle().clone();
            app.listen("mc://panel-state", move |event| {
                let handle = state_handle.clone();
                let payload = event.payload().to_owned();
                tauri::async_runtime::spawn(async move {
                    handle_panel_state_event(handle, payload).await;
                });
            });

            let replace_handle = app.handle().clone();
            app.listen("mc://replace-composer", move |event| {
                let handle = replace_handle.clone();
                let payload = event.payload().to_owned();
                tauri::async_runtime::spawn(async move {
                    handle_replace_composer_event(handle, payload).await;
                });
            });
            Ok(())
        })
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
            commands::app::app_diagnostics_snapshot,
            commands::app::app_diagnostics_export,
            commands::app::translation_cache_stats,
            commands::app::translation_cache_clear,
            commands::deepl_config::deepl_config_clear,
            commands::deepl_config::deepl_config_save,
            commands::deepl_config::deepl_config_status,
            commands::deepl_config::deepl_config_test,
            commands::google_config::google_config_clear,
            commands::google_config::google_config_save,
            commands::google_config::google_config_status,
            commands::google_config::google_config_test,
            commands::openai_config::openai_config_clear,
            commands::openai_config::openai_config_save,
            commands::openai_config::openai_config_status,
            commands::openai_config::openai_config_test,
            commands::remote_config::validate_remote_config,
            commands::remote_control::remote_control_connect,
            commands::remote_control::remote_control_disconnect,
            commands::remote_control::remote_control_status,
            commands::remote_control::remote_control_update_accounts,
            commands::whatsapp::whatsapp_begin_login,
            commands::whatsapp::whatsapp_login_status,
            commands::whatsapp::whatsapp_close_login,
            commands::panels::wa_panel_open,
            commands::panels::wa_panel_show,
            commands::panels::wa_panel_hide,
            commands::panels::wa_panel_set_bounds,
            commands::panels::wa_panel_set_translation_config,
            commands::panels::wa_panel_close,
            commands::panels::wa_account_reset_session,
            commands::panels::wa_account_delete,
            commands::panels::wa_panel_resize,
            commands::panels::wa_panel_list,
            commands::panels::wa_account_list_profiles,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MultiConnect")
}
