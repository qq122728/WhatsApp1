import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./remote-api";

export type DeepLConfigSource = "local" | "environment" | "none";

export interface DeepLConfigStatus {
  configured: boolean;
  source: DeepLConfigSource;
  storage: string;
  maskedKey?: string;
  updatedAt?: string;
}

export interface DeepLConnectionTest {
  ok: boolean;
  endpoint: string;
  message: string;
}

export function emptyDeepLConfigStatus(): DeepLConfigStatus {
  return {
    configured: false,
    source: "none",
    storage: "not-configured",
  };
}

export function deepLErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; code?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.code === "string") return candidate.code;
  }
  if (error instanceof Error) return error.message;
  return "DeepL 配置操作失败，请稍后重试。";
}

export async function loadDeepLConfigStatus(): Promise<DeepLConfigStatus> {
  if (!isTauriRuntime()) return emptyDeepLConfigStatus();
  return invoke<DeepLConfigStatus>("deepl_config_status");
}

export async function saveDeepLApiKey(
  apiKey: string,
): Promise<DeepLConfigStatus> {
  if (!isTauriRuntime()) return emptyDeepLConfigStatus();
  return invoke<DeepLConfigStatus>("deepl_config_save", { apiKey });
}

export async function clearDeepLApiKey(): Promise<DeepLConfigStatus> {
  if (!isTauriRuntime()) return emptyDeepLConfigStatus();
  return invoke<DeepLConfigStatus>("deepl_config_clear");
}

export async function testDeepLApiKey(
  apiKey: string,
): Promise<DeepLConnectionTest> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      endpoint: "",
      message: "请在桌面客户端中测试 DeepL Key。",
    };
  }
  return invoke<DeepLConnectionTest>("deepl_config_test", {
    apiKey: apiKey.trim() || null,
  });
}
