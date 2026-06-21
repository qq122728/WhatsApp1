import type {
  RemoteConfig,
  RemoteConnectionState,
  RemoteControlAccountSummary,
  RemoteControlStatus,
} from "../types";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "multiconnect.remote-config";

export function createDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadRemoteConfig(): RemoteConfig {
  const fallback: RemoteConfig = {
    apiBaseUrl:
      import.meta.env.VITE_REMOTE_API_URL || "http://localhost:8000",
    deviceName: "我的工作电脑",
    deviceId: createDeviceId(),
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveRemoteConfig(config: RemoteConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function mapRemoteStatus(
  status: RemoteControlStatus,
): RemoteConnectionState {
  if (status.state === "idle") return "not_configured";
  return status.state;
}

export async function connectRemoteControl(
  config: RemoteConfig,
): Promise<RemoteControlStatus> {
  if (isTauriRuntime()) {
    return invoke<RemoteControlStatus>("remote_control_connect", { config });
  }

  const baseUrl = config.apiBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return { state: "idle" };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: {
        "X-MultiConnect-Device": config.deviceId,
      },
      signal: controller.signal,
    });
    return response.ok
      ? {
          state: "connected",
          apiBaseUrl: baseUrl,
          deviceId: config.deviceId,
        }
      : {
          state: "error",
          apiBaseUrl: baseUrl,
          deviceId: config.deviceId,
          lastErrorCode: "HEALTH_CHECK_FAILED",
          lastErrorMessage: "The control API health check failed.",
        };
  } catch {
    return {
      state: "error",
      apiBaseUrl: baseUrl,
      deviceId: config.deviceId,
      lastErrorCode: "CONTROL_API_UNREACHABLE",
      lastErrorMessage: "The control API is unreachable.",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getRemoteControlStatus(): Promise<RemoteControlStatus> {
  if (!isTauriRuntime()) {
    return { state: "idle" };
  }
  return invoke<RemoteControlStatus>("remote_control_status");
}

export async function disconnectRemoteControl(): Promise<RemoteControlStatus> {
  if (!isTauriRuntime()) {
    return { state: "disconnected" };
  }
  return invoke<RemoteControlStatus>("remote_control_disconnect");
}

export async function updateRemoteControlAccounts(
  accounts: RemoteControlAccountSummary[],
): Promise<RemoteControlStatus> {
  if (!isTauriRuntime()) {
    return { state: "idle" };
  }
  return invoke<RemoteControlStatus>("remote_control_update_accounts", { accounts });
}
