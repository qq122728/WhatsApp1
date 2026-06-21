use std::sync::Arc;

use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use tauri::async_runtime::JoinHandle;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        client::IntoClientRequest,
        http::{header, HeaderValue},
        protocol::{frame::coding::CloseCode, CloseFrame},
        Message,
    },
};
use url::Url;
use uuid::Uuid;

use crate::{
    config::remote::{validate_remote_config, RemoteConfigInput, ValidatedRemoteConfig},
    error::{AppError, AppResult, ErrorCode},
};

use super::protocol::{
    command_ack_payload, command_error_ack_payload, command_result_payload, envelope,
    heartbeat_pong_payload, hello_payload, is_expired, status_payload, CommandRequestPayload,
    HeartbeatPayload, IncomingEnvelope, RegistrationData, RegistrationRequest,
    RemoteAccountSummary, RestEnvelope, PROTOCOL_VERSION, STATUS_COMMAND, WSS_SUBPROTOCOL,
};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteControlState {
    #[default]
    Idle,
    Registering,
    Connecting,
    Connected,
    Disconnected,
    Error,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControlStatus {
    pub state: RemoteControlState,
    pub api_base_url: Option<String>,
    pub device_id: Option<String>,
    pub connected_at: Option<String>,
    pub credential_expires_at: Option<String>,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
}

#[derive(Default)]
pub struct RemoteControlManager {
    status: Arc<RwLock<RemoteControlStatus>>,
    accounts: Arc<RwLock<Vec<RemoteAccountSummary>>>,
    task: Mutex<Option<RemoteTask>>,
}

struct RemoteTask {
    shutdown: Option<oneshot::Sender<()>>,
    status_update: mpsc::UnboundedSender<()>,
    handle: JoinHandle<()>,
}

impl RemoteControlManager {
    pub async fn connect(&self, input: RemoteConfigInput) -> AppResult<RemoteControlStatus> {
        let config = validate_remote_config(input)?;
        self.stop_task().await;
        self.set_status(RemoteControlStatus {
            state: RemoteControlState::Registering,
            api_base_url: Some(config.api_base_url().to_owned()),
            device_id: Some(config.device_id().to_owned()),
            ..RemoteControlStatus::default()
        })
        .await;

        let registration = match register_device(&config).await {
            Ok(value) => value,
            Err(error) => {
                self.set_error(&config, &error).await;
                return Err(error);
            }
        };

        self.set_status(RemoteControlStatus {
            state: RemoteControlState::Connecting,
            api_base_url: Some(config.api_base_url().to_owned()),
            device_id: Some(config.device_id().to_owned()),
            credential_expires_at: Some(registration.credentials.expires_at.clone()),
            ..RemoteControlStatus::default()
        })
        .await;

        let initial_accounts = self.accounts.read().await.clone();
        let socket = match open_device_channel(&config, &registration, &initial_accounts).await {
            Ok(value) => value,
            Err(error) => {
                self.set_error(&config, &error).await;
                return Err(error);
            }
        };

        let connected_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let connected_status = RemoteControlStatus {
            state: RemoteControlState::Connected,
            api_base_url: Some(config.api_base_url().to_owned()),
            device_id: Some(config.device_id().to_owned()),
            connected_at: Some(connected_at),
            credential_expires_at: Some(registration.credentials.expires_at),
            last_error_code: None,
            last_error_message: None,
        };
        self.set_status(connected_status.clone()).await;

        let shared_status = Arc::clone(&self.status);
        let shared_accounts = Arc::clone(&self.accounts);
        let device_id = config.device_id().to_owned();
        let api_base_url = config.api_base_url().to_owned();
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        let (status_update_sender, status_update_receiver) = mpsc::unbounded_channel();
        let task = tauri::async_runtime::spawn(async move {
            let outcome =
                run_device_channel(socket, &device_id, shared_accounts, status_update_receiver, shutdown_receiver)
                    .await;
            let mut status = shared_status.write().await;
            status.state = if outcome.is_ok() {
                RemoteControlState::Disconnected
            } else {
                RemoteControlState::Error
            };
            status.api_base_url = Some(api_base_url);
            status.device_id = Some(device_id);
            status.connected_at = None;
            if let Err(error) = outcome {
                status.last_error_code = Some(error.code().as_str().to_owned());
                status.last_error_message = Some(error.message().to_owned());
            }
        });
        *self.task.lock().await = Some(RemoteTask {
            shutdown: Some(shutdown_sender),
            status_update: status_update_sender,
            handle: task,
        });

        Ok(connected_status)
    }

    pub async fn disconnect(&self) -> RemoteControlStatus {
        self.stop_task().await;
        let mut status = self.status.write().await;
        status.state = RemoteControlState::Disconnected;
        status.connected_at = None;
        status.last_error_code = None;
        status.last_error_message = None;
        status.clone()
    }

    pub async fn status(&self) -> RemoteControlStatus {
        self.status.read().await.clone()
    }

    pub async fn update_accounts(
        &self,
        accounts: Vec<RemoteAccountSummary>,
    ) -> RemoteControlStatus {
        *self.accounts.write().await = normalize_accounts(accounts);
        let status_update = self
            .task
            .lock()
            .await
            .as_ref()
            .map(|task| task.status_update.clone());
        if let Some(sender) = status_update {
            let _ = sender.send(());
        }
        self.status().await
    }

    async fn stop_task(&self) {
        if let Some(mut task) = self.task.lock().await.take() {
            if let Some(shutdown) = task.shutdown.take() {
                let _ = shutdown.send(());
            }
            if tokio::time::timeout(std::time::Duration::from_secs(2), &mut task.handle)
                .await
                .is_err()
            {
                task.handle.abort();
                let _ = task.handle.await;
            }
        }
    }

    async fn set_status(&self, status: RemoteControlStatus) {
        *self.status.write().await = status;
    }

    async fn set_error(&self, config: &ValidatedRemoteConfig, error: &AppError) {
        self.set_status(RemoteControlStatus {
            state: RemoteControlState::Error,
            api_base_url: Some(config.api_base_url().to_owned()),
            device_id: Some(config.device_id().to_owned()),
            last_error_code: Some(error.code().as_str().to_owned()),
            last_error_message: Some(error.message().to_owned()),
            ..RemoteControlStatus::default()
        })
        .await;
    }
}

type DeviceSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn register_device(config: &ValidatedRemoteConfig) -> AppResult<RegistrationData> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|_| {
            AppError::new(
                ErrorCode::RemoteRegistrationFailed,
                "Could not initialize the control API client.",
            )
        })?;
    let request = RegistrationRequest {
        protocol_version: PROTOCOL_VERSION,
        device_id: config.device_id(),
        name: config.device_name(),
        client_version: env!("CARGO_PKG_VERSION"),
        capabilities: [STATUS_COMMAND],
    };
    let response = client
        .post(format!("{}/api/v1/devices/register", config.api_base_url()))
        .json(&request)
        .send()
        .await
        .map_err(|_| {
            AppError::new(
                ErrorCode::RemoteRegistrationFailed,
                "The control API registration request failed.",
            )
        })?;

    if !response.status().is_success() {
        return Err(AppError::new(
            ErrorCode::RemoteRegistrationFailed,
            format!(
                "The control API rejected device registration with HTTP {}.",
                response.status().as_u16()
            ),
        ));
    }

    response
        .json::<RestEnvelope<RegistrationData>>()
        .await
        .map(|envelope| envelope.data)
        .map_err(|_| {
            AppError::new(
                ErrorCode::RemoteProtocolError,
                "The device registration response was invalid.",
            )
        })
}

