export interface RequestEnvelope {
  id: string;
  method: string;
  params?: unknown;
}

export interface SuccessEnvelope {
  id: string;
  ok: true;
  result: unknown;
}

export interface ErrorEnvelope {
  id: string;
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export type ResponseEnvelope = SuccessEnvelope | ErrorEnvelope;

export class SidecarError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "SidecarError";
  }
}

export function success(id: string, result: unknown): SuccessEnvelope {
  return { id, ok: true, result };
}

export function failure(id: string, error: unknown): ErrorEnvelope {
  if (error instanceof SidecarError) {
    return {
      id,
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    };
  }

  return {
    id,
    ok: false,
    error: {
      code: "SIDECAR_INTERNAL_ERROR",
      message: "The platform sidecar encountered an internal error.",
      retryable: false,
    },
  };
}
