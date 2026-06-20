export const TRANSLATION_LANGUAGES = ["zh", "en"] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];
export type TranslationSourceLanguage = TranslationLanguage | "auto";
export type DetectedLanguageCode = TranslationLanguage | "unknown";

export interface DetectedLanguage {
  readonly language: DetectedLanguageCode;
  readonly confidence: number;
  readonly chineseCharacterCount: number;
  readonly latinCharacterCount: number;
}

export interface TranslationRequest {
  readonly text: string;
  readonly targetLanguage: TranslationLanguage;
  readonly sourceLanguage?: TranslationSourceLanguage;
  readonly glossaryVersion?: string;
  readonly requestId?: string;
}

export interface ResolvedTranslationRequest {
  readonly text: string;
  readonly sourceLanguage: TranslationLanguage;
  readonly targetLanguage: TranslationLanguage;
  readonly glossaryVersion: string;
  readonly requestId?: string;
}

export interface TranslationProviderContext {
  readonly signal: AbortSignal;
}

export interface ProviderTranslationResult {
  readonly translatedText: string;
}

export interface TranslationProvider {
  readonly id: string;
  readonly version: string;

  translate(
    request: ResolvedTranslationRequest,
    context: TranslationProviderContext,
  ): Promise<ProviderTranslationResult>;
}

export type TranslationOutcome = "translated" | "skipped_same_language";
export type TranslationCacheStatus = "hit" | "miss" | "bypassed";
export type TranslationSourceResolution = "detected" | "explicit";

export interface TranslationResult {
  readonly requestId?: string;
  readonly originalText: string;
  readonly translatedText: string;
  readonly sourceLanguage: TranslationLanguage;
  readonly targetLanguage: TranslationLanguage;
  readonly sourceResolution: TranslationSourceResolution;
  readonly detectedLanguage: DetectedLanguage;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly glossaryVersion: string;
  readonly outcome: TranslationOutcome;
  readonly cacheStatus: TranslationCacheStatus;
  readonly cacheKey: string | null;
  readonly durationMs: number;
}

export interface TranslationCallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export function isTranslationLanguage(
  value: unknown,
): value is TranslationLanguage {
  return value === "zh" || value === "en";
}