async fn open_device_channel(
    config: &ValidatedRemoteConfig,
    registration: &RegistrationData,
    accounts: &[RemoteAccountSummary],
) -> AppResult<DeviceSocket> {
    let websocket_url = websocket_url(config.api_base_url(), &registration.websocket_path)?;
    let mut request = websocket_url.as_str().into_client_request().map_err(|_| {
        AppError::new(
            ErrorCode::RemoteConnectionFailed,
            "Could not create the WebSocket request.",
        )
    })?;
    let authorization =
        HeaderValue::from_str(&format!("Bearer {}", registration.credentials.device_token))
            .map_err(|_| {
                AppError::new(
                    ErrorCode::RemoteConnectionFailed,
                    "The device credential could not be attached safely.",
                )
            })?;
    request
        .headers_mut()
        .insert(header::AUTHORIZATION, authorization);
    request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_static(WSS_SUBPROTOCOL),
    );

    let (mut socket, response) = connect_async(request).await.map_err(|_| {
        AppError::new(
            ErrorCode::RemoteConnectionFailed,
            "The authenticated WebSocket connection failed.",
        )
    })?;
    let accepted_protocol = response
        .headers()
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok());
    if accepted_protocol != Some(WSS_SUBPROTOCOL) {
        let _ = socket.close(None).await;
        return Err(AppError::new(
            ErrorCode::RemoteProtocolError,
            "The server did not accept the MultiConnect v1 subprotocol.",
        ));
    }

    let connection_id = Uuid::new_v4().to_string();
    send_json(
        &mut socket,
        &envelope(
            "device.hello",
            1,
            hello_payload(config.device_id(), &connection_id),
        ),
    )
    .await?;
    send_json(
        &mut socket,
        &envelope("device.status", 2, status_payload(1, accounts)),
    )
    .await?;

    Ok(socket)
}

