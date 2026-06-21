import { randomBytes, randomUUID } from "node:crypto";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { ServerConfig } from "./config.js";
import { isAllowedOrigin } from "./config.js";
import type { DeviceChannelHub } from "./device-channel.js";
import { AppError, errorHandler } from "./errors.js";
import type { Logger } from "./logger.js";
import { renderConsoleHtml } from "./console-page.js";
import { createRestEnvelope } from "./protocol.js";
import {
  commandRequestSchema,
  deviceParamsSchema,
  registrationSchema,
} from "./schemas.js";
import {
  hashSecret,
  rejectPlatformSessionData,
  requireControlAccess,
} from "./security.js";
import type { InMemoryDeviceStore } from "./store/device-store.js";

function asyncRoute(
  handler: (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
}

export function createApp(
  config: ServerConfig,
  store: InMemoryDeviceStore,
  hub: DeviceChannelHub,
  logger: Logger,
) {
  const app = express();
  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }
  app.disable("x-powered-by");

  app.use((request, response, next) => {
    request.requestId =
      request.header("x-request-id")?.match(/^[A-Za-z0-9._:-]{8,128}$/)?.[0] ??
      randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  });

  app.use((request, _response, next) => {
    if (config.requireTls && !request.secure) {
      next(
        new AppError(
          426,
          "TLS_REQUIRED",
          "HTTPS/WSS is required for this deployment",
        ),
      );
      return;
    }
    next();
  });

  app.use(
    cors({
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        "X-Request-Id",
        "X-MultiConnect-Control-Key",
        "X-MultiConnect-Device",
      ],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 600,
      origin(origin, callback) {
        if (origin === undefined || isAllowedOrigin(origin, config)) {
          callback(null, true);
          return;
        }
        callback(
          new AppError(
            403,
            "CORS_ORIGIN_DENIED",
            "The request origin is not allowed",
          ),
        );
      },
    }),
  );

  app.use(express.json({ limit: config.wsMaxPayloadBytes, strict: true }));
  app.use((request, _response, next) => {
    try {
      if (request.body !== undefined) {
        rejectPlatformSessionData(request.body);
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  app.use((request, response, next) => {
    const startedAt = performance.now();
    response.on("finish", () => {
      logger.info("request.completed", {
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
        remoteAddress: request.socket.remoteAddress,
      });
    });
    next();
  });

  const assertControlAccess = requireControlAccess(config.controlApiKey);
  const controlOnly = (
    request: Request,
    _response: Response,
    next: NextFunction,
  ): void => {
    try {
      assertControlAccess(request);
      next();
    } catch (error) {
      next(error);
    }
  };

  const consoleHandler = (_request: Request, response: Response): void => {
    response
      .setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      )
      .type("html")
      .send(renderConsoleHtml());
  };

  app.get("/", (_request, response) => {
    response.redirect(302, "/console");
  });
  app.get("/console", consoleHandler);
  app.get("/console/", consoleHandler);

  app.get("/health", (_request, response) => {
    response.json(
      createRestEnvelope("health.status", {
        status: "ok",
        service: "multiconnect-control-server",
        storage: {
          kind: "memory",
          durable: false,
        },
        uptimeSeconds: Math.floor(process.uptime()),
      }),
    );
  });

  app.post("/api/v1/devices/register", controlOnly, (request, response) => {
    const registration = registrationSchema.parse(request.body);
    hub.disconnectDevice(registration.deviceId);

    const deviceToken = randomBytes(32).toString("base64url");
    const credentialExpiresAt = new Date(
      Date.now() + config.deviceTokenTtlSeconds * 1000,
    ).toISOString();
    const normalizedRegistration = {
      protocolVersion: registration.protocolVersion,
      deviceId: registration.deviceId,
      name: registration.name,
      capabilities: registration.capabilities,
      ...(registration.clientVersion !== undefined
        ? { clientVersion: registration.clientVersion }
        : {}),
    };
    const device = store.register(
      normalizedRegistration,
      hashSecret(deviceToken),
      credentialExpiresAt,
    );
    logger.info("device.registered", {
      requestId: request.requestId,
      deviceId: registration.deviceId,
      capabilityCount: registration.capabilities.length,
      credentialExpiresAt,
      storageKind: "memory",
    });
    response.status(201).json(
      createRestEnvelope("device.registered", {
        device,
        credentials: {
          deviceToken,
          expiresAt: credentialExpiresAt,
          transport: "Authorization: Bearer <deviceToken>",
        },
        websocketPath: `/api/v1/devices/${encodeURIComponent(
          registration.deviceId,
        )}/channel`,
      }),
    );
  });

  app.get("/api/v1/devices", controlOnly, (_request, response) => {
    response.json(
      createRestEnvelope("device.list", {
        devices: store.list(),
        storage: { kind: "memory", durable: false },
      }),
    );
  });

  app.get("/api/v1/devices/:deviceId/status", controlOnly, (request, response) => {
    const { deviceId } = deviceParamsSchema.parse(request.params);
    const device = store.get(deviceId);
    if (device === undefined) {
      throw new AppError(404, "DEVICE_NOT_FOUND", "Device was not found");
    }
    const { credentialHash: _credentialHash, ...publicDevice } = device;
    response.json(
      createRestEnvelope("device.status", {
        device: publicDevice,
        channelConnected: hub.isConnected(deviceId),
      }),
    );
  });

  app.post(
    "/api/v1/devices/:deviceId/commands",
    controlOnly,
    asyncRoute(async (request, response) => {
      const { deviceId } = deviceParamsSchema.parse(request.params);
      if (store.get(deviceId) === undefined) {
        throw new AppError(404, "DEVICE_NOT_FOUND", "Device was not found");
      }
      const command = commandRequestSchema.parse(request.body);
      const timeoutMs = Math.min(
        command.timeoutMs ?? 5000,
        config.commandTimeoutMaxMs,
      );
      const result =
        command.commandType === "account.status.refresh"
          ? await hub.dispatchAccountStatusRefresh(
              deviceId,
              command.idempotencyKey,
              timeoutMs,
              command.accountId,
            )
          : await hub.dispatchStatusRequest(
              deviceId,
              command.idempotencyKey,
              timeoutMs,
            );
      response.json(createRestEnvelope("command.completed", result));
    }),
  );

  app.use((_request, _response, next) => {
    next(new AppError(404, "ROUTE_NOT_FOUND", "Route was not found"));
  });
  app.use(errorHandler(logger));

  return app;
}
