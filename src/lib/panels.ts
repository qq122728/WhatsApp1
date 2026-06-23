import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./remote-api";
import type { AccountConfig } from "../types";

export type WaPanelState = "starting" | "awaiting_qr" | "authenticated" | "closed" | "error";

export interface WaPanelStateEvent {
  accountId: string;
  state: WaPanelState;
  unreadCount?: number;
  reasonCode?: string;
  summary?: string;
}

export interface WaPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function openWaPanel(accountId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_panel_open", { accountId });
}

export async function showWaPanel(accountId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_panel_show", { accountId });
}

export async function hideWaPanel(accountId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_panel_hide", { accountId });
}

export async function setWaPanelBounds(
  accountId: string,
  bounds: WaPanelBounds,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_panel_set_bounds", { accountId, ...bounds });
}

export async function setWaPanelTranslationConfig(
  accountId: string,
  config: AccountConfig,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_panel_set_translation_config", {
    accountId,
    config: {
      translationChannel: config.translationChannel,
      translationServer: config.translationServer,
      translationStyle: config.translationStyle,
      regionalTone: config.regionalTone,
      targetLanguage: config.targetLanguage,
      sourceLanguage: config.sourceLanguage,
      sendTranslation: config.sendTranslation,
      receiveTranslation: config.receiveTranslation,
      blockChinese: config.blockChinese,
      fontSize: config.fontSize,
      fontColor: config.fontColor,
      translationCacheRetentionDays: config.translationCacheRetentionDays,
      translationCachePerAccountLimit: config.translationCachePerAccountLimit,
      incomingAutoTranslate: config.incomingAutoTranslate,
      translationCacheClearAt: config.translationCacheClearAt,
    },
  });
}

export async function closeWaPanel(accountId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_panel_close", { accountId });
}

export async function resetWaPanelSession(accountId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_account_reset_session", { accountId });
}

export async function deleteWaAccount(accountId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_account_delete", { accountId });
}

export async function resizeWaPanels(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_panel_resize");
}

export async function listWaPanels(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("wa_panel_list");
}

export async function listWaAccountProfiles(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("wa_account_list_profiles");
}

export async function onWaPanelState(
  handler: (event: WaPanelStateEvent) => void,
): Promise<UnlistenFn> {
  return listen<WaPanelStateEvent>("wa-panel-state", (event) => {
    handler(event.payload);
  });
}

export async function onWaPanelLayoutInvalidated(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen("wa-panel-layout-invalidated", handler);
}