async fn run_device_channel(
    mut socket: DeviceSocket,
    _device_id: &str,
    accounts: Arc<RwLock<Vec<RemoteAccountSummary>>>,
    mut status_updates: mpsc::UnboundedReceiver<()>,
    mut shutdown: oneshot::Receiver<()>,
) -> AppResult<()> {
    let mut expected_server_sequence = 1_u64;
    let mut next_client_sequence = 3_u64;
    let mut status_revision = 1_u64;

    loop {
        let frame = tokio::select! {
            _ = &mut shutdown => {
                socket.close(Some(CloseFrame {
                    code: CloseCode::Normal,
                    reason: "Client disconnect".into(),
                })).await.map_err(|_| {
                    AppError::new(
                        ErrorCode::RemoteConnectionFailed,
                        "Could not close the WebSocket connection cleanly.",
                    )
                })?;
                return Ok(());
            }
            update = status_updates.recv() => {
                if update.is_some() {
                    status_revision += 1;
                    let account_snapshot = accounts.read().await.clone();
                    send_json(
                        &mut socket,
                        &envelope(
                            "device.status",
                            next_client_sequence,
                            status_payload(status_revision, &account_snapshot),
                        ),
                    )
                    .await?;
                    next_client_sequence += 1;
                    continue;
                }
                return Ok(());
            }
            frame = socket.next() => frame,
        };
        let Some(frame) = frame else {
            return Ok(());
        };
        let frame = frame.map_err(|_| {
            AppError::new(
                ErrorCode::RemoteConnectionFailed,
                "The WebSocket connection ended unexpectedly.",
            )
        })?;

        match frame {
            Message::Text(text) => {
                let incoming: IncomingEnvelope =
                    serde_json::from_str(text.as_str()).map_err(|_| {
                        AppError::new(
                            ErrorCode::RemoteProtocolError,
                            "The server sent an invalid JSON protocol frame.",
                        )
                    })?;
                validate_incoming(&incoming, expected_server_sequence)?;
                expected_server_sequence += 1;

                match incoming.message_type.as_str() {
                    "heartbeat" => {
                        let heartbeat: HeartbeatPayload = serde_json::from_value(incoming.payload)
                            .map_err(|_| {
                                AppError::new(
                                    ErrorCode::RemoteProtocolError,
                                    "The server heartbeat payload was invalid.",
                                )
                            })?;
                        if heartbeat.kind == "ping" {
                            send_json(
                                &mut socket,
                                &envelope(
                                    "heartbeat",
                                    next_client_sequence,
                                    heartbeat_pong_payload(
                                        &heartbeat.nonce,
                                        &incoming.message_id,
                                        expected_server_sequence - 1,
                                    ),
                                ),
                            )
                            .await?;
                            next_client_sequence += 1;
                        }
                    }
                    "command.request" => {
                        let command: CommandRequestPayload =
                            serde_json::from_value(incoming.payload).map_err(|_| {
                                AppError::new(
                                    ErrorCode::RemoteProtocolError,
                                    "The server command payload was invalid.",
                                )
                            })?;

                        if is_expired(&command.expires_at)? {
                            send_json(
                                &mut socket,
                                &envelope(
                                    "command.ack",
                                    next_client_sequence,
                                    command_error_ack_payload(
                                        &command,
                                        "expired",
                                        "COMMAND_EXPIRED",
                                        "The command expired before it reached the device.",
                                    ),
                                ),
                            )
                            .await?;
                            next_client_sequence += 1;
                            continue;
                        }

                        if command.command_name != STATUS_COMMAND {
                            send_json(
                                &mut socket,
                                &envelope(
                                    "command.ack",
                                    next_client_sequence,
                                    command_error_ack_payload(
                                        &command,
                                        "rejected",
                                        "COMMAND_UNSUPPORTED",
                                        "This client only accepts the safe status command.",
                                    ),
                                ),
                            )
                            .await?;
                            next_client_sequence += 1;
                            continue;
                        }

                        send_json(
                            &mut socket,
                            &envelope(
                                "command.ack",
                                next_client_sequence,
                                command_ack_payload(&command, "accepted"),
                            ),
                        )
                        .await?;
                        next_client_sequence += 1;
                        status_revision += 1;
                        let account_snapshot = accounts.read().await.clone();
                        send_json(
                            &mut socket,
                            &envelope(
                                "command.result",
                                next_client_sequence,
                                command_result_payload(
                                    &command,
                                    status_revision,
                                    &account_snapshot,
                                ),
                            ),
                        )
                        .await?;
                        next_client_sequence += 1;
                    }
                    "error" => {
                        let fatal = incoming
                            .payload
                            .get("fatal")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        if fatal {
                            return Err(AppError::new(
                                ErrorCode::RemoteProtocolError,
                                "The server closed the connection because of a protocol error.",
                            ));
                        }
                    }
                    _ => {
                        return Err(AppError::new(
                            ErrorCode::RemoteProtocolError,
                            "The server sent a message type that is not valid for the client.",
                        ));
                    }
                }
            }
            Message::Ping(bytes) => {
                socket.send(Message::Pong(bytes)).await.map_err(|_| {
                    AppError::new(
                        ErrorCode::RemoteConnectionFailed,
                        "Could not answer the WebSocket transport ping.",
                    )
                })?;
            }
            Message::Close(_) => return Ok(()),
            Message::Binary(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
}

fn normalize_accounts(accounts: Vec<RemoteAccountSummary>) -> Vec<RemoteAccountSummary> {
    accounts
        .into_iter()
        .filter_map(|account| {
            let account_id = account.account_id.trim().to_owned();
            if account_id.len() < 16 || account_id.len() > 128 {
                return None;
            }

            let platform = match account.platform.as_str() {
                "whatsapp" | "telegram" | "rcs" => account.platform,
                _ => return None,
            };
            let status = match account.status.as_str() {
                "initializing" | "awaiting_auth" | "online" | "degraded" | "offline"
                | "expired" | "error" => account.status,
                _ => "offline".to_owned(),
            };
            let occurred_at = if chrono::DateTime::parse_from_rfc3339(&account.occurred_at).is_ok()
            {
                account.occurred_at
            } else {
                Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            };
            let summary = account.summary.map(|value| value.chars().take(256).collect());

            Some(RemoteAccountSummary {
                account_id,
                platform,
                status,
                occurred_at,
                reason_code: account.reason_code,
                summary,
            })
        })
        .take(10_000)
        .collect()
}

fn validate_incoming(message: &IncomingEnvelope, expected_sequence: u64) -> AppResult<()> {
    if message.protocol_version != PROTOCOL_VERSION {
        return Err(AppError::new(
            ErrorCode::RemoteProtocolError,
            "The server uses an unsupported protocol version.",
        ));
    }
    if message.sequence != expected_sequence {
        return Err(AppError::new(
            ErrorCode::RemoteProtocolError,
            format!(
                "Expected server sequence {expected_sequence}, received {}.",
                message.sequence
            ),
        ));
    }
    if message.message_id.trim().is_empty() || message.timestamp.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::RemoteProtocolError,
            "The server protocol envelope is incomplete.",
        ));
    }
    Ok(())
}

