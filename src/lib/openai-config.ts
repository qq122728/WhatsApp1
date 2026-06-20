import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./remote-api";

export type OpenAiConfigSource = "local" | "environment" | "none";

export interface OpenAiConfigStatus {
  configured: boolean;
  source: OpenAiConfigSource;
  storage: string;
  maskedKey?: string;
  updatedAt?: string;
}

export interface OpenAiConnectionTest {
  ok: boolean;
  model: string;
  message: string;
}

export function emptyOpenAiConfigStatus(): OpenAiConfigStatus {
  return {
    configured: false,
    source: "none",
    storage: "not-configured",
  };
}

export function openAiErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; code?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.code === "string") return candidate.code;
  }
  if (error instanceof Error) return error.message;
  return "OpenAI 配置操作失败，请稍后重试。";
}

export async function loadOpenAiConfigStatus(): Promise<OpenAiConfigStatus> {
  if (!isTauriRuntime()) return emptyOpenAiConfigStatus();
  return invoke<OpenAiConfigStatus>("openai_config_status");
}

export async function saveOpenAiApiKey(
  apiKey: string,
): Promise<OpenAiConfigStatus> {
  if (!isTauriRuntime()) return emptyOpenAiConfigStatus();
  return invoke<OpenAiConfigStatus>("openai_config_save", { apiKey });
}

export async function clearOpenAiApiKey(): Promise<OpenAiConfigStatus> {
  if (!isTauriRuntime()) return emptyOpenAiConfigStatus();
  return invoke<OpenAiConfigStatus>("openai_config_clear");
}

export async function testOpenAiApiKey(
  apiKey: string,
  model: string,
): Promise<OpenAiConnectionTest> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      model,
      message: "请在桌面客户端中测试 OpenAI Key。",
    };
  }
  return invoke<OpenAiConnectionTest>("openai_config_test", {
    apiKey: apiKey.trim() || null,
    model,
  });
}
