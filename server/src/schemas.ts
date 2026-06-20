import { z } from "zod";
import { PROTOCOL_VERSION } from "./protocol.js";

const opaqueIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const deviceIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const registrationSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    deviceId: deviceIdSchema,
    name: z.string().trim().min(1).max(100),
    clientVersion: z.string().trim().min(1).max(64).optional(),
    capabilities: z
      .array(z.string().trim().min(1).max(64))
      .max(50)
      .default([]),
  })
  .strict();

export const deviceParamsSchema = z.object({
  deviceId: deviceIdSchema,
});

export const commandRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    idempotencyKey: opaqueIdSchema,
    commandType: z.literal("device.status.request"),
    timeoutMs: z.number().int().min(1000).optional(),
  })
  .strict();