fn websocket_url(api_base_url: &str, websocket_path: &str) -> AppResult<Url> {
    let mut url = Url::parse(api_base_url).map_err(|_| {
        AppError::new(
            ErrorCode::InvalidRemoteApiUrl,
            "The control API URL is invalid.",
        )
    })?;
    url.set_scheme(match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        _ => {
            return Err(AppError::new(
                ErrorCode::InvalidRemoteApiUrl,
                "The control API URL cannot be converted to WebSocket.",
            ))
        }
    })
    .map_err(|_| {
        AppError::new(
            ErrorCode::InvalidRemoteApiUrl,
            "The control API URL cannot be converted to WebSocket.",
        )
    })?;
    url.set_path(websocket_path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

async fn send_json<T>(socket: &mut DeviceSocket, message: &T) -> AppResult<()>
where
    T: Serialize,
{
    let serialized = serde_json::to_string(message).map_err(|_| {
        AppError::new(
            ErrorCode::RemoteProtocolError,
            "Could not serialize a protocol frame.",
        )
    })?;
    socket
        .send(Message::Text(serialized.into()))
        .await
        .map_err(|_| {
            AppError::new(
                ErrorCode::RemoteConnectionFailed,
                "Could not send a protocol frame.",
            )
        })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use reqwest::Client;
    use serde_json::{json, Value};
    use uuid::Uuid;

    use crate::config::remote::RemoteConfigInput;

    use super::{websocket_url, RemoteControlManager, RemoteControlState};

    #[test]
    fn derives_ws_and_wss_urls_without_changing_the_host() {
        let local = websocket_url(
            "http://127.0.0.1:8000",
            "/api/v1/devices/device-1234567890/channel",
        )
        .expect("test URL must be valid");
        assert_eq!(
            local.as_str(),
            "ws://127.0.0.1:8000/api/v1/devices/device-1234567890/channel"
        );

        let remote = websocket_url(
            "https://control.example.com/base",
            "/api/v1/devices/device-1234567890/channel",
        )
        .expect("test URL must be valid");
        assert_eq!(
            remote.as_str(),
            "wss://control.example.com/api/v1/devices/device-1234567890/channel"
        );
    }

    #[tokio::test]
    #[ignore = "requires a running local control server"]
    async fn connects_to_control_server_and_completes_status_command() {
        let api_base_url = std::env::var("MULTICONNECT_E2E_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8000".to_owned());
        let device_id = format!("desktop-e2e-{}", Uuid::new_v4());
        let manager = RemoteControlManager::default();
        let connected = manager
            .connect(RemoteConfigInput::new(
                &api_base_url,
                "Rust E2E device",
                &device_id,
            ))
            .await
            .expect("the local control server must accept the Rust client");
        assert_eq!(connected.state, RemoteControlState::Connected);

        let client = Client::new();
        let status_url = format!("{api_base_url}/api/v1/devices/{device_id}/status");
        let mut channel_connected = false;
        for _ in 0..20 {
            let response = client
                .get(&status_url)
                .send()
                .await
                .expect("status request must succeed");
            let body: Value = response
                .json()
                .await
                .expect("status response must contain JSON");
            channel_connected = body["data"]["channelConnected"].as_bool().unwrap_or(false);
            if channel_connected {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(channel_connected, "the WSS v1 handshake must complete");

        let command_response = client
            .post(format!(
                "{api_base_url}/api/v1/devices/{device_id}/commands"
            ))
            .json(&json!({
                "protocolVersion": 1,
                "idempotencyKey": Uuid::new_v4().to_string(),
                "commandType": "device.status.request",
                "timeoutMs": 3000
            }))
            .send()
            .await
            .expect("command request must succeed");
        assert!(command_response.status().is_success());
        let body: Value = command_response
            .json()
            .await
            .expect("command response must contain JSON");
        assert_eq!(body["type"], "command.completed");
        assert_eq!(body["data"]["status"], "succeeded");
        assert_eq!(body["data"]["ackStatus"], "accepted");

        let disconnected = manager.disconnect().await;
        assert_eq!(disconnected.state, RemoteControlState::Disconnected);
    }
}
