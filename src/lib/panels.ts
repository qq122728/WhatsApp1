import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./remote-api";

export type WaPanelState = "starting" | "awaiting_qr" | "authenticated" | "closed" | "error";

export interface WaPanelStateEvent {
  accountId: string;
  state: WaPanelState;
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

export async function closeWaPanel(accountId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_panel_close", { accountId });
}

export async function resizeWaPanels(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("wa_panel_resize");
}

export async function listWaPanels(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("wa_panel_list");
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
