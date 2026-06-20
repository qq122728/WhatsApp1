import {
  MemoryTranslationCache,
  createTranslationCacheKey,
  type TranslationCache,
} from "./cache";
import {
  TranslationError,
  mapProviderError,
} from "./errors";
import { detectLanguage } from "./language-detector";
import {
  isTranslationLanguage,
  type DetectedLanguage,
  type ProviderTranslationResult,
  type ResolvedTranslationRequest,
  type TranslationCallOptions,
  type TranslationLanguage,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
  type TranslationSourceResolution,
} from "./types";

export interface TranslationServiceOptions {
  readonly timeoutMs?: number;
  readonly maxTextLength?: number;
  readonly defaultGlossaryVersion?: string;
  readonly now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TEXT_LENGTH = 10_000;
const DEFAULT_GLOSSARY_VERSION = "none";
const MAX_GLOSSARY_VERSION_LENGTH = 128;

interface ResolvedSource {
  readonly language: TranslationLanguage;
  readonly resolution: TranslationSourceResolution;
}

function assertNonEmptyIdentifier(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TranslationError({
      code: "INVALID_ARGUMENT",
      message: `${fieldName} must not be empty.`,
      retryable: false,
    });
  }
}

function validatePositiveFiniteNumber(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TranslationError({
      code: "INVALID_ARGUMENT",
      message: `${fieldName} must be a positive finite number.`,
      retryable: false,
    });
  }
}

function normalizeGlossaryVersion(
  glossaryVersion: unknown,
  fallback: string,
): string {
  const value = glossaryVersion ?? fallback;
  if (typeof value !== "string") {
    throw new TranslationError({
      code: "INVALID_ARGUMENT",
      message: "glossaryVersion must be a string.",
      retryable: false,
    });
  }

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_GLOSSARY_VERSION_LENGTH
  ) {
    throw new TranslationError({
      code: "INVALID_ARGUMENT",
      message: `glossaryVersion must contain 1-${MAX_GLOSSARY_VERSION_LENGTH} characters.`,
      retryable: false,
    });
  }

  return normalized;
}

function resolveSourceLanguage(
  request: TranslationRequest,
  detected: DetectedLanguage,
): ResolvedSource {
  const requestedSource = request.sourceLanguage ?? "auto";

  if (requestedSource !== "auto") {
    if (!isTranslationLanguage(requestedSource)) {
      throw new TranslationError({
        code: "UNSUPPORTED_LANGUAGE",
        message: "Only Chinese and English translation are supported.",
        retryable: false,
      });
    }

    return {
      language: requestedSource,
      resolution: "explicit",
    };
  }

  if (!isTranslationLanguage(detected.language)) {
    throw new TranslationError({
      code: "UNSUPPORTED_LANGUAGE",
      message: "Could not confidently detect Chinese or English.",
      retryable: false,
    });
  }

  return {
    language: detected.language,
    resolution: "detected",
  };
}

function createAbortError(providerId: string): TranslationError {
  return new TranslationError({
    code: "TRANSLATION_ABORTED",
    message: "Translation request was cancelled.",
    retryable: false,
    providerId,
  });
}

function createTimeoutError(providerId: string): TranslationError {
  return new TranslationError({
    code: "TRANSLATION_TIMEOUT",
    message: "Translation request timed out.",
    retryable: true,
    providerId,
  });
}

export class TranslationService {
  readonly #provider: TranslationProvider;
  readonly #cache: TranslationCache;
  readonly #timeoutMs: number;
  readonly #maxTextLength: number;
  readonly #defaultGlossaryVersion: string;
  readonly #now: () => number;

