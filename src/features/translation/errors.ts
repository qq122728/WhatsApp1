export const TRANSLATION_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "UNSUPPORTED_LANGUAGE",
  "TRANSLATION_TIMEOUT",
  "TRANSLATION_ABORTED",
  "TRANSLATION_QUOTA",
  "TRANSLATION_RATE_LIMITED",
  "TRANSLATION_UNAVAILABLE",
  "TRANSLATION_PROVIDER_ERROR",
  "TRANSLATION_INVALID_RESPONSE",
] as const;

export type TranslationErrorCode =
  (typeof TRANSLATION_ERROR_CODES)[number];

export interface TranslationErrorOptions {
  readonly code: TranslationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly providerId?: string;
  readonly cause?: unknown;
}

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly retryable: boolean;
  readonly providerId?: string;

  constructor(options: TranslationErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "TranslationError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.providerId = options.providerId;
  }
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code.toUpperCase() : undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}

export function mapProviderError(
  error: unknown,
  providerId: string,
): TranslationError {
  if (error instanceof TranslationError) {
    return error;
  }

  const providerCode = readErrorCode(error);

  if (
    providerCode === "TRANSLATION_QUOTA" ||
    providerCode === "QUOTA_EXCEEDED"
  ) {
    return new TranslationError({
      code: "TRANSLATION_QUOTA",
      message: "Translation quota is unavailable.",
      retryable: false,
      providerId,
      cause: error,
    });
  }

  if (
    providerCode === "TRANSLATION_RATE_LIMITED" ||
    providerCode === "RATE_LIMITED" ||
    providerCode === "TOO_MANY_REQUESTS"
  ) {
    return new TranslationError({
      code: "TRANSLATION_RATE_LIMITED",
      message: "Translation provider rate limit was reached.",
      retryable: true,
      providerId,
      cause: error,
    });
  }

  if (
    providerCode === "TRANSLATION_TIMEOUT" ||
    providerCode === "NETWORK_TIMEOUT" ||
    providerCode === "ETIMEDOUT" ||
    providerCode === "TIMEOUT"
  ) {
    return new TranslationError({
      code: "TRANSLATION_TIMEOUT",
      message: "Translation request timed out.",
      retryable: true,
      providerId,
      cause: error,
    });
  }

  if (
    providerCode === "TRANSLATION_UNAVAILABLE" ||
    providerCode === "DNS_FAILURE" ||
    providerCode === "ECONNREFUSED" ||
    error instanceof TypeError
  ) {
    return new TranslationError({
      code: "TRANSLATION_UNAVAILABLE",
      message: "Translation provider is unavailable.",
      retryable: true,
      providerId,
      cause: error,
    });
  }

  if (isAbortError(error)) {
    return new TranslationError({
      code: "TRANSLATION_ABORTED",
      message: "Translation request was cancelled.",
      retryable: false,
      providerId,
      cause: error,
    });
  }

  return new TranslationError({
    code: "TRANSLATION_PROVIDER_ERROR",
    message: "Translation provider failed.",
    retryable: false,
    providerId,
    cause: error,
  });
}
