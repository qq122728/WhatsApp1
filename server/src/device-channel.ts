import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import type { ServerConfig } from "./config.js";
import { isAllowedOrigin } from "./config.js";
import { AppError } from "./errors.js";
import type { Logger } from "./logger.js";
import {
  readBearerToken,
  rejectPlatformSessionData,
  secretMatchesHash,
} from "./security.js";
import type { InMemoryDeviceStore } from "./store/device-store.js";
import {
  createProtocolError,
  createWssEnvelope,
  deviceStatusPayloadSchema,
  parseWssMessage,
  WSS_SUBPROTOCOL,
  WssContractValidationError,
  type CommandAckPayload,
  type CommandAckStatus,
  type CommandResultPayload,
  type CommandResultStatus,
  type DeviceHelloPayload,
  type DeviceStatusPayload,
  type ErrorPayload,
  type HeartbeatPayload,
  type ProtocolErrorDetail,
  type WssErrorCode,
  type WssMessage,
  type WssMessageType,
  type WssPayloadByType,
} from "./wss-contract.js";

type ConnectionPhase = "awaiting_hello" | "awaiting_status" | "ready";

interface PendingHeartbeat {
  nonce: string;
  messageId: string;
  sentAt: number;
}

interface ActiveConnection {
  deviceId: string;
  transportConnectionId: string;
  clientConnectionId?: string;
  socket: WebSocket;
  phase: ConnectionPhase;
  expectedClientSequence: number;
  nextServerSequence: number;
  lastFrameAt: number;
  commandNames: Set<string>;
  pendingHeartbeat?: PendingHeartbeat;
  handshakeTimer?: NodeJS.Timeout;
}

interface CommandOutcome {
  commandId: string;
  idempotencyKey: string;
  expiresAt: string;
  ackStatus: CommandAckStatus;
  status: CommandResultStatus | "rejected";
  result?: DeviceStatusPayload;
  error?: ProtocolErrorDetail;
}

