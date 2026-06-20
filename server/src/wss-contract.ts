import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
} from "ajv/dist/2020.js";
import { z } from "zod";
import { PROTOCOL_VERSION } from "./protocol.js";

export const WSS_SUBPROTOCOL = "multiconnect.v1";

export const ERROR_CODE_CATEGORIES = {
  PROTOCOL_UNSUPPORTED_VERSION: "protocol",
  PROTOCOL_INVALID_MESSAGE: "protocol",
  PROTOCOL_INVALID_SEQUENCE: "protocol",
  PROTOCOL_MESSAGE_TOO_LARGE: "protocol",
  PROTOCOL_CLOCK_SKEW: "protocol",
  DEVICE_AUTH_REQUIRED: "device_auth",
  DEVICE_AUTH_INVALID: "device_auth",
  PAIRING_REQUIRED: "pairing",
  PAIRING_REVOKED: "pairing",
  PERMISSION_DENIED: "authorization",
  COMMAND_UNSUPPORTED: "command",
  COMMAND_EXPIRED: "command",
  COMMAND_TIMEOUT: "command",
  COMMAND_CANCELLED: "command",
  COMMAND_BUSY: "command",
  IDEMPOTENCY_CONFLICT: "command",
  ACCOUNT_NOT_FOUND: "account",
  ACCOUNT_NOT_READY: "account",
  AUTH_TIMEOUT: "account_auth",
  AUTH_EXPIRED: "account_auth",
  NETWORK_TIMEOUT: "network",
  DNS_FAILURE: "network",
  PLATFORM_RATE_LIMITED: "platform",
  PLATFORM_REJECTED: "platform",
  ADAPTER_UNAVAILABLE: "adapter",
  ADAPTER_CRASHED: "adapter",
  SELECTOR_MISMATCH: "adapter",
  DB_LOCKED: "storage",
  DISK_FULL: "storage",
  KEYCHAIN_LOCKED: "crypto",
  DECRYPT_FAILED: "crypto",
  TRANSLATION_QUOTA: "translation",
  TRANSLATION_TIMEOUT: "translation",
  INVALID_ARGUMENT: "validation",
  INTERNAL_ERROR: "internal",
} as const;

export type WssErrorCode = keyof typeof ERROR_CODE_CATEGORIES;
export type WssErrorCategory =
  (typeof ERROR_CODE_CATEGORIES)[WssErrorCode];
export type DeviceConnectionStatus =
  | "starting"
  | "ready"
  | "degraded"
  | "busy"
  | "shutting_down";
export type CommandAckStatus =
  | "accepted"
  | "rejected"
  | "duplicate"
  | "expired";
export type CommandResultStatus =
  | "succeeded"
  | "failed"
  | "unknown"
  | "cancelled"
  | "expired";

export interface ProtocolErrorDetail {
  code: WssErrorCode;
  category: WssErrorCategory;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  field?: string;
}

export interface DeviceHelloPayload {
  deviceId: string;
  connectionId: string;
  clientVersion: string;
  supportedProtocolVersions: number[];
  runtime: {
    os: "windows" | "macos" | "linux";
    architecture: "x86_64" | "aarch64" | "unknown";
  };
  capabilities: {
    commandNames: string[];
    maxConcurrentCommands: number;
    supportsCommandCancellation: boolean;
  };
}

export interface AccountStatusSummary {
  accountId: string;
  platform: "whatsapp" | "telegram" | "rcs";
  status:
    | "initializing"
    | "awaiting_auth"
    | "online"
    | "degraded"
    | "offline"
    | "expired"
    | "error";
  occurredAt: string;
  reasonCode?: WssErrorCode;
  summary?: string;
}

export interface DeviceStatusPayload {
  statusRevision: number;
  status: DeviceConnectionStatus;
  activeCommandCount: number;
  queuedCommandCount: number;
  accounts: AccountStatusSummary[];
  lastSuccessfulSyncAt?: string;
}

export interface CommandRequestPayload {
  commandId: string;
  idempotencyKey: string;
  expiresAt: string;
  commandName: string;
  executionTimeoutMs: number;
  orderingKey?: string;
  parameters: Record<string, unknown>;
}

export interface CommandAckPayload {
  commandId: string;
  idempotencyKey: string;
  expiresAt: string;
  status: CommandAckStatus;
  acknowledgedAt: string;
  error?: ProtocolErrorDetail;
}

export interface CommandResultPayload {
  commandId: string;
  idempotencyKey: string;
  expiresAt: string;
  status: CommandResultStatus;
  completedAt: string;
  result?: Record<string, unknown> | DeviceStatusPayload;
  error?: ProtocolErrorDetail;
}

