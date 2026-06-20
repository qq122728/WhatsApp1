import { z } from "zod";
import { isLoopbackAddress } from "./security.js";

function booleanFromEnv(defaultValue: boolean) {
  return z
    .enum(["true", "false"])
    .default(String(defaultValue) as "true" | "false")
    .transform((value) => value === "true");
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65535).default(8000),
  CORS_ORIGINS: z.string().default(""),
  CONTROL_API_KEY: z.string().min(16).optional(),
  DEVICE_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(604800)
    .default(86400),
  WS_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .default(15000),
  WS_MAX_PAYLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(1048576)
    .default(1048576),
  COMMAND_TIMEOUT_MAX_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .default(30000),
  REQUIRE_TLS: booleanFromEnv(false),
  TRUST_PROXY: booleanFromEnv(false),
});

export interface ServerConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  corsOrigins: ReadonlySet<string>;
  controlApiKey?: string;
  deviceTokenTtlSeconds: number;
  wsHeartbeatIntervalMs: number;
  wsMaxPayloadBytes: number;
  commandTimeoutMaxMs: number;
  requireTls: boolean;
  trustProxy: boolean;
}

export function loadConfig(
  source: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const parsed = envSchema.parse({
    ...source,
    CONTROL_API_KEY: source.CONTROL_API_KEY?.trim() || undefined,
  });

  if (!isLoopbackAddress(parsed.HOST) && parsed.HOST !== "localhost" && !parsed.REQUIRE_TLS) {
    throw new Error("A non-loopback HOST requires REQUIRE_TLS=true");
  }

  const config: ServerConfig = {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    corsOrigins: new Set(
      parsed.CORS_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    deviceTokenTtlSeconds: parsed.DEVICE_TOKEN_TTL_SECONDS,
    wsHeartbeatIntervalMs: parsed.WS_HEARTBEAT_INTERVAL_MS,
    wsMaxPayloadBytes: parsed.WS_MAX_PAYLOAD_BYTES,
    commandTimeoutMaxMs: parsed.COMMAND_TIMEOUT_MAX_MS,
    requireTls: parsed.REQUIRE_TLS,
    trustProxy: parsed.TRUST_PROXY,
  };

  if (parsed.CONTROL_API_KEY !== undefined) {
    config.controlApiKey = parsed.CONTROL_API_KEY;
  }
  return config;
}

export function isAllowedOrigin(
  origin: string,
  config: ServerConfig,
): boolean {
  if (config.corsOrigins.has(origin)) {
    return true;
  }
  if (config.nodeEnv !== "development" && config.nodeEnv !== "test") {
    return false;
  }

  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}
