import { createTranslationCacheKey, MemoryTranslationCache } from "./cache";
import { TranslationError } from "./errors";
import { detectLanguage } from "./language-detector";
import { MockTranslationProvider } from "./mock-provider";
import { TranslationService } from "./service";
import { sha256Hex } from "./sha256";

export interface TranslationSelfCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly details?: string;
}

export interface TranslationSelfCheckReport {
  readonly passed: boolean;
  readonly checks: readonly TranslationSelfCheck[];
}

function check(
  name: string,
  passed: boolean,
  details?: string,
): TranslationSelfCheck {
  return { name, passed, details };
}

export async function runTranslationSelfCheck(): Promise<TranslationSelfCheckReport> {
  const checks: TranslationSelfCheck[] = [];

  checks.push(
    check(
      "SHA-256 known vector",
      sha256Hex("abc") ===
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ),
  );
  checks.push(
    check("Detect Chinese", detectLanguage("你好，世界").language === "zh"),
  );
  checks.push(
    check("Detect English", detectLanguage("Hello world").language === "en"),
  );
  checks.push(
    check("Reject script-free input", detectLanguage("12345").language === "unknown"),
  );

  const provider = new MockTranslationProvider();
  const cache = new MemoryTranslationCache();
  const service = new TranslationService(provider, cache);

  const skipped = await service.translate({
    text: "Hello",
    targetLanguage: "en",
  });
  checks.push(
    check(
      "Skip same-language translation",
      skipped.outcome === "skipped_same_language" &&
        provider.translationCallCount === 0,
    ),
  );

  const first = await service.translate({
    text: "你好",
    targetLanguage: "en",
    glossaryVersion: "support-v1",
  });
  const second = await service.translate({
    text: "你好",
    targetLanguage: "en",
    glossaryVersion: "support-v1",
  });
  checks.push(
    check(
      "Translate and reuse memory cache",
      first.translatedText === "Hello" &&
        first.cacheStatus === "miss" &&
        second.cacheStatus === "hit" &&
        provider.translationCallCount === 1,
    ),
  );

  const cacheKey = createTranslationCacheKey({
    providerId: "mock",
    providerVersion: "1",
    sourceLanguage: "zh",
    targetLanguage: "en",
    glossaryVersion: "support-v1",
    text: "你好",
  });
  checks.push(
    check(
      "Cache key contains every required dimension",
      cacheKey.includes("provider=mock") &&
        cacheKey.includes("version=1") &&
        cacheKey.includes("source=zh") &&
        cacheKey.includes("target=en") &&
        cacheKey.includes("glossary=support-v1") &&
        cacheKey.includes("textHash=sha256:") &&
        !cacheKey.includes("你好"),
    ),
  );

  const slowService = new TranslationService(
    new MockTranslationProvider({ latencyMs: 25 }),
    new MemoryTranslationCache(),
    { timeoutMs: 1 },
  );
  let timeoutMapped = false;
  try {
    await slowService.translate({
      text: "你好",
      targetLanguage: "en",
    });
  } catch (error: unknown) {
    timeoutMapped =
      error instanceof TranslationError &&
      error.code === "TRANSLATION_TIMEOUT" &&
      error.retryable;
  }
  checks.push(check("Map provider timeout", timeoutMapped));

  return {
    passed: checks.every((item) => item.passed),
    checks,
  };
}
