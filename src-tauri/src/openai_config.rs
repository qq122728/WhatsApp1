use std::{env, fs, path::PathBuf, time::Duration};

use chrono::Utc;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult, ErrorCode};

const CONFIG_FILE_NAME: &str = "openai-config.json";
const OPENAI_MODEL_URL_PREFIX: &str = "https://api.openai.com/v1/models";
const DEFAULT_TEST_MODEL: &str = "gpt-4o-mini";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiConfigStatus {
    pub configured: bool,
    pub source: &'static str,
    pub storage: &'static str,
    pub masked_key: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiConnectionTest {
    pub ok: bool,
    pub model: String,
    pub message: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredOpenAiConfig {
    version: u8,
    provider: String,
    protected_key: String,
    updated_at: String,
}

fn config_path(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(CONFIG_FILE_NAME))
        .map_err(|_| {
            AppError::new(
                ErrorCode::DiskFull,
                "OpenAI config directory could not be resolved.",
            )
        })
}

fn read_stored_config(app: &AppHandle) -> AppResult<Option<StoredOpenAiConfig>> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)
        .map_err(|_| AppError::new(ErrorCode::DecryptFailed, "OpenAI config could not be read."))?;
    serde_json::from_str::<StoredOpenAiConfig>(&raw)
        .map(Some)
        .map_err(|_| {
            AppError::new(
                ErrorCode::DecryptFailed,
                "OpenAI config is not a valid config file.",
            )
        })
}

fn write_stored_config(app: &AppHandle, config: &StoredOpenAiConfig) -> AppResult<()> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            AppError::new(
                ErrorCode::DiskFull,
                "OpenAI config directory could not be created.",
            )
        })?;
    }
    let raw = serde_json::to_string_pretty(config).map_err(|_| {
        AppError::new(
            ErrorCode::InvalidArgument,
            "OpenAI config could not be serialized.",
        )
    })?;
    fs::write(path, raw)
        .map_err(|_| AppError::new(ErrorCode::DiskFull, "OpenAI config could not be saved."))
}

fn local_api_key(app: &AppHandle) -> AppResult<Option<(String, StoredOpenAiConfig)>> {
    let Some(stored) = read_stored_config(app)? else {
        return Ok(None);
    };
    let api_key = unprotect_secret(&stored.protected_key)?;
    Ok(Some((api_key, stored)))
}

fn env_api_key() -> Option<String> {
    env::var("OPENAI_API_KEY")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub fn openai_api_key(app: &AppHandle) -> AppResult<String> {
    if let Some((api_key, _stored)) = local_api_key(app)? {
        return Ok(api_key);
    }
    env_api_key().ok_or_else(|| {
        AppError::new(
            ErrorCode::TranslationNotConfigured,
            "OpenAI API Key is not configured. Save it in Settings or set OPENAI_API_KEY.",
        )
    })
}

pub fn status(app: &AppHandle) -> AppResult<OpenAiConfigStatus> {
    if let Some((api_key, stored)) = local_api_key(app)? {
        return Ok(OpenAiConfigStatus {
            configured: true,
            source: "local",
            storage: "windows-dpapi",
            masked_key: Some(mask_api_key(&api_key)),
            updated_at: Some(stored.updated_at),
        });
    }

    if let Some(api_key) = env_api_key() {
        return Ok(OpenAiConfigStatus {
            configured: true,
            source: "environment",
            storage: "OPENAI_API_KEY",
            masked_key: Some(mask_api_key(&api_key)),
            updated_at: None,
        });
    }

    Ok(OpenAiConfigStatus {
        configured: false,
        source: "none",
        storage: "not-configured",
        masked_key: None,
        updated_at: None,
    })
}

pub fn save_api_key(app: &AppHandle, api_key: String) -> AppResult<OpenAiConfigStatus> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidArgument,
            "OpenAI API Key is required.",
        ));
    }

    let stored = StoredOpenAiConfig {
        version: 1,
        provider: "openai".to_owned(),
        protected_key: protect_secret(api_key)?,
        updated_at: Utc::now().to_rfc3339(),
    };
    write_stored_config(app, &stored)?;
    status(app)
}

pub fn clear_api_key(app: &AppHandle) -> AppResult<OpenAiConfigStatus> {
    let path = config_path(app)?;
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {
            return Err(AppError::new(
                ErrorCode::DiskFull,
                "OpenAI config could not be cleared.",
            ));
        }
    }
    status(app)
}

