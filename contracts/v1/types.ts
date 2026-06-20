export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

export const MESSAGE_TYPES = [
  "device.hello",
  "device.status",
  "command.request",
  "command.ack",
  "command.result",
  "heartbeat",
  "error",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface Envelope<
  TType extends MessageType = MessageType,
  TPayload = unknown,
> {
  readonly protocolVersion: ProtocolVersion;
  readonly messageId: string;
  readonly type: TType;
  readonly timestamp: string;
  /**
   * Monotonically increases per sender and per WSS connection, starting at 1.
   * It orders frames, but does not imply command completion order.
   */
  readonly sequence: number;
  readonly payload: TPayload;
}

export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON-only data accepted by generic command parameters and results.
 * Runtime schema validation additionally rejects sensitive property names.
 */
export type SafeJsonValue =
  | JsonPrimitive
  | readonly SafeJsonValue[]
  | SafeJsonObject;

export interface SafeJsonObject {
  readonly [key: string]: SafeJsonValue;
}

export const DEVICE_OPERATING_SYSTEMS = [
  "windows",
  "macos",
  "linux",
] as const;

export type DeviceOperatingSystem =
  (typeof DEVICE_OPERATING_SYSTEMS)[number];

export const DEVICE_ARCHITECTURES = [
  "x86_64",
  "aarch64",
  "unknown",
] as const;

export type DeviceArchitecture = (typeof DEVICE_ARCHITECTURES)[number];

export const DEVICE_CONNECTION_STATUSES = [
  "starting",
  "ready",
  "degraded",
  "busy",
  "shutting_down",
] as const;

export type DeviceConnectionStatus =
  (typeof DEVICE_CONNECTION_STATUSES)[number];

export const MESSAGING_PLATFORMS = [
  "whatsapp",
  "telegram",
  "rcs",
] as const;

export type MessagingPlatform = (typeof MESSAGING_PLATFORMS)[number];

export const ACCOUNT_STATUSES = [
  "initializing",
  "awaiting_auth",
  "online",
  "degraded",
  "offline",
  "expired",
  "error",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const COMMAND_ACK_STATUSES = [
  "accepted",
  "rejected",
  "duplicate",
  "expired",
] as const;

export type CommandAckStatus = (typeof COMMAND_ACK_STATUSES)[number];

export const COMMAND_RESULT_STATUSES = [
  "succeeded",
  "failed",
  "unknown",
  "cancelled",
  "expired",
] as const;

export type CommandResultStatus = (typeof COMMAND_RESULT_STATUSES)[number];

export const ERROR_CATEGORIES = [
  "protocol",
  "device_auth",
  "pairing",
  "authorization",
  "command",
  "account",
  "account_auth",
  "validation",
  "network",
  "platform",
  "adapter",
  "storage",
  "crypto",
  "translation",
  "internal",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const ERROR_CODES = [
  "PROTOCOL_UNSUPPORTED_VERSION",
  "PROTOCOL_INVALID_MESSAGE",
  "PROTOCOL_INVALID_SEQUENCE",
  "PROTOCOL_MESSAGE_TOO_LARGE",
  "PROTOCOL_CLOCK_SKEW",
  "DEVICE_AUTH_REQUIRED",
  "DEVICE_AUTH_INVALID",
  "PAIRING_REQUIRED",
  "PAIRING_REVOKED",
  "PERMISSION_DENIED",
  "COMMAND_UNSUPPORTED",
  "COMMAND_EXPIRED",
  "COMMAND_TIMEOUT",
  "COMMAND_CANCELLED",
  "COMMAND_BUSY",
  "IDEMPOTENCY_CONFLICT",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_NOT_READY",
  "AUTH_TIMEOUT",
  "AUTH_EXPIRED",
  "NETWORK_TIMEOUT",
  "DNS_FAILURE",
  "PLATFORM_RATE_LIMITED",
  "PLATFORM_REJECTED",
  "ADAPTER_UNAVAILABLE",
  "ADAPTER_CRASHED",
  "SELECTOR_MISMATCH",
  "DB_LOCKED",
  "DISK_FULL",
  "KEYCHAIN_LOCKED",
  "DECRYPT_FAILED",
  "TRANSLATION_QUOTA",
  "TRANSLATION_TIMEOUT",
  "INVALID_ARGUMENT",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

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
} as const satisfies Readonly<Record<ErrorCode, ErrorCategory>>;

export interface ProtocolErrorDetail {
  readonly code: ErrorCode;
  readonly category: ErrorCategory;
  /**
   * A short, sanitized message. It must not contain stack traces, message
   * bodies, phone numbers, platform Sessions, tokens, or credentials.
   */
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly field?: string;
}

export interface DeviceRuntime {
  readonly os: DeviceOperatingSystem;
  readonly architecture: DeviceArchitecture;
}

export interface DeviceCapabilities {
  readonly commandNames: readonly string[];
  readonly maxConcurrentCommands: number;
  readonly supportsCommandCancellation: boolean;
}

export interface DeviceHelloPayload {
  /** Stable public identifier assigned to the paired device. */
  readonly deviceId: string;
  /** New identifier for every WSS connection. */
  readonly connectionId: string;
  readonly clientVersion: string;
  readonly supportedProtocolVersions: readonly number[];
  readonly runtime: DeviceRuntime;
  readonly capabilities: DeviceCapabilities;
}

export type DeviceHello = Envelope<"device.hello", DeviceHelloPayload>;

export interface AccountStatusSummary {
  readonly accountId: string;
  readonly platform: MessagingPlatform;
  readonly status: AccountStatus;
  readonly occurredAt: string;
  readonly reasonCode?: ErrorCode;
  readonly summary?: string;
}

export interface DeviceStatusPayload {
  /** Monotonic for the lifetime of the installed device identity. */
  readonly statusRevision: number;
  readonly status: DeviceConnectionStatus;
  readonly activeCommandCount: number;
  readonly queuedCommandCount: number;
  readonly accounts: readonly AccountStatusSummary[];
  readonly lastSuccessfulSyncAt?: string;
}

export type DeviceStatus = Envelope<"device.status", DeviceStatusPayload>;

export interface CommandRequestPayload {
  /** Stable across transport retries of the same command invocation. */
  readonly commandId: string;
  /**
   * Stable for the same logical side effect. Reusing it with different
   * command content is an IDEMPOTENCY_CONFLICT.
   */
  readonly idempotencyKey: string;
  /** UTC RFC 3339 timestamp after which a not-yet-accepted command is rejected. */
  readonly expiresAt: string;
  readonly commandName: string;
  readonly executionTimeoutMs: number;
  /**
   * Commands sharing an orderingKey execute serially in request sequence.
   * Commands without the same key may execute concurrently.
   */
  readonly orderingKey?: string;
  readonly parameters: SafeJsonObject;
}

export type CommandRequest = Envelope<
  "command.request",
  CommandRequestPayload
>;

export interface CommandAckPayload {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  readonly status: CommandAckStatus;
  readonly acknowledgedAt: string;
  readonly error?: ProtocolErrorDetail;
}

export type CommandAck = Envelope<"command.ack", CommandAckPayload>;

export interface CommandResultPayload {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  readonly status: CommandResultStatus;
  readonly completedAt: string;
  readonly result?: SafeJsonObject;
  readonly error?: ProtocolErrorDetail;
}

export type CommandResult = Envelope<
  "command.result",
  CommandResultPayload
>;

export interface HeartbeatPingPayload {
  readonly kind: "ping";
  readonly nonce: string;
  readonly lastReceivedSequence?: number;
}

export interface HeartbeatPongPayload {
  readonly kind: "pong";
  readonly nonce: string;
  readonly replyToMessageId: string;
  readonly lastReceivedSequence?: number;
}

export type HeartbeatPayload =
  | HeartbeatPingPayload
  | HeartbeatPongPayload;

export type Heartbeat = Envelope<"heartbeat", HeartbeatPayload>;

export interface ErrorPayload {
  readonly error: ProtocolErrorDetail;
  readonly fatal: boolean;
  readonly relatedMessageId?: string;
  readonly commandId?: string;
}

export type Error = Envelope<"error", ErrorPayload>;

export type ErrorMessage = Error;

export type ProtocolMessage =
  | DeviceHello
  | DeviceStatus
  | CommandRequest
  | CommandAck
  | CommandResult
  | Heartbeat
  | Error;
