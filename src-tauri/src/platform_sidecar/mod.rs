use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};
use uuid::Uuid;

use crate::error::{AppError, AppResult, ErrorCode};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WhatsAppLoginState {
    Starting,
    AwaitingQr,
    Authenticated,
    Closed,
    Error,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppStatus {
    pub account_id: String,
    pub state: WhatsAppLoginState,
    pub url: Option<String>,
    pub title: Option<String>,
    pub checked_at: String,
    pub error_code: Option<String>,
}

#[derive(Default)]
pub struct PlatformSidecarManager {
    process: Mutex<Option<SidecarProcess>>,
}

struct SidecarProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
}

#[derive(Serialize)]
struct RequestEnvelope {
    id: String,
    method: String,
    params: Value,
}

#[derive(Deserialize)]
struct ResponseEnvelope<T> {
    id: String,
    ok: bool,
    result: Option<T>,
    error: Option<SidecarResponseError>,
}

#[derive(Deserialize)]
struct SidecarResponseError {
    code: String,
    message: String,
    retryable: bool,
}

impl PlatformSidecarManager {
    pub async fn health(&self) -> AppResult<Value> {
        self.request("health", json!({})).await
    }

    pub async fn start_whatsapp_login(
        &self,
        account_id: &str,
        profile_dir: &Path,
    ) -> AppResult<WhatsAppStatus> {
        validate_account_id(account_id)?;
        self.request(
            "whatsapp.startLogin",
            json!({
                "accountId": account_id,
                "userDataDir": profile_dir,
                "targetUrl": "https://web.whatsapp.com/"
            }),
        )
        .await
    }

    pub async fn whatsapp_status(&self, account_id: &str) -> AppResult<WhatsAppStatus> {
        validate_account_id(account_id)?;
        self.request("whatsapp.getStatus", json!({ "accountId": account_id }))
            .await
    }

    pub async fn close_whatsapp(&self, account_id: &str) -> AppResult<WhatsAppStatus> {
        validate_account_id(account_id)?;
        self.request("whatsapp.close", json!({ "accountId": account_id }))
            .await
    }

    async fn request<T>(&self, method: &str, params: Value) -> AppResult<T>
    where
        T: DeserializeOwned,
    {
        let mut guard = self.process.lock().await;
        if guard.is_none() {
            *guard = Some(spawn_sidecar().await?);
        }

        let request_id = Uuid::new_v4().to_string();
        let request = RequestEnvelope {
            id: request_id.clone(),
            method: method.to_owned(),
            params,
        };
        let serialized = serde_json::to_string(&request).map_err(|_| {
            AppError::new(
                ErrorCode::PlatformSidecarProtocolError,
                "Could not serialize a platform sidecar request.",
            )
        })?;

        let process = match guard.as_mut() {
            Some(process) => process,
            None => {
                return Err(AppError::new(
                    ErrorCode::PlatformSidecarUnavailable,
                    "The platform sidecar did not start.",
                ))
            }
        };
        if process.child.try_wait().ok().flatten().is_some() {
            *guard = None;
            return Err(AppError::new(
                ErrorCode::PlatformSidecarUnavailable,
                "The platform sidecar exited unexpectedly.",
            ));
        }
        process
            .stdin
            .write_all(format!("{serialized}\n").as_bytes())
            .await
            .map_err(|_| {
                AppError::new(
                    ErrorCode::PlatformSidecarUnavailable,
                    "Could not write to the platform sidecar.",
                )
            })?;
        process.stdin.flush().await.map_err(|_| {
            AppError::new(
                ErrorCode::PlatformSidecarUnavailable,
                "Could not flush the platform sidecar request.",
            )
        })?;

        let line = tokio::time::timeout(
            std::time::Duration::from_secs(60),
            process.stdout.next_line(),
        )
        .await
        .map_err(|_| {
            AppError::new(
                ErrorCode::PlatformSidecarUnavailable,
                "The platform sidecar request timed out.",
            )
        })?
        .map_err(|_| {
            AppError::new(
                ErrorCode::PlatformSidecarUnavailable,
                "Could not read the platform sidecar response.",
            )
        })?
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::PlatformSidecarUnavailable,
                "The platform sidecar closed its output stream.",
            )
        })?;

        let response: ResponseEnvelope<T> = serde_json::from_str(&line).map_err(|_| {
            AppError::new(
                ErrorCode::PlatformSidecarProtocolError,
                "The platform sidecar returned invalid JSON.",
            )
        })?;
        if response.id != request_id {
            return Err(AppError::new(
                ErrorCode::PlatformSidecarProtocolError,
                "The platform sidecar response ID did not match the request.",
            ));
        }
        if response.ok {
            return response.result.ok_or_else(|| {
                AppError::new(
                    ErrorCode::PlatformSidecarProtocolError,
                    "The platform sidecar omitted a successful result.",
                )
            });
        }

        let error = response.error.ok_or_else(|| {
            AppError::new(
                ErrorCode::PlatformSidecarProtocolError,
                "The platform sidecar omitted its error details.",
            )
        })?;
        Err(map_sidecar_error(error))
    }
}

