import { sha256Hex } from "./sha256";
import type { TranslationLanguage } from "./types";

export interface TranslationCacheKeyParts {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly sourceLanguage: TranslationLanguage;
  readonly targetLanguage: TranslationLanguage;
  readonly glossaryVersion: string;
  readonly text: string;
}

export interface CachedTranslation {
  readonly translatedText: string;
  readonly createdAt: number;
}

export interface TranslationCache {
  get(key: string): CachedTranslation | undefined;
  set(key: string, value: CachedTranslation): void;
  delete(key: string): boolean;
  clear(): void;
  readonly size: number;
}

export interface MemoryTranslationCacheOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

interface StoredTranslation {
  readonly value: CachedTranslation;
  readonly expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export function createTranslationCacheKey(
  parts: TranslationCacheKeyParts,
): string {
  const textHash = sha256Hex(parts.text);

  return [
    "translation:v1",
    `provider=${encodeKeyPart(parts.providerId)}`,
    `version=${encodeKeyPart(parts.providerVersion)}`,
    `source=${parts.sourceLanguage}`,
    `target=${parts.targetLanguage}`,
    `glossary=${encodeKeyPart(parts.glossaryVersion)}`,
    `textHash=sha256:${textHash}`,
  ].join("|");
}

export class MemoryTranslationCache implements TranslationCache {
  readonly #entries = new Map<string, StoredTranslation>();
  readonly #maxEntries: number;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(options: MemoryTranslationCacheOptions = {}) {
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;

    if (!Number.isInteger(this.#maxEntries) || this.#maxEntries <= 0) {
      throw new RangeError("maxEntries must be a positive integer.");
    }

    if (!Number.isFinite(this.#ttlMs) || this.#ttlMs <= 0) {
      throw new RangeError("ttlMs must be a positive finite number.");
    }
  }

  get size(): number {
    this.#pruneExpired();
    return this.#entries.size;
  }

  get(key: string): CachedTranslation | undefined {
    const stored = this.#entries.get(key);
    if (!stored) {
      return undefined;
    }

    if (stored.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }

    this.#entries.delete(key);
    this.#entries.set(key, stored);
    return stored.value;
  }

  set(key: string, value: CachedTranslation): void {
    this.#entries.delete(key);
    this.#entries.set(key, {
      value: Object.freeze({ ...value }),
      expiresAt: this.#now() + this.#ttlMs,
    });

    this.#evictOverflow();
  }

  delete(key: string): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  #pruneExpired(): void {
    const now = this.#now();
    for (const [key, stored] of this.#entries) {
      if (stored.expiresAt <= now) {
        this.#entries.delete(key);
      }
    }
  }

  #evictOverflow(): void {
    this.#pruneExpired();

    while (this.#entries.size > this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.#entries.delete(oldestKey);
    }
  }
}
