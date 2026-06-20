use std::{error::Error, fmt};

use serde::{Serialize, Serializer};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    AuthTimeout,
    AuthExpired,
    NetworkTimeout,
    DnsFailure,
    PlatformRateLimited,
    PlatformRejected,
    AdapterCrashed,
    SelectorMismatch,
    DbLocked,
    DiskFull,
    KeychainLocked,
    DecryptFailed,
    TranslationQuota,
    TranslationTimeout,
    TranslationNotConfigured,
    TranslationFailed,
    InvalidArgument,
    RemoteApiUrlRequired,
    InvalidRemoteApiUrl,
    RemoteApiMustUseHttps,
    RemoteRegistrationFailed,
    RemoteConnectionFailed,
    RemoteProtocolError,
    RemoteNotConnected,
    PlatformSidecarUnavailable,
    PlatformSidecarProtocolError,
    BrowserNotFound,
    WhatsAppLoginFailed,
    WaPanelFailed,
    DeviceNameRequired,
    DeviceIdRequired,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AuthTimeout => "AUTH_TIMEOUT",
            Self::AuthExpired => "AUTH_EXPIRED",
            Self::NetworkTimeout => "NETWORK_TIMEOUT",
            Self::DnsFailure => "DNS_FAILURE",
            Self::PlatformRateLimited => "PLATFORM_RATE_LIMITED",
            Self::PlatformRejected => "PLATFORM_REJECTED",
            Self::AdapterCrashed => "ADAPTER_CRASHED",
            Self::SelectorMismatch => "SELECTOR_MISMATCH",
            Self::DbLocked => "DB_LOCKED",
            Self::DiskFull => "DISK_FULL",
            Self::KeychainLocked => "KEYCHAIN_LOCKED",
            Self::DecryptFailed => "DECRYPT_FAILED",
            Self::TranslationQuota => "TRANSLATION_QUOTA",
            Self::TranslationTimeout => "TRANSLATION_TIMEOUT",
            Self::TranslationNotConfigured => "TRANSLATION_NOT_CONFIGURED",
            Self::TranslationFailed => "TRANSLATION_FAILED",
            Self::InvalidArgument => "INVALID_ARGUMENT",
            Self::RemoteApiUrlRequired => "REMOTE_API_URL_REQUIRED",
            Self::InvalidRemoteApiUrl => "INVALID_REMOTE_API_URL",
            Self::RemoteApiMustUseHttps => "REMOTE_API_MUST_USE_HTTPS",
            Self::RemoteRegistrationFailed => "REMOTE_REGISTRATION_FAILED",
            Self::RemoteConnectionFailed => "REMOTE_CONNECTION_FAILED",
            Self::RemoteProtocolError => "REMOTE_PROTOCOL_ERROR",
            Self::RemoteNotConnected => "REMOTE_NOT_CONNECTED",
            Self::PlatformSidecarUnavailable => "PLATFORM_SIDECAR_UNAVAILABLE",
            Self::PlatformSidecarProtocolError => "PLATFORM_SIDECAR_PROTOCOL_ERROR",
            Self::BrowserNotFound => "BROWSER_NOT_FOUND",
            Self::WhatsAppLoginFailed => "WHATSAPP_LOGIN_FAILED",
            Self::WaPanelFailed => "WA_PANEL_FAILED",
            Self::DeviceNameRequired => "DEVICE_NAME_REQUIRED",
            Self::DeviceIdRequired => "DEVICE_ID_REQUIRED",
        }
    }

    pub const fn is_retryable(self) -> bool {
        matches!(
            self,
            Self::AuthTimeout
                | Self::NetworkTimeout
                | Self::DnsFailure
                | Self::PlatformRateLimited
                | Self::AdapterCrashed
                | Self::DbLocked
                | Self::TranslationTimeout
                | Self::RemoteRegistrationFailed
                | Self::RemoteConnectionFailed
                | Self::PlatformSidecarUnavailable
                | Self::WhatsAppLoginFailed
                | Self::WaPanelFailed
        )
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl Serialize for ErrorCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    code: ErrorCode,
    message: String,
    retryable: bool,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retryable: code.is_retryable(),
        }
    }

    pub const fn code(&self) -> ErrorCode {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub const fn retryable(&self) -> bool {
        self.retryable
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl Error for AppError {}

#[cfg(test)]
mod tests {
    use super::{AppError, ErrorCode};

    #[test]
    fn error_codes_have_stable_wire_values() {
        let cases = [
            (ErrorCode::AuthTimeout, "AUTH_TIMEOUT"),
            (ErrorCode::AuthExpired, "AUTH_EXPIRED"),
            (ErrorCode::NetworkTimeout, "NETWORK_TIMEOUT"),
            (ErrorCode::DnsFailure, "DNS_FAILURE"),
            (ErrorCode::PlatformRateLimited, "PLATFORM_RATE_LIMITED"),
            (ErrorCode::PlatformRejected, "PLATFORM_REJECTED"),
            (ErrorCode::AdapterCrashed, "ADAPTER_CRASHED"),
            (ErrorCode::SelectorMismatch, "SELECTOR_MISMATCH"),
            (ErrorCode::DbLocked, "DB_LOCKED"),
            (ErrorCode::DiskFull, "DISK_FULL"),
            (ErrorCode::KeychainLocked, "KEYCHAIN_LOCKED"),
            (ErrorCode::DecryptFailed, "DECRYPT_FAILED"),
            (ErrorCode::TranslationQuota, "TRANSLATION_QUOTA"),
            (ErrorCode::TranslationTimeout, "TRANSLATION_TIMEOUT"),
            (ErrorCode::InvalidArgument, "INVALID_ARGUMENT"),
            (ErrorCode::RemoteApiUrlRequired, "REMOTE_API_URL_REQUIRED"),
            (ErrorCode::InvalidRemoteApiUrl, "INVALID_REMOTE_API_URL"),
            (
                ErrorCode::RemoteApiMustUseHttps,
                "REMOTE_API_MUST_USE_HTTPS",
            ),
            (
                ErrorCode::RemoteRegistrationFailed,
                "REMOTE_REGISTRATION_FAILED",
            ),
            (
                ErrorCode::RemoteConnectionFailed,
                "REMOTE_CONNECTION_FAILED",
            ),
            (ErrorCode::RemoteProtocolError, "REMOTE_PROTOCOL_ERROR"),
            (ErrorCode::RemoteNotConnected, "REMOTE_NOT_CONNECTED"),
            (
                ErrorCode::PlatformSidecarUnavailable,
                "PLATFORM_SIDECAR_UNAVAILABLE",
            ),
            (
                ErrorCode::PlatformSidecarProtocolError,
                "PLATFORM_SIDECAR_PROTOCOL_ERROR",
            ),
            (ErrorCode::BrowserNotFound, "BROWSER_NOT_FOUND"),
            (ErrorCode::WhatsAppLoginFailed, "WHATSAPP_LOGIN_FAILED"),
            (ErrorCode::DeviceNameRequired, "DEVICE_NAME_REQUIRED"),
            (ErrorCode::DeviceIdRequired, "DEVICE_ID_REQUIRED"),
        ];

        for (code, expected) in cases {
            assert_eq!(code.as_str(), expected);
            match serde_json::to_string(&code) {
                Ok(serialized) => assert_eq!(serialized, format!("\"{expected}\"")),
                Err(error) => panic!("failed to serialize {expected}: {error}"),
            }
        }
    }

    #[test]
    fn app_error_uses_code_retry_policy_and_safe_shape() {
        let error = AppError::new(ErrorCode::NetworkTimeout, "Request timed out.");

        assert_eq!(error.code(), ErrorCode::NetworkTimeout);
        assert_eq!(error.message(), "Request timed out.");
        assert!(error.retryable());

        match serde_json::to_value(error) {
            Ok(value) => {
                assert_eq!(value["code"], "NETWORK_TIMEOUT");
                assert_eq!(value["message"], "Request timed out.");
                assert_eq!(value["retryable"], true);
            }
            Err(error) => panic!("failed to serialize AppError: {error}"),
        }
    }

    #[test]
    fn validation_errors_are_not_retryable() {
        let error = AppError::new(ErrorCode::InvalidArgument, "Invalid value.");
        assert!(!error.retryable());
    }
}
