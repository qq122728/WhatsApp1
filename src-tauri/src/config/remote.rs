use serde::{Deserialize, Serialize};
use url::{Host, Url};

use crate::error::{AppError, AppResult, ErrorCode};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConfigInput {
    api_base_url: String,
    device_name: String,
    device_id: String,
}

impl RemoteConfigInput {
    pub fn new(
        api_base_url: impl Into<String>,
        device_name: impl Into<String>,
        device_id: impl Into<String>,
    ) -> Self {
        Self {
            api_base_url: api_base_url.into(),
            device_name: device_name.into(),
            device_id: device_id.into(),
        }
    }
}

#[derive(Clone)]
pub struct ValidatedRemoteConfig {
    api_base_url: String,
    device_name: String,
    device_id: String,
}

impl ValidatedRemoteConfig {
    pub fn api_base_url(&self) -> &str {
        &self.api_base_url
    }

    pub fn device_name(&self) -> &str {
        &self.device_name
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConfigValidationResult {
    valid: bool,
    normalized_api_base_url: String,
}

impl From<ValidatedRemoteConfig> for RemoteConfigValidationResult {
    fn from(config: ValidatedRemoteConfig) -> Self {
        Self {
            valid: true,
            normalized_api_base_url: config.api_base_url,
        }
    }
}

pub fn validate_remote_config(config: RemoteConfigInput) -> AppResult<ValidatedRemoteConfig> {
    if config.device_name.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::DeviceNameRequired,
            "Device name is required.",
        ));
    }

    if config.device_id.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::DeviceIdRequired,
            "Device ID is required.",
        ));
    }

    let api_base_url = normalize_api_base_url(&config.api_base_url)?;
    Ok(ValidatedRemoteConfig {
        api_base_url,
        device_name: config.device_name.trim().to_owned(),
        device_id: config.device_id.trim().to_owned(),
    })
}

fn normalize_api_base_url(value: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::new(
            ErrorCode::RemoteApiUrlRequired,
            "Remote API URL is required.",
        ));
    }

    let url = Url::parse(value)
        .map_err(|_| AppError::new(ErrorCode::InvalidRemoteApiUrl, "Remote API URL is invalid."))?;

    if url.cannot_be_a_base() || url.host().is_none() {
        return Err(AppError::new(
            ErrorCode::InvalidRemoteApiUrl,
            "Remote API URL must be an absolute URL with a host.",
        ));
    }

    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::new(
            ErrorCode::InvalidRemoteApiUrl,
            "Remote API URL must not contain credentials, a query, or a fragment.",
        ));
    }

    match url.scheme() {
        "https" => {}
        "http" if is_loopback_host(&url) => {}
        _ => {
            return Err(AppError::new(
                ErrorCode::RemoteApiMustUseHttps,
                "Remote API URL must use HTTPS unless it targets localhost.",
            ));
        }
    }

    Ok(url.as_str().trim_end_matches('/').to_owned())
}

fn is_loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_remote_config, RemoteConfigInput};
    use crate::error::{AppResult, ErrorCode};

    fn input(api_base_url: &str) -> RemoteConfigInput {
        RemoteConfigInput::new(api_base_url, "Test device", "test-device-id")
    }

    fn assert_valid_url(api_base_url: &str, expected: &str) {
        match validate_remote_config(input(api_base_url)) {
            Ok(config) => assert_eq!(config.api_base_url, expected),
            Err(error) => panic!("expected valid URL, received {error}"),
        }
    }

    fn assert_error_code(result: AppResult<super::ValidatedRemoteConfig>, expected: ErrorCode) {
        match result {
            Ok(_) => panic!("expected error code {}", expected.as_str()),
            Err(error) => assert_eq!(error.code(), expected),
        }
    }

    #[test]
    fn accepts_https_and_normalizes_trailing_slashes() {
        assert_valid_url(
            "  https://example.com/api/v1///  ",
            "https://example.com/api/v1",
        );
    }

    #[test]
    fn accepts_http_only_for_localhost_and_loopback_ips() {
        assert_valid_url("http://localhost:8000/", "http://localhost:8000");
        assert_valid_url("http://127.0.0.1:8000/", "http://127.0.0.1:8000");
        assert_valid_url("http://[::1]:8000/", "http://[::1]:8000");
    }

    #[test]
    fn rejects_insecure_non_local_urls_and_lookalike_hosts() {
        for url in [
            "http://example.com",
            "http://localhost.example.com",
            "http://localhost.evil",
            "ftp://localhost",
        ] {
            assert_error_code(
                validate_remote_config(input(url)),
                ErrorCode::RemoteApiMustUseHttps,
            );
        }
    }

    #[test]
    fn rejects_malformed_or_ambiguous_base_urls() {
        for url in [
            "not a url",
            "https://",
            "https://example.com:bad-port",
            "https://user:password@example.com",
            "https://example.com/api?token=value",
            "https://example.com/api#fragment",
        ] {
            assert_error_code(
                validate_remote_config(input(url)),
                ErrorCode::InvalidRemoteApiUrl,
            );
        }
    }

    #[test]
    fn requires_url_and_device_identity_fields() {
        assert_error_code(
            validate_remote_config(input("  ")),
            ErrorCode::RemoteApiUrlRequired,
        );

        let missing_name = RemoteConfigInput {
            api_base_url: "https://example.com".to_owned(),
            device_name: " ".to_owned(),
            device_id: "device-id".to_owned(),
        };
        assert_error_code(
            validate_remote_config(missing_name),
            ErrorCode::DeviceNameRequired,
        );

        let missing_id = RemoteConfigInput {
            api_base_url: "https://example.com".to_owned(),
            device_name: "Device".to_owned(),
            device_id: String::new(),
        };
        assert_error_code(
            validate_remote_config(missing_id),
            ErrorCode::DeviceIdRequired,
        );
    }
}
