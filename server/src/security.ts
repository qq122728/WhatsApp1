import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { AppError } from "./errors.js";

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isForbiddenFieldName(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized.includes("session") ||
    normalized.includes("cookie") ||
    normalized.includes("storagestate") ||
    normalized.includes("localstorage") ||
    normalized.includes("indexeddb") ||
    normalized.includes("apikey") ||
    normalized.includes("credential") ||
    normalized === "token" ||
    normalized.endsWith("token")
  );
}

function findForbiddenField(
  value: unknown,
  path: string[] = [],
  visited = new WeakSet<object>(),
): string | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  if (visited.has(value)) {
    return undefined;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenField(value[index], [...path, String(index)], visited);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (isForbiddenFieldName(key)) {
      return nextPath.join(".");
    }
    const found = findForbiddenField(child, nextPath, visited);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function rejectPlatformSessionData(value: unknown): void {
  const forbiddenPath = findForbiddenField(value);
  if (forbiddenPath !== undefined) {
    throw new AppError(
      400,
      "PLATFORM_SESSION_FORBIDDEN",
      "Platform Session, Cookie, token and API key data must remain on the device",
      false,
      { path: forbiddenPath },
    );
  }
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretsEqual(left: string, right: string): boolean {
  const leftHash = Buffer.from(hashSecret(left), "hex");
  const rightHash = Buffer.from(hashSecret(right), "hex");
  return timingSafeEqual(leftHash, rightHash);
}

export function secretMatchesHash(secret: string, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return false;
  }
  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }
  const normalized = address.toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

export function readBearerToken(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/i.exec(value.trim());
  return match?.[1];
}

export function requireControlAccess(controlApiKey?: string) {
  return (request: Request): void => {
    if (controlApiKey === undefined) {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        throw new AppError(
          403,
          "CONTROL_ACCESS_DENIED",
          "Control API is restricted to loopback until CONTROL_API_KEY is configured",
        );
      }
      return;
    }

    const supplied =
      readBearerToken(request.header("authorization")) ??
      request.header("x-multiconnect-control-key");
    if (supplied === undefined || !secretsEqual(supplied, controlApiKey)) {
      throw new AppError(401, "UNAUTHORIZED", "Valid control credentials are required");
    }
  };
}