pub async fn test_api_key(
    app: &AppHandle,
    api_key: Option<String>,
    model: Option<String>,
) -> AppResult<OpenAiConnectionTest> {
    let api_key = match api_key.map(|value| value.trim().to_owned()) {
        Some(value) if !value.is_empty() => value,
        _ => openai_api_key(app)?,
    };
    let model = model
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_TEST_MODEL.to_owned());

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| {
            AppError::new(
                ErrorCode::NetworkTimeout,
                "OpenAI test client could not be initialized.",
            )
        })?;

    let url = format!("{OPENAI_MODEL_URL_PREFIX}/{model}");
    let response = client
        .get(url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| {
            let code = if error.is_timeout() {
                ErrorCode::TranslationTimeout
            } else {
                ErrorCode::NetworkTimeout
            };
            AppError::new(code, "OpenAI connection test could not be completed.")
        })?;

    let status = response.status();
    if status.is_success() {
        return Ok(OpenAiConnectionTest {
            ok: true,
            model,
            message: "OpenAI API Key is valid.".to_owned(),
        });
    }

    let (code, message) = match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => (
            ErrorCode::TranslationNotConfigured,
            "OpenAI API Key is invalid or does not have model access.",
        ),
        StatusCode::NOT_FOUND => (
            ErrorCode::TranslationFailed,
            "OpenAI API Key worked, but the selected model was not found.",
        ),
        StatusCode::TOO_MANY_REQUESTS => (
            ErrorCode::TranslationQuota,
            "OpenAI rate limit or usage quota was reached.",
        ),
        _ if status.is_server_error() => (
            ErrorCode::TranslationFailed,
            "OpenAI is temporarily unavailable.",
        ),
        _ => (
            ErrorCode::TranslationFailed,
            "OpenAI rejected the connection test.",
        ),
    };
    Err(AppError::new(code, message))
}

fn mask_api_key(api_key: &str) -> String {
    let trimmed = api_key.trim();
    if trimmed.chars().count() <= 10 {
        return "\u{2022}\u{2022}\u{2022}\u{2022}".to_owned();
    }
    let prefix: String = trimmed.chars().take(8).collect();
    let suffix_chars: Vec<char> = trimmed.chars().rev().take(4).collect();
    let suffix: String = suffix_chars.into_iter().rev().collect();
    format!("{prefix}\u{2026}{suffix}")
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn hex_decode(text: &str) -> AppResult<Vec<u8>> {
    let text = text.trim();
    if text.len() % 2 != 0 {
        return Err(AppError::new(
            ErrorCode::DecryptFailed,
            "OpenAI encrypted config is malformed.",
        ));
    }
    let mut bytes = Vec::with_capacity(text.len() / 2);
    for chunk in text.as_bytes().chunks_exact(2) {
        let hi = hex_value(chunk[0])?;
        let lo = hex_value(chunk[1])?;
        bytes.push((hi << 4) | lo);
    }
    Ok(bytes)
}

fn hex_value(byte: u8) -> AppResult<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(AppError::new(
            ErrorCode::DecryptFailed,
            "OpenAI encrypted config is malformed.",
        )),
    }
}

#[cfg(windows)]
fn protect_secret(secret: &str) -> AppResult<String> {
    use std::{ptr, slice};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: secret.len() as u32,
        pbData: secret.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &mut input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 || output.pbData.is_null() {
        return Err(AppError::new(
            ErrorCode::KeychainLocked,
            "Windows could not encrypt the OpenAI API Key.",
        ));
    }

    let bytes = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(hex_encode(&bytes))
}

#[cfg(windows)]
fn unprotect_secret(protected_hex: &str) -> AppResult<String> {
    use std::{ptr, slice};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let encrypted = hex_decode(protected_hex)?;
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 || output.pbData.is_null() {
        return Err(AppError::new(
            ErrorCode::DecryptFailed,
            "Windows could not decrypt the OpenAI API Key.",
        ));
    }

    let bytes = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    String::from_utf8(bytes).map_err(|_| {
        AppError::new(
            ErrorCode::DecryptFailed,
            "OpenAI API Key could not be decoded.",
        )
    })
}

#[cfg(not(windows))]
fn protect_secret(secret: &str) -> AppResult<String> {
    Ok(hex_encode(secret.as_bytes()))
}

#[cfg(not(windows))]
fn unprotect_secret(protected_hex: &str) -> AppResult<String> {
    String::from_utf8(hex_decode(protected_hex)?).map_err(|_| {
        AppError::new(
            ErrorCode::DecryptFailed,
            "OpenAI API Key could not be decoded.",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{hex_decode, hex_encode, mask_api_key};

    #[test]
    fn hex_round_trip_preserves_bytes() {
        let bytes = b"sk-test-123";
        assert_eq!(
            hex_decode(&hex_encode(bytes)).ok().as_deref(),
            Some(bytes.as_slice())
        );
    }

    #[test]
    fn masks_api_key_without_revealing_secret() {
        assert_eq!(mask_api_key("sk-proj-1234567890"), "sk-proj-\u{2026}7890");
        assert_eq!(mask_api_key("short"), "\u{2022}\u{2022}\u{2022}\u{2022}");
        assert_eq!(mask_api_key("sk-项目-1234567890"), "sk-项目-12\u{2026}7890");
    }
}
