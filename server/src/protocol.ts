import { randomUUID } from "node:crypto";
export const PROTOCOL_VERSION = 1 as const;

export interface RestEnvelope<T = unknown> {
  protocolVersion: typeof PROTOCOL_VERSION;
  messageId: string;
  type: string;
  timestamp: string;
  data: T;
}

export interface RestErrorEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  messageId: string;
  type: "error";
  timestamp: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId?: string;
    details?: unknown;
  };
}

export function createRestEnvelope<T>(
  type: string,
  data: T,
  messageId = randomUUID(),
): RestEnvelope<T> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId,
    type,
    timestamp: new Date().toISOString(),
    data,
  };
}

export function createRestErrorEnvelope(
  code: string,
  message: string,
  retryable: boolean,
  options: {
    requestId?: string;
    details?: unknown;
    messageId?: string;
  } = {},
): RestErrorEnvelope {
  const error: RestErrorEnvelope["error"] = {
    code,
    message,
    retryable,
  };

  if (options.requestId !== undefined) {
    error.requestId = options.requestId;
  }
  if (options.details !== undefined) {
    error.details = options.details;
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId: options.messageId ?? randomUUID(),
    type: "error",
    timestamp: new Date().toISOString(),
    error,
  };
}
