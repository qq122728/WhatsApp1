import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./remote-api";

export type GoogleConfigSource = "local" | "environment" | "none";

export interface GoogleConfigStatus {
  configured: boolean;
  source: GoogleConfigSource;
  storage: string;
  maskedKey?: string;
  updatedAt?: string;
}

export interface GoogleConnectionTest {
  ok: boolean;
  endpoint: string;
  message: string;
}

export function emptyGoogleConfigStatus(): GoogleConfigStatus {
  return {
    configured: false,
    source: "none",
    storage: "not-configured",
  };
}

export function googleErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; code?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.code === "string") return candidate.code;
  }
  if (error instanceof Error) return error.message;
  return "Google 翻译配置操作失败，请稍后重试。";
}

export async function loadGoogleConfigStatus(): Promise<GoogleConfigStatus> {
  if (!isTauriRuntime()) return emptyGoogleConfigStatus();
  return invoke<GoogleConfigStatus>("google_config_status");
}

export async function saveGoogleApiKey(
  apiKey: string,
): Promise<GoogleConfigStatus> {
  if (!isTauriRuntime()) return emptyGoogleConfigStatus();
  return invoke<GoogleConfigStatus>("google_config_save", { apiKey });
}

export async function clearGoogleApiKey(): Promise<GoogleConfigStatus> {
  if (!isTauriRuntime()) return emptyGoogleConfigStatus();
  return invoke<GoogleConfigStatus>("google_config_clear");
}

export async function testGoogleApiKey(
  apiKey: string,
): Promise<GoogleConnectionTest> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      endpoint: "",
      message: "请在桌面客户端中测试 Google Translation API Key。",
    };
  }
  return invoke<GoogleConnectionTest>("google_config_test", {
    apiKey: apiKey.trim() || null,
  });
}
