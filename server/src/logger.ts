import { createHash } from "node:crypto";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const REDACTED = "[REDACTED]";
const REDACT_KEY =
  /(authorization|cookie|secret|password|token|session|api.?key|storage.?state|message.?body|content|text|phone)/i;
const HASH_KEY = /(device|account|user).*id/i;

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function sanitize(value: unknown, key = "", depth = 0): unknown {
  if (REDACT_KEY.test(key)) {
    return REDACTED;
  }
  if (depth > 5) {
    return "[TRUNCATED]";
  }
  if (HASH_KEY.test(key) && typeof value === "string") {
    return `sha256:${hashIdentifier(value)}`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitize(item, key, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = sanitize(childValue, childKey, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > 512) {
    return `${value.slice(0, 512)}…`;
  }
  return value;
}

export class Logger {
  constructor(private readonly minimumLevel: LogLevel = "info") {}

  debug(event: string, fields: LogFields = {}): void {
    this.write("debug", event, fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write("error", event, fields);
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    const order: LogLevel[] = ["debug", "info", "warn", "error"];
    if (order.indexOf(level) < order.indexOf(this.minimumLevel)) {
      return;
    }

    const sanitizedFields = sanitize(fields);
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(sanitizedFields !== null && typeof sanitizedFields === "object"
        ? sanitizedFields
        : {}),
    });

    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}
