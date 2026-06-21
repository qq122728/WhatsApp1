import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./remote-api";

export interface TranslationCacheStats {
  entries: number;
  bytes: number;
  formattedSize: string;
  directory?: string;
  updatedAt: string;
}

export interface TranslationCacheClearResult {
  removedEntries: number;
  removedBytes: number;
  formattedSize: string;
  directory?: string;
  clearedAt: string;
}

export function emptyTranslationCacheStats(): TranslationCacheStats {
  return {
    entries: 0,
    bytes: 0,
    formattedSize: "0 B",
    updatedAt: new Date().toISOString(),
  };
}

export async function loadTranslationCacheStats(): Promise<TranslationCacheStats> {
  if (!isTauriRuntime()) return emptyTranslationCacheStats();
  return invoke<TranslationCacheStats>("translation_cache_stats");
}

export async function clearTranslationCache(): Promise<TranslationCacheClearResult> {
  if (!isTauriRuntime()) {
    return {
      removedEntries: 0,
      removedBytes: 0,
      formattedSize: "0 B",
      clearedAt: new Date().toISOString(),
    };
  }
  return invoke<TranslationCacheClearResult>("translation_cache_clear");
}
