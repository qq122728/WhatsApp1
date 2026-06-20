import { TranslationError } from "./errors";
import type {
  ProviderTranslationResult,
  ResolvedTranslationRequest,
  TranslationProvider,
  TranslationProviderContext,
} from "./types";

export interface MockTranslationProviderFailure {
  readonly code:
    | "TRANSLATION_QUOTA"
    | "TRANSLATION_RATE_LIMITED"
    | "TRANSLATION_UNAVAILABLE"
    | "TRANSLATION_PROVIDER_ERROR";
  readonly message?: string;
  readonly retryable?: boolean;
}

export interface MockTranslationProviderOptions {
  readonly id?: string;
  readonly version?: string;
  readonly latencyMs?: number;
  readonly failure?: MockTranslationProviderFailure;
  readonly translations?: Readonly<Record<string, string>>;
}

const DEFAULT_TRANSLATIONS: Readonly<Record<string, string>> = Object.freeze({
  "zh:en:你好": "Hello",
  "en:zh:Hello": "你好",
  "zh:en:订单已发货": "Your order has shipped.",
  "en:zh:Your order has shipped.": "您的订单已发货。",
});

function translationKey(request: ResolvedTranslationRequest): string {
  return `${request.sourceLanguage}:${request.targetLanguage}:${request.text}`;
}

function waitForLatency(
  latencyMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("The operation was aborted.", "AbortError"),
    );
  }

  if (latencyMs === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onTimeout = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => {
      globalThis.clearTimeout(timeout);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    const timeout = globalThis.setTimeout(onTimeout, latencyMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class MockTranslationProvider implements TranslationProvider {
  readonly id: string;
  readonly version: string;
  readonly #latencyMs: number;
  readonly #failure?: MockTranslationProviderFailure;
  readonly #translations: Readonly<Record<string, string>>;
  #translationCallCount = 0;

  constructor(options: MockTranslationProviderOptions = {}) {
    this.id = options.id ?? "mock";
    this.version = options.version ?? "1";
    this.#latencyMs = options.latencyMs ?? 0;
    this.#failure = options.failure;
    this.#translations = {
      ...DEFAULT_TRANSLATIONS,
      ...options.translations,
    };

    if (!Number.isFinite(this.#latencyMs) || this.#latencyMs < 0) {
      throw new RangeError("latencyMs must be a non-negative finite number.");
    }
  }

  get translationCallCount(): number {
    return this.#translationCallCount;
  }

  async translate(
    request: ResolvedTranslationRequest,
    context: TranslationProviderContext,
  ): Promise<ProviderTranslationResult> {
    this.#translationCallCount += 1;
    await waitForLatency(this.#latencyMs, context.signal);

    if (this.#failure) {
      throw new TranslationError({
        code: this.#failure.code,
        message: this.#failure.message ?? "Configured mock provider failure.",
        retryable: this.#failure.retryable ?? false,
        providerId: this.id,
      });
    }

    const exactTranslation = this.#translations[translationKey(request)];
    if (exactTranslation !== undefined) {
      return { translatedText: exactTranslation };
    }

    return {
      translatedText:
        request.targetLanguage === "zh"
          ? `模拟翻译（${request.sourceLanguage} → zh）：${request.text}`
          : `Mock translation (${request.sourceLanguage} → en): ${request.text}`,
    };
  }
}