interface PendingCommand {
  deviceId: string;
  commandId: string;
  idempotencyKey: string;
  commandName: "device.status.request" | "account.status.refresh";
  expiresAt: string;
  executionTimeoutMs: number;
  requestFingerprint: string;
  ackStatus?: CommandAckStatus;
  acknowledgedAt?: string;
  promise: Promise<CommandOutcome>;
  resolve: (result: CommandOutcome) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface CompletedCommand {
  result: CommandOutcome;
  requestFingerprint: string;
  retainUntil: number;
}

const WS_PATH = /^\/api\/v1\/devices\/([^/]+)\/channel$/;
const HELLO_TIMEOUT_MS = 5_000;
const INITIAL_STATUS_TIMEOUT_MS = 5_000;
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

function sendUpgradeError(
  socket: Duplex,
  status: number,
  statusText: string,
): void {
  socket.write(
    `HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function asDeviceStatusPayload(value: unknown): DeviceStatusPayload {
  return deviceStatusPayloadSchema.parse(value) as DeviceStatusPayload;
}

export class DeviceChannelHub {
  private readonly websocketServer: WebSocketServer;
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly pendingByCommandId = new Map<string, PendingCommand>();
  private readonly pendingByIdempotency = new Map<string, PendingCommand>();
  private readonly completedCommands = new Map<string, CompletedCommand>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    private readonly store: InMemoryDeviceStore,
    private readonly config: ServerConfig,
    private readonly logger: Logger,
  ) {
    this.websocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: config.wsMaxPayloadBytes,
      handleProtocols(protocols) {
        return protocols.has(WSS_SUBPROTOCOL) ? WSS_SUBPROTOCOL : false;
      },
    });
  }

  attach(server: HttpServer): void {
    server.on("upgrade", (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });
    this.heartbeatTimer = setInterval(
      () => this.runHeartbeatSweep(),
      this.config.wsHeartbeatIntervalMs,
    );
    this.heartbeatTimer.unref();
  }

  close(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
    }
    for (const connection of this.connections.values()) {
      this.clearHandshakeTimer(connection);
      connection.socket.close(1001, "Server shutting down");
    }
    for (const pending of this.pendingByCommandId.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new AppError(503, "SERVER_SHUTTING_DOWN", "Server is shutting down", true),
      );
    }
    this.pendingByCommandId.clear();
    this.pendingByIdempotency.clear();
    this.websocketServer.close();
  }

  disconnectDevice(deviceId: string): void {
    this.connections
      .get(deviceId)
      ?.socket.close(4401, "Device credentials rotated");
  }

  isConnected(deviceId: string): boolean {
    const connection = this.connections.get(deviceId);
    return (
      connection?.socket.readyState === WebSocket.OPEN &&
      connection.phase === "ready"
    );
  }

  async dispatchStatusRequest(
    deviceId: string,
    idempotencyKey: string,
    executionTimeoutMs: number,
  ): Promise<CommandOutcome> {
    return this.dispatchSafeCommand(
      deviceId,
      idempotencyKey,
      executionTimeoutMs,
      "device.status.request",
      {},
    );
  }

  async dispatchAccountStatusRefresh(
    deviceId: string,
    idempotencyKey: string,
    executionTimeoutMs: number,
    accountId: string,
  ): Promise<CommandOutcome> {
    return this.dispatchSafeCommand(
      deviceId,
      idempotencyKey,
      executionTimeoutMs,
      "account.status.refresh",
      { accountId },
    );
  }

  private async dispatchSafeCommand(
    deviceId: string,
    idempotencyKey: string,
    executionTimeoutMs: number,
    commandName: PendingCommand["commandName"],
    parameters: Record<string, unknown>,
  ): Promise<CommandOutcome> {
    this.removeExpiredCommandResults();
    const cacheKey = this.commandCacheKey(
      deviceId,
      commandName,
      idempotencyKey,
    );
    const requestFingerprint = JSON.stringify({
      commandName,
      parameters,
      executionTimeoutMs,
    });
    const completed = this.completedCommands.get(cacheKey);
    if (completed !== undefined) {
      if (completed.requestFingerprint !== requestFingerprint) {
        throw this.idempotencyConflict();
      }
      return completed.result;
    }

    const existing = this.pendingByIdempotency.get(cacheKey);
    if (existing !== undefined) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw this.idempotencyConflict();
      }
      return existing.promise;
    }

    const connection = this.connections.get(deviceId);
    if (
      connection === undefined ||
      connection.socket.readyState !== WebSocket.OPEN ||
      connection.phase !== "ready"
    ) {
      throw new AppError(
        409,
        "DEVICE_OFFLINE",
        "The device channel has not completed its v1 handshake",
        true,
      );
    }
    if (!connection.commandNames.has(commandName)) {
      throw new AppError(
        409,
        "COMMAND_UNSUPPORTED",
        "The device did not advertise support for this command",
      );
    }

    const commandId = randomUUID();
    const expiresAt = new Date(Date.now() + executionTimeoutMs).toISOString();
    let resolvePromise: (result: CommandOutcome) => void = () => undefined;
    let rejectPromise: (error: Error) => void = () => undefined;
    const promise = new Promise<CommandOutcome>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const timeout = setTimeout(() => {
      const pending = this.pendingByCommandId.get(commandId);
      if (pending === undefined) {
        return;
      }
      this.removePending(pending);
      pending.reject(
        new AppError(
          504,
          "COMMAND_TIMEOUT",
          "The device did not acknowledge the command before expiresAt",
          true,
          { acknowledged: false },
        ),
      );
    }, executionTimeoutMs);

    const pending: PendingCommand = {
      deviceId,
      commandId,
      idempotencyKey,
      commandName,
      expiresAt,
      executionTimeoutMs,
      requestFingerprint,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timeout,
    };
    this.pendingByCommandId.set(commandId, pending);
    this.pendingByIdempotency.set(cacheKey, pending);

    const message = this.sendMessage(connection, "command.request", {
      commandId,
      idempotencyKey,
      expiresAt,
      commandName,
      executionTimeoutMs,
      parameters,
    });
    if (message === undefined) {
      this.removePending(pending);
      throw new AppError(
        409,
        "DEVICE_DISCONNECTED",
        "The command could not be delivered to the device",
        true,
      );
    }

    this.logger.info("command.dispatched", {
      deviceId,
      commandId,
      commandName,
      executionTimeoutMs,
      expiresAt,
      sequence: message.sequence,
    });
    return promise;
  }

  private handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const match = WS_PATH.exec(url.pathname);
      if (match?.[1] === undefined) {
        sendUpgradeError(socket, 404, "Not Found");
        return;
      }
      const deviceId = decodeURIComponent(match[1]);

      if (this.config.requireTls) {
        const forwardedProto = request.headers["x-forwarded-proto"];
        const proto = Array.isArray(forwardedProto)
          ? forwardedProto[0]
          : forwardedProto;
        if (proto !== "https" && proto !== "wss") {
          sendUpgradeError(socket, 426, "Upgrade Required");
          return;
        }
      }

      const origin = request.headers.origin;
      if (origin !== undefined && !isAllowedOrigin(origin, this.config)) {
        sendUpgradeError(socket, 403, "Forbidden");
        return;
      }

      const offeredProtocols = request.headers["sec-websocket-protocol"]
        ?.split(",")
        .map((value) => value.trim());
      if (
        offeredProtocols !== undefined &&
        !offeredProtocols.includes(WSS_SUBPROTOCOL)
      ) {
        sendUpgradeError(socket, 400, "Unsupported WebSocket Protocol");
        return;
      }

      const record = this.store.get(deviceId);
      const token = readBearerToken(request.headers.authorization);
      if (
        record === undefined ||
        token === undefined ||
        new Date(record.credentialExpiresAt).getTime() <= Date.now() ||
        !secretMatchesHash(token, record.credentialHash)
      ) {
        sendUpgradeError(socket, 401, "Unauthorized");
        return;
      }

      this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        this.onConnection(deviceId, websocket);
      });
    } catch {
      sendUpgradeError(socket, 400, "Bad Request");
    }
  }

  private onConnection(deviceId: string, socket: WebSocket): void {
    const previous = this.connections.get(deviceId);
    previous?.socket.close(4409, "Replaced by a newer connection");

    const now = new Date().toISOString();
    const connection: ActiveConnection = {
      deviceId,
      transportConnectionId: randomUUID(),
      socket,
      phase: "awaiting_hello",
      expectedClientSequence: 1,
      nextServerSequence: 1,
      lastFrameAt: Date.now(),
      commandNames: new Set(),
    };
    this.connections.set(deviceId, connection);
    this.store.updateConnection(deviceId, {
      status: "starting",
      statusReason: "AWAITING_DEVICE_HELLO",
      connectedAt: now,
      lastSeenAt: now,
    });
    connection.handshakeTimer = setTimeout(() => {
      this.failProtocol(
        connection,
        "PROTOCOL_INVALID_MESSAGE",
        "DeviceHello was not received within 5 seconds",
        4408,
      );
    }, HELLO_TIMEOUT_MS);

    this.logger.info("device.channel_connected", {
      deviceId,
      transportConnectionId: connection.transportConnectionId,
      subprotocol: socket.protocol || undefined,
    });

    socket.on("message", (data, isBinary) => {
      this.handleMessage(connection, data, isBinary);
    });
    socket.on("close", (code) => {
      this.onClose(connection, code);
    });
    socket.on("error", () => {
      this.logger.warn("device.channel_error", {
        deviceId,
        transportConnectionId: connection.transportConnectionId,
      });
    });
  }

  private handleMessage(
    connection: ActiveConnection,
    raw: WebSocket.RawData,
    isBinary: boolean,
  ): void {
    if (isBinary) {
      this.failProtocol(
        connection,
        "PROTOCOL_INVALID_MESSAGE",
        "Binary WebSocket messages are not supported by contracts v1",
        4400,
      );
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw.toString());
    } catch {
      this.failProtocol(
        connection,
        "PROTOCOL_INVALID_MESSAGE",
        "WebSocket frame must be valid JSON",
        4400,
      );
      return;
    }

    let message: WssMessage;
    try {
      message = parseWssMessage(parsedJson);
      // The shared schema rejects sensitive names inside generic command data.
      // This broader recursive check remains as defense in depth for all frames.
      rejectPlatformSessionData(message);
    } catch (error) {
      const issues =
        error instanceof WssContractValidationError ? error.issues : undefined;
      this.logger.warn("device.contract_validation_failed", {
        deviceId: connection.deviceId,
        issues,
      });
      this.failProtocol(
        connection,
        "PROTOCOL_INVALID_MESSAGE",
        "WebSocket frame does not match contracts v1",
        4400,
      );
      return;
    }

    if (message.sequence !== connection.expectedClientSequence) {
      this.failProtocol(
        connection,
        "PROTOCOL_INVALID_SEQUENCE",
        `Expected client sequence ${connection.expectedClientSequence}`,
        4409,
        message.messageId,
      );
      return;
    }
    connection.expectedClientSequence += 1;
    connection.lastFrameAt = Date.now();
    this.store.touch(connection.deviceId);

    try {
      this.routeMessage(connection, message);
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError(
              400,
              "PROTOCOL_INVALID_MESSAGE",
              "WebSocket message failed semantic validation",
            );
      const code = this.asWssErrorCode(appError.code);
      this.failProtocol(
        connection,
        code,
        appError.message,
        this.closeCodeForError(code),
        message.messageId,
      );
    }
  }

  private routeMessage(
    connection: ActiveConnection,
    message: WssMessage,
  ): void {
    if (connection.phase === "awaiting_hello") {
      if (message.type !== "device.hello") {
        throw new AppError(
          400,
          "PROTOCOL_INVALID_MESSAGE",
          "The first client frame must be DeviceHello",
        );
      }
      this.handleDeviceHello(connection, message.payload);
      return;
    }

    if (connection.phase === "awaiting_status") {
      if (message.type !== "device.status") {
        throw new AppError(
          400,
          "PROTOCOL_INVALID_MESSAGE",
          "The second client frame must be the initial DeviceStatus",
        );
      }
      this.handleDeviceStatus(connection, message.payload, true);
      return;
    }

    switch (message.type) {
      case "device.status":
        this.handleDeviceStatus(connection, message.payload, false);
        break;
      case "command.ack":
        this.handleCommandAck(connection, message.payload);
        break;
      case "command.result":
        this.handleCommandResult(connection, message.payload);
        break;
      case "heartbeat":
        this.handleHeartbeat(connection, message.messageId, message.payload);
        break;
      case "error":
        this.handlePeerError(connection, message.payload);
        break;
      case "device.hello":
      case "command.request":
        throw new AppError(
          400,
          "PROTOCOL_INVALID_MESSAGE",
          `Client message type ${message.type} is not valid in the ready phase`,
        );
    }
  }

  private handleDeviceHello(
    connection: ActiveConnection,
    payload: DeviceHelloPayload,
  ): void {
    if (payload.deviceId !== connection.deviceId) {
      throw new AppError(
        403,
        "DEVICE_AUTH_INVALID",
        "DeviceHello deviceId does not match the authenticated path identity",
      );
    }
    connection.clientConnectionId = payload.connectionId;
    connection.commandNames = new Set(payload.capabilities.commandNames);
    connection.phase = "awaiting_status";
    this.clearHandshakeTimer(connection);
    this.store.updateConnection(connection.deviceId, {
      status: "starting",
      statusReason: "AWAITING_INITIAL_STATUS",
      connectionId: payload.connectionId,
      lastSeenAt: new Date().toISOString(),
    });
    connection.handshakeTimer = setTimeout(() => {
      this.failProtocol(
        connection,
        "PROTOCOL_INVALID_MESSAGE",
        "Initial DeviceStatus was not received within 5 seconds",
        4408,
      );
    }, INITIAL_STATUS_TIMEOUT_MS);
    this.logger.info("device.hello_accepted", {
      deviceId: connection.deviceId,
      connectionId: payload.connectionId,
      clientVersion: payload.clientVersion,
      commandCount: payload.capabilities.commandNames.length,
    });
  }

  private handleDeviceStatus(
    connection: ActiveConnection,
    payload: DeviceStatusPayload,
    initial: boolean,
  ): void {
    if (connection.clientConnectionId === undefined) {
      throw new AppError(
        400,
        "PROTOCOL_INVALID_MESSAGE",
        "DeviceStatus requires an accepted DeviceHello",
      );
    }
    const update = this.store.updateReportedStatus(connection.deviceId, {
      connectionId: connection.clientConnectionId,
      statusRevision: payload.statusRevision,
      status: payload.status,
      activeCommandCount: payload.activeCommandCount,
      queuedCommandCount: payload.queuedCommandCount,
      accounts: payload.accounts,
      ...(payload.lastSuccessfulSyncAt !== undefined
        ? { lastSuccessfulSyncAt: payload.lastSuccessfulSyncAt }
        : {}),
    });
    if (update === undefined) {
      throw new AppError(404, "DEVICE_AUTH_INVALID", "Device is not registered");
    }
    if (initial) {
      connection.phase = "ready";
      this.clearHandshakeTimer(connection);
    }
    this.logger.info("device.status_received", {
      deviceId: connection.deviceId,
      status: payload.status,
      statusRevision: payload.statusRevision,
      accountCount: payload.accounts.length,
      stale: !update.applied,
      initial,
    });
  }

  private handleCommandAck(
    connection: ActiveConnection,
    payload: CommandAckPayload,
  ): void {
    const pending = this.matchPendingCommand(connection, payload);
    if (pending.ackStatus !== undefined) {
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "The command already has an acknowledgement",
      );
    }

    const acknowledgedAt = Date.parse(payload.acknowledgedAt);
    const expiresAt = Date.parse(pending.expiresAt);
    if (
      acknowledgedAt > expiresAt &&
      payload.status !== "expired"
    ) {
      throw new AppError(
        400,
        "COMMAND_EXPIRED",
        "A command acknowledged after expiresAt must use status expired",
      );
    }
    if (
      payload.status === "expired" &&
      payload.error?.code !== "COMMAND_EXPIRED"
    ) {
      throw new AppError(
        400,
        "PROTOCOL_INVALID_MESSAGE",
        "An expired acknowledgement must use COMMAND_EXPIRED",
      );
    }

    pending.ackStatus = payload.status;
    pending.acknowledgedAt = payload.acknowledgedAt;
    clearTimeout(pending.timeout);

    if (payload.status === "rejected" || payload.status === "expired") {
      const outcome: CommandOutcome = {
        commandId: pending.commandId,
        idempotencyKey: pending.idempotencyKey,
        expiresAt: pending.expiresAt,
        ackStatus: payload.status,
        status: payload.status === "expired" ? "expired" : "rejected",
        ...(payload.error !== undefined ? { error: payload.error } : {}),
      };
      this.completePending(pending, outcome);
      return;
    }

    pending.timeout = setTimeout(() => {
      const active = this.pendingByCommandId.get(pending.commandId);
      if (active === undefined) {
        return;
      }
      this.removePending(active);
      active.reject(
        new AppError(
          504,
          "COMMAND_TIMEOUT",
          "The accepted command exceeded executionTimeoutMs",
          true,
          { acknowledged: true },
        ),
      );
    }, pending.executionTimeoutMs);

    this.logger.info("command.acknowledged", {
      deviceId: connection.deviceId,
      commandId: payload.commandId,
      status: payload.status,
    });
  }

  private handleCommandResult(
    connection: ActiveConnection,
    payload: CommandResultPayload,
  ): void {
    const pending = this.matchPendingCommand(connection, payload);
    if (
      pending.ackStatus !== "accepted" &&
      pending.ackStatus !== "duplicate"
    ) {
      throw new AppError(
        400,
        "PROTOCOL_INVALID_MESSAGE",
        "CommandResult requires an accepted or duplicate CommandAck first",
      );
    }
    if (
      pending.acknowledgedAt !== undefined &&
      Date.parse(payload.completedAt) < Date.parse(pending.acknowledgedAt)
    ) {
      throw new AppError(
        400,
        "PROTOCOL_INVALID_MESSAGE",
        "completedAt cannot precede acknowledgedAt",
      );
    }

    let result: DeviceStatusPayload | undefined;
    if (payload.status === "succeeded") {
      if (payload.result === undefined) {
        throw new AppError(
          400,
          "PROTOCOL_INVALID_MESSAGE",
          "Successful device.status.request results require a status result",
        );
      }
      result = asDeviceStatusPayload(payload.result);
      if (connection.clientConnectionId !== undefined) {
        this.store.updateReportedStatus(connection.deviceId, {
          connectionId: connection.clientConnectionId,
          statusRevision: result.statusRevision,
          status: result.status,
          activeCommandCount: result.activeCommandCount,
          queuedCommandCount: result.queuedCommandCount,
          accounts: result.accounts,
          ...(result.lastSuccessfulSyncAt !== undefined
            ? { lastSuccessfulSyncAt: result.lastSuccessfulSyncAt }
            : {}),
        });
      }
    } else if (payload.result !== undefined) {
      throw new AppError(
        400,
        "PROTOCOL_INVALID_MESSAGE",
        "Non-success device.status.request results must omit result",
      );
    }

    const outcome: CommandOutcome = {
      commandId: pending.commandId,
      idempotencyKey: pending.idempotencyKey,
      expiresAt: pending.expiresAt,
      ackStatus: pending.ackStatus,
      status: payload.status,
      ...(result !== undefined ? { result } : {}),
      ...(payload.error !== undefined ? { error: payload.error } : {}),
    };
    this.completePending(pending, outcome);
    this.logger.info("command.completed", {
      deviceId: connection.deviceId,
      commandId: payload.commandId,
      ackStatus: pending.ackStatus,
      status: payload.status,
      errorCode: payload.error?.code,
    });
  }

  private handleHeartbeat(
    connection: ActiveConnection,
    messageId: string,
    payload: HeartbeatPayload,
  ): void {
    if (payload.kind === "ping") {
      this.sendMessage(connection, "heartbeat", {
        kind: "pong",
        nonce: payload.nonce,
        replyToMessageId: messageId,
        lastReceivedSequence: connection.expectedClientSequence - 1,
      });
      return;
    }

    const pending = connection.pendingHeartbeat;
    if (
      pending === undefined ||
      pending.nonce !== payload.nonce ||
      pending.messageId !== payload.replyToMessageId
    ) {
      throw new AppError(
        400,
        "PROTOCOL_INVALID_MESSAGE",
        "Heartbeat pong does not match the outstanding ping",
      );
    }
    delete connection.pendingHeartbeat;
  }

  private handlePeerError(
    connection: ActiveConnection,
    payload: ErrorPayload,
  ): void {
    this.logger.warn("device.protocol_error_received", {
      deviceId: connection.deviceId,
      errorCode: payload.error.code,
      category: payload.error.category,
      fatal: payload.fatal,
      commandId: payload.commandId,
    });
    if (payload.commandId !== undefined) {
      const pending = this.pendingByCommandId.get(payload.commandId);
      if (pending !== undefined && pending.deviceId === connection.deviceId) {
        this.removePending(pending);
        pending.reject(
          new AppError(
            409,
            payload.error.code,
            "The device reported a command protocol error",
            payload.error.retryable,
          ),
        );
      }
    }
    if (payload.fatal) {
      connection.socket.close(4400, "Peer reported a fatal protocol error");
    }
  }

  private matchPendingCommand(
    connection: ActiveConnection,
    payload: {
      commandId: string;
      idempotencyKey: string;
      expiresAt: string;
    },
  ): PendingCommand {
    const pending = this.pendingByCommandId.get(payload.commandId);
    if (
      pending === undefined ||
      pending.deviceId !== connection.deviceId ||
      pending.idempotencyKey !== payload.idempotencyKey ||
      pending.expiresAt !== payload.expiresAt
    ) {
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Command correlation fields do not match a pending command",
      );
    }
    return pending;
  }

  private completePending(
    pending: PendingCommand,
    outcome: CommandOutcome,
  ): void {
    this.removePending(pending);
    const commandExpiry = Date.parse(pending.expiresAt);
    this.completedCommands.set(
      this.commandCacheKey(
        pending.deviceId,
        pending.commandName,
        pending.idempotencyKey,
      ),
      {
        result: outcome,
        requestFingerprint: pending.requestFingerprint,
        retainUntil: Math.max(
          commandExpiry + IDEMPOTENCY_RETENTION_MS,
          Date.now() + IDEMPOTENCY_RETENTION_MS,
        ),
      },
    );
    pending.resolve(outcome);
  }

  private sendMessage<TType extends WssMessageType>(
    connection: ActiveConnection,
    type: TType,
    payload: WssPayloadByType[TType],
  ) {
    if (connection.socket.readyState !== WebSocket.OPEN) {
      return undefined;
    }
    const message = createWssEnvelope(
      type,
      payload,
      connection.nextServerSequence,
      randomUUID(),
    );
    connection.nextServerSequence += 1;
    connection.socket.send(JSON.stringify(message), (error) => {
      if (error === undefined || error === null) {
        return;
      }
      this.logger.warn("device.message_delivery_failed", {
        deviceId: connection.deviceId,
        messageId: message.messageId,
        type,
        errorName: error.name,
      });
    });
    return message;
  }

  private failProtocol(
    connection: ActiveConnection,
    code: WssErrorCode,
    message: string,
    closeCode: 4400 | 4401 | 4403 | 4408 | 4409,
    relatedMessageId?: string,
  ): void {
    if (connection.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const payload: ErrorPayload = {
      error: createProtocolError(code, message),
      fatal: true,
      ...(relatedMessageId !== undefined ? { relatedMessageId } : {}),
    };
    this.sendMessage(connection, "error", payload);
    connection.socket.close(closeCode, code);
  }

  private onClose(connection: ActiveConnection, code: number): void {
    this.clearHandshakeTimer(connection);
    const current = this.connections.get(connection.deviceId);
    if (
      current?.transportConnectionId !== connection.transportConnectionId
    ) {
      return;
    }

    this.connections.delete(connection.deviceId);
    this.store.updateConnection(connection.deviceId, {
      status: "offline",
      statusReason: code === 1000 ? "CHANNEL_CLOSED" : "CHANNEL_DISCONNECTED",
      disconnectedAt: new Date().toISOString(),
    });
    for (const pending of this.pendingByCommandId.values()) {
      if (pending.deviceId === connection.deviceId) {
        this.removePending(pending);
        pending.reject(
          new AppError(
            409,
            "DEVICE_DISCONNECTED",
            "The device disconnected before returning a command result",
            true,
            { acknowledged: pending.ackStatus !== undefined },
          ),
        );
      }
    }
    this.logger.info("device.channel_disconnected", {
      deviceId: connection.deviceId,
      transportConnectionId: connection.transportConnectionId,
      closeCode: code,
    });
  }

  private runHeartbeatSweep(): void {
    const now = Date.now();
    for (const connection of this.connections.values()) {
      const record = this.store.get(connection.deviceId);
      if (
        record === undefined ||
        new Date(record.credentialExpiresAt).getTime() <= now
      ) {
        if (connection.socket.readyState === WebSocket.OPEN) {
          this.sendMessage(connection, "error", {
            error: createProtocolError(
              "DEVICE_AUTH_INVALID",
              "Device credential expired",
            ),
            fatal: true,
          });
          connection.socket.close(4401, "Device credential expired");
        }
        continue;
      }
      if (connection.phase !== "ready") {
        continue;
      }
      if (
        connection.pendingHeartbeat !== undefined &&
        now - connection.pendingHeartbeat.sentAt >
          this.config.wsHeartbeatIntervalMs
      ) {
        connection.socket.close(4408, "Heartbeat timeout");
        continue;
      }
      if (
        now - connection.lastFrameAt >
        this.config.wsHeartbeatIntervalMs * 3
      ) {
        connection.socket.close(4408, "Connection idle timeout");
        continue;
      }
      if (
        connection.pendingHeartbeat === undefined &&
        connection.socket.readyState === WebSocket.OPEN
      ) {
        const nonce = randomUUID();
        const ping = this.sendMessage(connection, "heartbeat", {
          kind: "ping",
          nonce,
          lastReceivedSequence: connection.expectedClientSequence - 1,
        });
        if (ping !== undefined) {
          connection.pendingHeartbeat = {
            nonce,
            messageId: ping.messageId,
            sentAt: now,
          };
        }
      }
    }
  }

  private removePending(pending: PendingCommand): void {
    clearTimeout(pending.timeout);
    this.pendingByCommandId.delete(pending.commandId);
    this.pendingByIdempotency.delete(
      this.commandCacheKey(
        pending.deviceId,
        pending.commandName,
        pending.idempotencyKey,
      ),
    );
  }

  private removeExpiredCommandResults(): void {
    const now = Date.now();
    for (const [key, value] of this.completedCommands.entries()) {
      if (value.retainUntil <= now) {
        this.completedCommands.delete(key);
      }
    }
  }

  private commandCacheKey(
    deviceId: string,
    commandName: string,
    idempotencyKey: string,
  ): string {
    return `${deviceId}:${commandName}:${idempotencyKey}`;
  }

  private clearHandshakeTimer(connection: ActiveConnection): void {
    if (connection.handshakeTimer !== undefined) {
      clearTimeout(connection.handshakeTimer);
      delete connection.handshakeTimer;
    }
  }

  private idempotencyConflict(): AppError {
    return new AppError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was reused with different command content",
    );
  }

  private asWssErrorCode(code: string): WssErrorCode {
    const knownCodes = new Set<WssErrorCode>([
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
    ]);
    return knownCodes.has(code as WssErrorCode)
      ? (code as WssErrorCode)
      : "PROTOCOL_INVALID_MESSAGE";
  }

  private closeCodeForError(
    code: WssErrorCode,
  ): 4400 | 4401 | 4403 | 4409 {
    if (
      code === "DEVICE_AUTH_REQUIRED" ||
      code === "DEVICE_AUTH_INVALID"
    ) {
      return 4401;
    }
    if (
      code === "PAIRING_REQUIRED" ||
      code === "PAIRING_REVOKED" ||
      code === "PERMISSION_DENIED"
    ) {
      return 4403;
    }
    if (
      code === "PROTOCOL_INVALID_SEQUENCE" ||
      code === "IDEMPOTENCY_CONFLICT"
    ) {
      return 4409;
    }
    return 4400;
  }
}