  constructor(
    provider: TranslationProvider,
    cache: TranslationCache = new MemoryTranslationCache(),
    options: TranslationServiceOptions = {},
  ) {
    assertNonEmptyIdentifier(provider.id, "provider.id");
    assertNonEmptyIdentifier(provider.version, "provider.version");

    this.#provider = provider;
    this.#cache = cache;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
    this.#defaultGlossaryVersion =
      options.defaultGlossaryVersion ?? DEFAULT_GLOSSARY_VERSION;
    this.#now = options.now ?? Date.now;

    validatePositiveFiniteNumber(this.#timeoutMs, "timeoutMs");
    validatePositiveFiniteNumber(this.#maxTextLength, "maxTextLength");
    normalizeGlossaryVersion(undefined, this.#defaultGlossaryVersion);
  }

  detect(text: string): DetectedLanguage {
    return detectLanguage(text);
  }

  async translate(
    request: TranslationRequest,
    options: TranslationCallOptions = {},
  ): Promise<TranslationResult> {
    const startedAt = this.#now();
    this.#validateRequest(request);

    const detectedLanguage = detectLanguage(request.text);
    const resolvedSource = resolveSourceLanguage(request, detectedLanguage);
    const glossaryVersion = normalizeGlossaryVersion(
      request.glossaryVersion,
      this.#defaultGlossaryVersion,
    );

    if (resolvedSource.language === request.targetLanguage) {
      return {
        requestId: request.requestId,
        originalText: request.text,
        translatedText: request.text,
        sourceLanguage: resolvedSource.language,
        targetLanguage: request.targetLanguage,
        sourceResolution: resolvedSource.resolution,
        detectedLanguage,
        providerId: this.#provider.id,
        providerVersion: this.#provider.version,
        glossaryVersion,
        outcome: "skipped_same_language",
        cacheStatus: "bypassed",
        cacheKey: null,
        durationMs: this.#elapsedSince(startedAt),
      };
    }

    const cacheKey = createTranslationCacheKey({
      providerId: this.#provider.id,
      providerVersion: this.#provider.version,
      sourceLanguage: resolvedSource.language,
      targetLanguage: request.targetLanguage,
      glossaryVersion,
      text: request.text,
    });
    const cached = this.#cache.get(cacheKey);

    if (cached) {
      return {
        requestId: request.requestId,
        originalText: request.text,
        translatedText: cached.translatedText,
        sourceLanguage: resolvedSource.language,
        targetLanguage: request.targetLanguage,
        sourceResolution: resolvedSource.resolution,
        detectedLanguage,
        providerId: this.#provider.id,
        providerVersion: this.#provider.version,
        glossaryVersion,
        outcome: "translated",
        cacheStatus: "hit",
        cacheKey,
        durationMs: this.#elapsedSince(startedAt),
      };
    }

    const resolvedRequest: ResolvedTranslationRequest = {
      text: request.text,
      sourceLanguage: resolvedSource.language,
      targetLanguage: request.targetLanguage,
      glossaryVersion,
      requestId: request.requestId,
    };
    const providerResult = await this.#translateWithTimeout(
      resolvedRequest,
      options,
    );
    this.#validateProviderResult(providerResult);

    this.#cache.set(cacheKey, {
      translatedText: providerResult.translatedText,
      createdAt: this.#now(),
    });

    return {
      requestId: request.requestId,
      originalText: request.text,
      translatedText: providerResult.translatedText,
      sourceLanguage: resolvedSource.language,
      targetLanguage: request.targetLanguage,
      sourceResolution: resolvedSource.resolution,
      detectedLanguage,
      providerId: this.#provider.id,
      providerVersion: this.#provider.version,
      glossaryVersion,
      outcome: "translated",
      cacheStatus: "miss",
      cacheKey,
      durationMs: this.#elapsedSince(startedAt),
    };
  }

  #validateRequest(request: TranslationRequest): void {
    if (typeof request !== "object" || request === null) {
      throw new TranslationError({
        code: "INVALID_ARGUMENT",
        message: "Translation request must be an object.",
        retryable: false,
      });
    }

    if (typeof request.text !== "string" || request.text.trim().length === 0) {
      throw new TranslationError({
        code: "INVALID_ARGUMENT",
        message: "Translation text must not be empty.",
        retryable: false,
      });
    }

    if (request.text.length > this.#maxTextLength) {
      throw new TranslationError({
        code: "INVALID_ARGUMENT",
        message: `Translation text exceeds ${this.#maxTextLength} characters.`,
        retryable: false,
      });
    }

    if (!isTranslationLanguage(request.targetLanguage)) {
      throw new TranslationError({
        code: "UNSUPPORTED_LANGUAGE",
        message: "Only Chinese and English translation are supported.",
        retryable: false,
      });
    }

    if (
      request.requestId !== undefined &&
      (typeof request.requestId !== "string" ||
        request.requestId.trim().length === 0)
    ) {
      throw new TranslationError({
        code: "INVALID_ARGUMENT",
        message: "requestId must be a non-empty string when provided.",
        retryable: false,
      });
    }
  }

  #validateProviderResult(
    result: ProviderTranslationResult,
  ): asserts result is ProviderTranslationResult {
    if (
      typeof result !== "object" ||
      result === null ||
      typeof result.translatedText !== "string" ||
      result.translatedText.trim().length === 0
    ) {
      throw new TranslationError({
        code: "TRANSLATION_INVALID_RESPONSE",
        message: "Translation provider returned an invalid response.",
        retryable: false,
        providerId: this.#provider.id,
      });
    }
  }

  async #translateWithTimeout(
    request: ResolvedTranslationRequest,
    options: TranslationCallOptions,
  ): Promise<ProviderTranslationResult> {
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    validatePositiveFiniteNumber(timeoutMs, "timeoutMs");

    if (options.signal?.aborted) {
      throw createAbortError(this.#provider.id);
    }

    const controller = new AbortController();
    let timeoutTriggered = false;
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;
    let removeCallerAbortListener = (): void => undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = globalThis.setTimeout(() => {
        timeoutTriggered = true;
        controller.abort();
        reject(createTimeoutError(this.#provider.id));
      }, timeoutMs);
    });

    const callerAbortPromise = new Promise<never>((_, reject) => {
      const callerSignal = options.signal;
      if (!callerSignal) {
        return;
      }

      const onCallerAbort = (): void => {
        controller.abort(callerSignal.reason);
        reject(createAbortError(this.#provider.id));
      };
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      removeCallerAbortListener = () => {
        callerSignal.removeEventListener("abort", onCallerAbort);
      };
    });

    try {
      return await Promise.race([
        this.#provider.translate(request, { signal: controller.signal }),
        timeoutPromise,
        callerAbortPromise,
      ]);
    } catch (error: unknown) {
      if (options.signal?.aborted) {
        throw createAbortError(this.#provider.id);
      }

      if (timeoutTriggered) {
        throw createTimeoutError(this.#provider.id);
      }

      if (error instanceof TranslationError) {
        throw error;
      }

      throw mapProviderError(error, this.#provider.id);
    } finally {
      if (timeoutHandle !== undefined) {
        globalThis.clearTimeout(timeoutHandle);
      }
      removeCallerAbortListener();
    }
  }

  #elapsedSince(startedAt: number): number {
    return Math.max(0, this.#now() - startedAt);
  }
}