export type HeartbeatPayload =
  | {
      kind: "ping";
      nonce: string;
      lastReceivedSequence?: number;
    }
  | {
      kind: "pong";
      nonce: string;
      replyToMessageId: string;
      lastReceivedSequence?: number;
    };

export interface ErrorPayload {
  error: ProtocolErrorDetail;
  fatal: boolean;
  relatedMessageId?: string;
  commandId?: string;
}

export type WssMessageType =
  | "device.hello"
  | "device.status"
  | "command.request"
  | "command.ack"
  | "command.result"
  | "heartbeat"
  | "error";

export interface WssPayloadByType {
  "device.hello": DeviceHelloPayload;
  "device.status": DeviceStatusPayload;
  "command.request": CommandRequestPayload;
  "command.ack": CommandAckPayload;
  "command.result": CommandResultPayload;
  heartbeat: HeartbeatPayload;
  error: ErrorPayload;
}

export interface WssEnvelope<TType extends WssMessageType = WssMessageType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  messageId: string;
  type: TType;
  timestamp: string;
  sequence: number;
  payload: WssPayloadByType[TType];
}

export type WssMessage = {
  [TType in WssMessageType]: WssEnvelope<TType>;
}[WssMessageType];

const contractPath = fileURLToPath(
  new URL(
    "../../contracts/v1/multiconnect.v1.schema.json",
    import.meta.url,
  ),
);
const contractSchema: unknown = JSON.parse(
  readFileSync(contractPath, "utf8"),
);
const ajv = new Ajv2020({
  allErrors: true,
  // The shared schema intentionally composes Envelope with allOf and
  // unevaluatedProperties, which Ajv's strictTypes mode warns about.
  // Validation semantics remain Draft 2020-12 compliant with strict disabled.
  strict: false,
});
ajv.addFormat("date-time", {
  type: "string",
  validate(value: string): boolean {
    return (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
      Number.isFinite(Date.parse(value))
    );
  },
});
const validateContract = ajv.compile<WssMessage>(
  contractSchema as AnySchema,
);

function formatValidationErrors(
  errors: ErrorObject[] | null | undefined,
): string[] {
  return (errors ?? []).slice(0, 10).map((error) => {
    const path = error.instancePath || "/";
    return `${path} ${error.message ?? "is invalid"}`;
  });
}

export class WssContractValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super("WSS message does not match contracts v1");
    this.name = "WssContractValidationError";
  }
}

export function parseWssMessage(value: unknown): WssMessage {
  if (!validateContract(value)) {
    throw new WssContractValidationError(
      formatValidationErrors(validateContract.errors),
    );
  }
  return value as WssMessage;
}

export function createWssEnvelope<TType extends WssMessageType>(
  type: TType,
  payload: WssPayloadByType[TType],
  sequence: number,
  messageId: string,
): WssEnvelope<TType> {
  const envelope: WssEnvelope<TType> = {
    protocolVersion: PROTOCOL_VERSION,
    messageId,
    type,
    timestamp: new Date().toISOString(),
    sequence,
    payload,
  };
  parseWssMessage(envelope);
  return envelope;
}

export function createProtocolError(
  code: WssErrorCode,
  message: string,
  retryable = false,
  options: {
    retryAfterMs?: number;
    field?: string;
  } = {},
): ProtocolErrorDetail {
  return {
    code,
    category: ERROR_CODE_CATEGORIES[code],
    message,
    retryable,
    ...(options.retryAfterMs !== undefined
      ? { retryAfterMs: options.retryAfterMs }
      : {}),
    ...(options.field !== undefined ? { field: options.field } : {}),
  };
}

const timestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/,
  )
  .refine((value) => Number.isFinite(Date.parse(value)));

const accountStatusSummarySchema = z
  .object({
    accountId: z.string().min(16).max(128),
    platform: z.enum(["whatsapp", "telegram", "rcs"]),
    status: z.enum([
      "initializing",
      "awaiting_auth",
      "online",
      "degraded",
      "offline",
      "expired",
      "error",
    ]),
    occurredAt: timestampSchema,
    reasonCode: z
      .enum(
        Object.keys(ERROR_CODE_CATEGORIES) as [
          WssErrorCode,
          ...WssErrorCode[],
        ],
      )
      .optional(),
    summary: z.string().max(256).optional(),
  })
  .strict();

export const deviceStatusPayloadSchema = z
  .object({
    statusRevision: z.number().int().min(1),
    status: z.enum([
      "starting",
      "ready",
      "degraded",
      "busy",
      "shutting_down",
    ]),
    activeCommandCount: z.number().int().min(0).max(10000),
    queuedCommandCount: z.number().int().min(0).max(100000),
    accounts: z.array(accountStatusSummarySchema).max(10000),
    lastSuccessfulSyncAt: timestampSchema.optional(),
  })
  .strict();
