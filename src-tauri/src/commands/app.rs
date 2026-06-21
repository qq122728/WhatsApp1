use std::{env, fs, path::PathBuf};

use chrono::Utc;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{
    error::{AppError, AppResult, ErrorCode},
    openai_config,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    description: &'static str,
    runtime: &'static str,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    app_info_payload()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsPaths {
    app_config_dir: Option<String>,
    app_data_dir: Option<String>,
    app_cache_dir: Option<String>,
    app_log_dir: Option<String>,
    desktop_dir: Option<String>,
    current_exe: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSystem {
    os: &'static str,
    arch: &'static str,
    family: &'static str,
    build_profile: &'static str,
    process_id: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsEnvironment {
    has_openai_api_key: bool,
    has_browser_override: bool,
    has_sidecar_override: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsOpenAi {
    configured: bool,
    source: String,
    storage: String,
    masked_key: Option<String>,
    updated_at: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDiagnostics {
    generated_at: String,
    app: AppInfo,
    system: DiagnosticsSystem,
    environment: DiagnosticsEnvironment,
    open_ai: DiagnosticsOpenAi,
    paths: DiagnosticsPaths,
    client_context: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExportResult {
    path: String,
    file_name: String,
    diagnostics: AppDiagnostics,
}

#[tauri::command]
pub fn app_diagnostics_snapshot(
    app: AppHandle,
    client_context: Option<Value>,
) -> AppDiagnostics {
    build_diagnostics(&app, client_context)
}

#[tauri::command]
pub fn app_diagnostics_export(
    app: AppHandle,
    client_context: Option<Value>,
) -> AppResult<DiagnosticsExportResult> {
    let diagnostics = build_diagnostics(&app, client_context);
    let export_dir = app
        .path()
        .desktop_dir()
        .or_else(|_| app.path().app_config_dir())
        .map_err(|_| {
            AppError::new(
                ErrorCode::DiskFull,
                "Diagnostics export directory could not be resolved.",
            )
        })?;

    fs::create_dir_all(&export_dir).map_err(|_| {
        AppError::new(
            ErrorCode::DiskFull,
            "Diagnostics export directory could not be created.",
        )
    })?;

    let file_name = format!(
        "MultiConnect-diagnostics-{}.json",
        Utc::now().format("%Y%m%d-%H%M%SZ")
    );
    let path = export_dir.join(&file_name);
    let raw = serde_json::to_string_pretty(&diagnostics).map_err(|_| {
        AppError::new(
            ErrorCode::InvalidArgument,
            "Diagnostics data could not be serialized.",
        )
    })?;

    fs::write(&path, raw).map_err(|_| {
        AppError::new(
            ErrorCode::DiskFull,
            "Diagnostics file could not be written.",
        )
    })?;

    Ok(DiagnosticsExportResult {
        path: path_to_string(&path),
        file_name,
        diagnostics,
    })
}

fn app_info_payload() -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
        description: env!("CARGO_PKG_DESCRIPTION"),
        runtime: "tauri",
    }
}

fn build_diagnostics(app: &AppHandle, client_context: Option<Value>) -> AppDiagnostics {
    AppDiagnostics {
        generated_at: Utc::now().to_rfc3339(),
        app: app_info_payload(),
        system: DiagnosticsSystem {
            os: env::consts::OS,
            arch: env::consts::ARCH,
            family: env::consts::FAMILY,
            build_profile: if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            },
            process_id: std::process::id(),
        },
        environment: DiagnosticsEnvironment {
            has_openai_api_key: env_var_present("OPENAI_API_KEY"),
            has_browser_override: env_var_present("MULTICONNECT_BROWSER_EXECUTABLE"),
            has_sidecar_override: env_var_present("MULTICONNECT_SIDECAR_SCRIPT"),
        },
        open_ai: openai_diagnostics(app),
        paths: DiagnosticsPaths {
            app_config_dir: app.path().app_config_dir().ok().map(|path| path_to_string(&path)),
            app_data_dir: app.path().app_data_dir().ok().map(|path| path_to_string(&path)),
            app_cache_dir: app.path().app_cache_dir().ok().map(|path| path_to_string(&path)),
            app_log_dir: app.path().app_log_dir().ok().map(|path| path_to_string(&path)),
            desktop_dir: app.path().desktop_dir().ok().map(|path| path_to_string(&path)),
            current_exe: env::current_exe().ok().map(|path| path_to_string(&path)),
        },
        client_context,
    }
}

fn openai_diagnostics(app: &AppHandle) -> DiagnosticsOpenAi {
    match openai_config::status(app) {
        Ok(status) => DiagnosticsOpenAi {
            configured: status.configured,
            source: status.source.to_owned(),
            storage: status.storage.to_owned(),
            masked_key: status.masked_key,
            updated_at: status.updated_at,
            error: None,
        },
        Err(error) => DiagnosticsOpenAi {
            configured: false,
            source: "unknown".to_owned(),
            storage: "unavailable".to_owned(),
            masked_key: None,
            updated_at: None,
            error: Some(error.to_string()),
        },
    }
}

fn env_var_present(name: &str) -> bool {
    env::var(name)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn path_to_string(path: &PathBuf) -> String {
    path.to_string_lossy().into_owned()
}
