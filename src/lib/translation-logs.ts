import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type TranslationLogPurpose = "incoming" | "outgoing" | string;
export type TranslationLogCacheStatus = "memory" | "disk" | "shared" | "miss" | string;

export interface TranslationLogEntry {
  id: string;
  createdAt: string;
  accountId: string;
  purpose: TranslationLogPurpose;
  success: boolean;
  cacheStatus?: TranslationLogCacheStatus | null;
  provider?: string | null;
  model?: string | null;
  durationMs: number;
  textChars: number;
  errorCode?: string | null;
  message?: string | null;
}

export async function onTranslationLogEntry(
  handler: (entry: TranslationLogEntry) => void,
): Promise<UnlistenFn> {
  return listen<TranslationLogEntry>("translation-log-entry", (event) => {
    handler(event.payload);
  });
}
