import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./remote-api";

export type WhatsAppLoginState =
  | "starting"
  | "awaiting_qr"
  | "authenticated"
  | "closed"
  | "error";

export interface WhatsAppLoginStatus {
  accountId: string;
  state: WhatsAppLoginState;
  url?: string;
  title?: string;
  checkedAt: string;
  errorCode?: string;
}

export function createWhatsAppAccountId(): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replaceAll("-", "")
      : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `wa_${suffix}`.slice(0, 40);
}

export async function beginWhatsAppLogin(
  accountId: string,
): Promise<WhatsAppLoginStatus> {
  if (!isTauriRuntime()) {
    throw new Error("TAURI_RUNTIME_REQUIRED");
  }
  return invoke<WhatsAppLoginStatus>("whatsapp_begin_login", { accountId });
}

export async function getWhatsAppLoginStatus(
  accountId: string,
): Promise<WhatsAppLoginStatus> {
  if (!isTauriRuntime()) {
    throw new Error("TAURI_RUNTIME_REQUIRED");
  }
  return invoke<WhatsAppLoginStatus>("whatsapp_login_status", { accountId });
}

export async function closeWhatsAppLogin(
  accountId: string,
): Promise<WhatsAppLoginStatus> {
  if (!isTauriRuntime()) {
    return {
      accountId,
      state: "closed",
      checkedAt: new Date().toISOString(),
    };
  }
  return invoke<WhatsAppLoginStatus>("whatsapp_close_login", { accountId });
}
