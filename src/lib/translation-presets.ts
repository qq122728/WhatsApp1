import type { AccountConfig } from "../types";

const PRESETS_KEY = "multiconnect.translation-presets";

/**
 * The translation-relevant subset of an AccountConfig. A preset captures these
 * fields so the same translation setup can be applied across many accounts at
 * once. The account `name` and cache/runtime fields are intentionally excluded.
 */
export const TRANSLATION_PRESET_FIELDS = [
  "translationChannel",
  "translationServer",
  "translationStyle",
  "regionalTone",
  "targetLanguage",
  "sourceLanguage",
  "sendTranslation",
  "receiveTranslation",
  "fontSize",
  "fontColor",
  "groupTranslation",
  "blockChinese",
] as const;

export type TranslationPresetField = (typeof TRANSLATION_PRESET_FIELDS)[number];
export type TranslationPresetConfig = Pick<AccountConfig, TranslationPresetField>;

export interface TranslationPreset {
  id: string;
  name: string;
  config: TranslationPresetConfig;
}

export function extractPresetConfig(config: AccountConfig): TranslationPresetConfig {
  return {
    translationChannel: config.translationChannel,
    translationServer: config.translationServer,
    translationStyle: config.translationStyle,
    regionalTone: config.regionalTone,
    targetLanguage: config.targetLanguage,
    sourceLanguage: config.sourceLanguage,
    sendTranslation: config.sendTranslation,
    receiveTranslation: config.receiveTranslation,
    fontSize: config.fontSize,
    fontColor: config.fontColor,
    groupTranslation: config.groupTranslation,
    blockChinese: config.blockChinese,
  };
}

function createId(): string {
  return `preset_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function loadPresets(): TranslationPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is TranslationPreset =>
        !!item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        !!item.config &&
        typeof item.config === "object",
    );
  } catch {
    return [];
  }
}

export function savePresets(presets: TranslationPreset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // best-effort persistence
  }
}

export function createPreset(
  name: string,
  config: TranslationPresetConfig,
): TranslationPreset {
  return { id: createId(), name: name.trim() || "未命名预设", config };
}