async fn spawn_sidecar() -> AppResult<SidecarProcess> {
    let script = sidecar_script_path();
    if !script.is_file() {
        return Err(AppError::new(
            ErrorCode::PlatformSidecarUnavailable,
            format!(
                "Platform sidecar build was not found at {}.",
                script.display()
            ),
        ));
    }

    let mut child = Command::new("node")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| {
            AppError::new(
                ErrorCode::PlatformSidecarUnavailable,
                "Node.js could not start the platform sidecar.",
            )
        })?;
    let stdin = child.stdin.take().ok_or_else(|| {
        AppError::new(
            ErrorCode::PlatformSidecarUnavailable,
            "The platform sidecar input pipe was unavailable.",
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        AppError::new(
            ErrorCode::PlatformSidecarUnavailable,
            "The platform sidecar output pipe was unavailable.",
        )
    })?;

    Ok(SidecarProcess {
        child,
        stdin,
        stdout: BufReader::new(stdout).lines(),
    })
}

fn sidecar_script_path() -> PathBuf {
    if let Some(configured) = std::env::var_os("MULTICONNECT_SIDECAR_SCRIPT") {
        return PathBuf::from(configured);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .join("sidecar")
        .join("dist")
        .join("index.js")
}

fn validate_account_id(account_id: &str) -> AppResult<()> {
    let valid_length = (8..=64).contains(&account_id.len());
    let valid_chars = account_id.chars().enumerate().all(|(index, character)| {
        character.is_ascii_alphanumeric() || (index > 0 && matches!(character, '_' | '-'))
    });
    if valid_length && valid_chars {
        return Ok(());
    }

    Err(AppError::new(
        ErrorCode::InvalidArgument,
        "Account ID must contain 8-64 safe characters.",
    ))
}

fn map_sidecar_error(error: SidecarResponseError) -> AppError {
    let code = match error.code.as_str() {
        "BROWSER_NOT_FOUND" => ErrorCode::BrowserNotFound,
        "LOGIN_PAGE_NAVIGATION_FAILED" => ErrorCode::WhatsAppLoginFailed,
        _ if error.retryable => ErrorCode::WhatsAppLoginFailed,
        _ => ErrorCode::PlatformSidecarProtocolError,
    };
    AppError::new(code, error.message)
}

#[cfg(test)]
mod tests {
    use super::{sidecar_script_path, validate_account_id};

    #[test]
    fn validates_account_ids_used_as_profile_directories() {
        assert!(validate_account_id("wa_12345678").is_ok());
        assert!(validate_account_id("../unsafe").is_err());
        assert!(validate_account_id("short").is_err());
    }

    #[test]
    fn development_sidecar_build_exists() {
        assert!(
            sidecar_script_path().is_file(),
            "run npm --prefix sidecar run build first"
        );
    }

    #[tokio::test]
    async fn exchanges_jsonl_with_the_node_sidecar() {
        let manager = super::PlatformSidecarManager::default();
        let health = manager.health().await.expect("sidecar health must succeed");

        assert_eq!(health["status"], "ok");
        assert_eq!(health["version"], "0.1.0");
    }
}
