use std::{
    env, fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{
    deepl_config,
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
    has_deepl_api_key: bool,
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
pub struct DiagnosticsDeepL {
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
    deep_l: DiagnosticsDeepL,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCacheStats {
    entries: u64,
    bytes: u64,
    formatted_size: String,
    directory: Option<String>,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCacheClearResult {
    removed_entries: u64,
    removed_bytes: u64,
    formatted_size: String,
    directory: Option<String>,
    cleared_at: String,
}

#[tauri::command]
pub fn app_diagnostics_snapshot(app: AppHandle, client_context: Option<Value>) -> AppDiagnostics {
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

#[tauri::command]
pub fn translation_cache_stats(app: AppHandle) -> TranslationCacheStats {
    let directory = translation_cache_dir(&app).ok();
    let (entries, bytes) = directory.as_deref().map(cache_dir_stats).unwrap_or((0, 0));

    TranslationCacheStats {
        entries,
        bytes,
        formatted_size: format_bytes(bytes),
        directory: directory.as_ref().map(path_to_string),
        updated_at: Utc::now().to_rfc3339(),
    }
}

#[tauri::command]
pub fn translation_cache_clear(app: AppHandle) -> AppResult<TranslationCacheClearResult> {
    let directory = translation_cache_dir(&app)?;
    let (removed_entries, removed_bytes) = cache_dir_stats(&directory);

    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|_| {
            AppError::new(
                ErrorCode::DiskFull,
                "Translation cache directory could not be cleared.",
            )
        })?;
    }
    fs::create_dir_all(&directory).map_err(|_| {
        AppError::new(
            ErrorCode::DiskFull,
            "Translation cache directory could not be recreated.",
        )
    })?;

    Ok(TranslationCacheClearResult {
        removed_entries,
        removed_bytes,
        formatted_size: format_bytes(removed_bytes),
        directory: Some(path_to_string(&directory)),
        cleared_at: Utc::now().to_rfc3339(),
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
            has_deepl_api_key: env_var_present("DEEPL_API_KEY"),
            has_browser_override: env_var_present("MULTICONNECT_BROWSER_EXECUTABLE"),
            has_sidecar_override: env_var_present("MULTICONNECT_SIDECAR_SCRIPT"),
        },
        open_ai: openai_diagnostics(app),
        deep_l: deepl_diagnostics(app),
        paths: DiagnosticsPaths {
            app_config_dir: app
                .path()
                .app_config_dir()
                .ok()
                .map(|path| path_to_string(&path)),
            app_data_dir: app
                .path()
                .app_data_dir()
                .ok()
                .map(|path| path_to_string(&path)),
            app_cache_dir: app
                .path()
                .app_cache_dir()
                .ok()
                .map(|path| path_to_string(&path)),
            app_log_dir: app
                .path()
                .app_log_dir()
                .ok()
                .map(|path| path_to_string(&path)),
            desktop_dir: app
                .path()
                .desktop_dir()
                .ok()
                .map(|path| path_to_string(&path)),
            current_exe: env::current_exe().ok().map(|path| path_to_string(&path)),
        },
        client_context,
    }
}

fn translation_cache_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("translation-cache"))
        .map_err(|_| {
            AppError::new(
                ErrorCode::DiskFull,
                "Translation cache directory could not be resolved.",
            )
        })
}

fn cache_dir_stats(path: &Path) -> (u64, u64) {
    let mut entries = 0;
    let mut bytes = 0;
    let Ok(items) = fs::read_dir(path) else {
        return (0, 0);
    };

    for item in items.flatten() {
        let Ok(metadata) = item.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            let (child_entries, child_bytes) = cache_dir_stats(&item.path());
            entries += child_entries;
            bytes += child_bytes;
        } else if metadata.is_file() {
            entries += 1;
            bytes += metadata.len();
        }
    }

    (entries, bytes)
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let value = bytes as f64;
    if value >= GB {
        format!("{:.2} GB", value / GB)
    } else if value >= MB {
        format!("{:.2} MB", value / MB)
    } else if value >= KB {
        format!("{:.1} KB", value / KB)
    } else {
        format!("{bytes} B")
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

fn deepl_diagnostics(app: &AppHandle) -> DiagnosticsDeepL {
    match deepl_config::status(app) {
        Ok(status) => DiagnosticsDeepL {
            configured: status.configured,
            source: status.source.to_owned(),
            storage: status.storage.to_owned(),
            masked_key: status.masked_key,
            updated_at: status.updated_at,
            error: None,
        },
        Err(error) => DiagnosticsDeepL {
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
