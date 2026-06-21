use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{AppError, AppResult, ErrorCode};

pub const PROTOCOL_VERSION: u8 = 1;
pub const WSS_SUBPROTOCOL: &str = "multiconnect.v1";
pub const STATUS_COMMAND: &str = "device.status.request";
pub const ACCOUNT_STATUS_REFRESH_COMMAND: &str = "account.status.refresh";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestEnvelope<T> {
    pub data: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationData {
    pub credentials: RegistrationCredentials,
    pub websocket_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationCredentials {
    pub device_token: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationRequest<'a> {
    pub protocol_version: u8,
    pub device_id: &'a str,
    pub name: &'a str,
    pub client_version: &'a str,
    pub capabilities: [&'a str; 2],
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccountSummary {
    pub account_id: String,
    pub platform: String,
    pub status: String,
    pub occurred_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingEnvelope {
    pub protocol_version: u8,
    pub message_id: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub timestamp: String,
    pub sequence: u64,
    pub payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingEnvelope<T>
where
    T: Serialize,
{
    pub protocol_version: u8,
    pub message_id: String,
    #[serde(rename = "type")]
    pub message_type: &'static str,
    pub timestamp: String,
    pub sequence: u64,
    pub payload: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatPayload {
    pub kind: String,
    pub nonce: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRequestPayload {
    pub command_id: String,
    pub idempotency_key: String,
    pub expires_at: String,
    pub command_name: String,
    pub parameters: Value,
}

pub fn envelope<T>(message_type: &'static str, sequence: u64, payload: T) -> OutgoingEnvelope<T>
where
    T: Serialize,
{
    OutgoingEnvelope {
        protocol_version: PROTOCOL_VERSION,
        message_id: Uuid::new_v4().to_string(),
        message_type,
        timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        sequence,
        payload,
    }
}

pub fn hello_payload(device_id: &str, connection_id: &str) -> Value {
    json!({
        "deviceId": device_id,
        "connectionId": connection_id,
        "clientVersion": env!("CARGO_PKG_VERSION"),
        "supportedProtocolVersions": [PROTOCOL_VERSION],
        "runtime": {
            "os": runtime_os(),
            "architecture": runtime_architecture()
        },
        "capabilities": {
            "commandNames": [STATUS_COMMAND, ACCOUNT_STATUS_REFRESH_COMMAND],
            "maxConcurrentCommands": 1,
            "supportsCommandCancellation": false
        }
    })
}

pub fn status_payload(status_revision: u64, accounts: &[RemoteAccountSummary]) -> Value {
    json!({
        "statusRevision": status_revision,
        "status": "ready",
        "activeCommandCount": 0,
        "queuedCommandCount": 0,
        "accounts": accounts
    })
}

pub fn heartbeat_pong_payload(
    nonce: &str,
    reply_to_message_id: &str,
    last_received_sequence: u64,
) -> Value {
    json!({
        "kind": "pong",
        "nonce": nonce,
        "replyToMessageId": reply_to_message_id,
        "lastReceivedSequence": last_received_sequence
    })
}

pub fn command_ack_payload(command: &CommandRequestPayload, status: &str) -> Value {
    json!({
        "commandId": command.command_id,
        "idempotencyKey": command.idempotency_key,
        "expiresAt": command.expires_at,
        "status": status,
        "acknowledgedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    })
}

pub fn command_result_payload(
    command: &CommandRequestPayload,
    status_revision: u64,
    accounts: &[RemoteAccountSummary],
) -> Value {
    json!({
        "commandId": command.command_id,
        "idempotencyKey": command.idempotency_key,
        "expiresAt": command.expires_at,
        "status": "succeeded",
        "completedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "result": status_payload(status_revision, accounts)
    })
}

pub fn command_error_result_payload(
    command: &CommandRequestPayload,
    error_code: &str,
    message: &str,
) -> Value {
    json!({
        "commandId": command.command_id,
        "idempotencyKey": command.idempotency_key,
        "expiresAt": command.expires_at,
        "status": "failed",
        "completedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "error": {
            "code": error_code,
            "category": "command",
            "message": message,
            "retryable": false
        }
    })
}

pub fn command_error_ack_payload(
    command: &CommandRequestPayload,
    status: &str,
    error_code: &str,
    message: &str,
) -> Value {
    json!({
        "commandId": command.command_id,
        "idempotencyKey": command.idempotency_key,
        "expiresAt": command.expires_at,
        "status": status,
        "acknowledgedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "error": {
            "code": error_code,
            "category": "command",
            "message": message,
            "retryable": false
        }
    })
}

pub fn is_expired(expires_at: &str) -> AppResult<bool> {
    let parsed = DateTime::parse_from_rfc3339(expires_at).map_err(|_| {
        AppError::new(
            ErrorCode::RemoteProtocolError,
            "Server command contains an invalid expiresAt timestamp.",
        )
    })?;
    Ok(parsed.with_timezone(&Utc) <= Utc::now())
}

fn runtime_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn runtime_architecture() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "unknown"
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{
        envelope, hello_payload, status_payload, ACCOUNT_STATUS_REFRESH_COMMAND, PROTOCOL_VERSION,
        STATUS_COMMAND,
    };

    #[test]
    fn hello_advertises_safe_status_commands() {
        let payload = hello_payload("device-1234567890", "connection-1234567890");

        assert_eq!(
            payload["capabilities"]["commandNames"],
            Value::Array(vec![
                Value::String(STATUS_COMMAND.to_owned()),
                Value::String(ACCOUNT_STATUS_REFRESH_COMMAND.to_owned())
            ])
        );
        assert_eq!(payload["deviceId"], "device-1234567890");
    }

    #[test]
    fn envelopes_use_v1_sequence_and_payload() {
        let message = envelope("device.status", 2, status_payload(1, &[]));
        let value = serde_json::to_value(message).expect("test serialization must succeed");

        assert_eq!(value["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(value["sequence"], 2);
        assert_eq!(value["type"], "device.status");
        assert!(value.get("payload").is_some());
        assert!(value.get("data").is_none());
    }
}
