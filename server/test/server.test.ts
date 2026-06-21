import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import type { ServerConfig } from "../src/config.js";
import { PROTOCOL_VERSION } from "../src/protocol.js";
import type { RunningControlServer } from "../src/server.js";
import { startControlServer } from "../src/server.js";
import {
  createWssEnvelope,
  parseWssMessage,
  WSS_SUBPROTOCOL,
  type DeviceStatusPayload,
  type WssMessageType,
  type WssPayloadByType,
} from "../src/wss-contract.js";

const config: ServerConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  corsOrigins: new Set(),
  deviceTokenTtlSeconds: 3600,
  wsHeartbeatIntervalMs: 60_000,
  wsMaxPayloadBytes: 65_536,
  commandTimeoutMaxMs: 10_000,
  requireTls: false,
  trustProxy: false,
};

let running: RunningControlServer;

before(async () => {
  running = await startControlServer(config);
});

after(async () => {
  await running.close();
});

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${running.baseUrl}${path}`, init);
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

function waitForMessage(
  socket: WebSocket,
  type: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      3000,
    );
    const onMessage = (raw: WebSocket.RawData) => {
      const message = parseWssMessage(JSON.parse(raw.toString()));
      if (message.type === type) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(message as unknown as Record<string, unknown>);
      }
    };
    socket.on("message", onMessage);
  });
}

function clientMessage<TType extends WssMessageType>(
  type: TType,
  payload: WssPayloadByType[TType],
  sequence: number,
) {
  return createWssEnvelope(
    type,
    payload,
    sequence,
    randomUUID(),
  );
}

async function registerDevice(
  deviceId: string,
  capabilities = ["device.status.request"],
) {
  const result = await jsonRequest("/api/v1/devices/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      deviceId,
      name: "CI test device",
      clientVersion: "0.1.0-test",
      capabilities,
    }),
  });
  assert.equal(result.response.status, 201);
  const data = result.body.data as {
    credentials: { deviceToken: string };
    websocketPath: string;
  };
  return data;
}

async function connectDevice(
  deviceId: string,
  capabilities = ["device.status.request"],
) {
  const registration = await registerDevice(deviceId, capabilities);
  const wsUrl = running.baseUrl
    .replace(/^http:/, "ws:")
    .concat(registration.websocketPath);
  const socket = new WebSocket(wsUrl, WSS_SUBPROTOCOL, {
    headers: {
      authorization: `Bearer ${registration.credentials.deviceToken}`,
    },
  });
  await once(socket, "open");
  assert.equal(socket.protocol, WSS_SUBPROTOCOL);
  return socket;
}

async function completeHandshake(
  socket: WebSocket,
  deviceId: string,
  statusRevision = 1,
  commandNames = ["device.status.request"],
): Promise<DeviceStatusPayload> {
  socket.send(
    JSON.stringify(
      clientMessage(
        "device.hello",
        {
          deviceId,
          connectionId: randomUUID(),
          clientVersion: "0.1.0-test",
          supportedProtocolVersions: [1],
          runtime: {
            os: "windows",
            architecture: "x86_64",
          },
          capabilities: {
            commandNames,
            maxConcurrentCommands: 1,
            supportsCommandCancellation: false,
          },
        },
        1,
      ),
    ),
  );

  const status: DeviceStatusPayload = {
    statusRevision,
    status: "degraded",
    activeCommandCount: 0,
    queuedCommandCount: 0,
    accounts: [],
    lastSuccessfulSyncAt: new Date().toISOString(),
  };
  socket.send(
    JSON.stringify(clientMessage("device.status", status, 2)),
  );

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await jsonRequest(
      `/api/v1/devices/${encodeURIComponent(deviceId)}/status`,
    );
    const data = response.body.data as {
      channelConnected: boolean;
      device: { status: string; statusRevision?: number };
    };
    if (
      data.channelConnected &&
      data.device.statusRevision === statusRevision
    ) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Device v1 handshake did not become ready");
}

test("health reports volatile memory storage", async () => {
  const { response, body } = await jsonRequest("/health");
  assert.equal(response.status, 200);
  assert.equal(body.protocolVersion, 1);
  assert.equal(body.type, "health.status");
  const data = body.data as { storage: { kind: string; durable: boolean } };
  assert.deepEqual(data.storage, { kind: "memory", durable: false });
});

test("web console page is served without exposing platform session data", async () => {
  const response = await fetch(`${running.baseUrl}/console`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(body, /MultiConnect Web Console/);
  assert.doesNotMatch(body, /document\.cookie/i);
  assert.doesNotMatch(body, /localStorage/i);
  assert.doesNotMatch(body, /indexedDB/i);
});

test("registration rejects platform Session-shaped input", async () => {
  const { response, body } = await jsonRequest("/api/v1/devices/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: 1,
      deviceId: "device-sensitive",
      name: "unsafe",
      platformSession: { cookie: "must-not-arrive" },
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(body.type, "error");
  const error = body.error as { code: string };
  assert.equal(error.code, "PLATFORM_SESSION_FORBIDDEN");
});

test("contracts v1 WSS handshake, status, command and heartbeat round-trip", async () => {
  const deviceId = randomUUID();
  const socket = await connectDevice(deviceId);
  const initialStatus = await completeHandshake(socket, deviceId);

  const idempotencyKey = randomUUID();
  const commandBody = JSON.stringify({
    protocolVersion: 1,
    idempotencyKey,
    commandType: "device.status.request",
    timeoutMs: 3000,
  });
  const commandMessagePromise = waitForMessage(socket, "command.request");
  const commandResponsePromise = jsonRequest(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/commands`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: commandBody,
    },
  );

  const commandMessage = await commandMessagePromise;
  assert.equal(commandMessage.sequence, 1);
  assert.equal(commandMessage.type, "command.request");
  assert.equal("data" in commandMessage, false);
  const command = commandMessage.payload as {
    commandId: string;
    idempotencyKey: string;
    expiresAt: string;
    commandName: string;
    executionTimeoutMs: number;
    parameters: Record<string, unknown>;
  };
  assert.equal(command.idempotencyKey, idempotencyKey);
  assert.equal(command.commandName, "device.status.request");
  assert.equal(command.executionTimeoutMs, 3000);
  assert.deepEqual(command.parameters, {});
  assert.ok(Date.parse(command.expiresAt) > Date.now());

  socket.send(
    JSON.stringify(
      clientMessage(
        "command.ack",
        {
          commandId: command.commandId,
          idempotencyKey,
          expiresAt: command.expiresAt,
          status: "accepted",
          acknowledgedAt: new Date().toISOString(),
        },
        3,
      ),
    ),
  );

  const finalStatus: DeviceStatusPayload = {
    ...initialStatus,
    statusRevision: 2,
    status: "ready",
  };
  socket.send(
    JSON.stringify(
      clientMessage(
        "command.result",
        {
          commandId: command.commandId,
          idempotencyKey,
          expiresAt: command.expiresAt,
          status: "succeeded",
          completedAt: new Date().toISOString(),
          result: finalStatus,
        },
        4,
      ),
    ),
  );

  const commandResponse = await commandResponsePromise;
  assert.equal(commandResponse.response.status, 200);
  assert.equal(commandResponse.body.type, "command.completed");
  const commandResult = commandResponse.body.data as {
    ackStatus: string;
    status: string;
    result: DeviceStatusPayload;
  };
  assert.equal(commandResult.ackStatus, "accepted");
  assert.equal(commandResult.status, "succeeded");
  assert.equal(commandResult.result.statusRevision, 2);

  const duplicateCommandResponse = await jsonRequest(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/commands`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: commandBody,
    },
  );
  assert.equal(duplicateCommandResponse.response.status, 200);
  const duplicateResult = duplicateCommandResponse.body.data as {
    commandId: string;
  };
  assert.equal(duplicateResult.commandId, command.commandId);

  const pongPromise = waitForMessage(socket, "heartbeat");
  const ping = clientMessage(
    "heartbeat",
    {
      kind: "ping",
      nonce: randomUUID(),
      lastReceivedSequence: 1,
    },
    5,
  );
  socket.send(JSON.stringify(ping));
  const pong = await pongPromise;
  assert.equal(pong.sequence, 2);
  assert.deepEqual(pong.payload, {
    kind: "pong",
    nonce: ping.payload.nonce,
    replyToMessageId: ping.messageId,
    lastReceivedSequence: 5,
  });

  socket.close(1000);
  await once(socket, "close");
});

test("account status refresh command carries the requested account id", async () => {
  const deviceId = randomUUID();
  const accountId = `wa_${randomUUID().replace(/-/g, "")}`;
  const capabilities = ["device.status.request", "account.status.refresh"];
  const socket = await connectDevice(deviceId, capabilities);
  const initialStatus = await completeHandshake(socket, deviceId, 1, capabilities);

  const idempotencyKey = randomUUID();
  const commandMessagePromise = waitForMessage(socket, "command.request");
  const commandResponsePromise = jsonRequest(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/commands`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 1,
        idempotencyKey,
        commandType: "account.status.refresh",
        accountId,
        timeoutMs: 5000,
      }),
    },
  );

  const commandMessage = await commandMessagePromise;
  const command = commandMessage.payload as {
    commandId: string;
    idempotencyKey: string;
    expiresAt: string;
    commandName: string;
    executionTimeoutMs: number;
    parameters: { accountId?: string };
  };
  assert.equal(command.commandName, "account.status.refresh");
  assert.equal(command.parameters.accountId, accountId);

  socket.send(
    JSON.stringify(
      clientMessage(
        "command.ack",
        {
          commandId: command.commandId,
          idempotencyKey,
          expiresAt: command.expiresAt,
          status: "accepted",
          acknowledgedAt: new Date().toISOString(),
        },
        3,
      ),
    ),
  );

  const finalStatus: DeviceStatusPayload = {
    ...initialStatus,
    statusRevision: 2,
    status: "ready",
    accounts: [
      {
        accountId,
        platform: "whatsapp",
        status: "online",
        occurredAt: new Date().toISOString(),
        summary: "Checked from console",
      },
    ],
  };
  socket.send(
    JSON.stringify(
      clientMessage(
        "command.result",
        {
          commandId: command.commandId,
          idempotencyKey,
          expiresAt: command.expiresAt,
          status: "succeeded",
          completedAt: new Date().toISOString(),
          result: finalStatus,
        },
        4,
      ),
    ),
  );

  const commandResponse = await commandResponsePromise;
  assert.equal(commandResponse.response.status, 200);
  const commandData = commandResponse.body.data as { result: DeviceStatusPayload };
  assert.equal(commandData.result.accounts[0]?.accountId, accountId);

  socket.close(1000);
  await once(socket, "close");
});

test("invalid client sequence returns contracts v1 Error and closes 4409", async () => {
  const deviceId = randomUUID();
  const socket = await connectDevice(deviceId);
  socket.send(
    JSON.stringify(
      clientMessage(
        "device.hello",
        {
          deviceId,
          connectionId: randomUUID(),
          clientVersion: "0.1.0-test",
          supportedProtocolVersions: [1],
          runtime: { os: "windows", architecture: "x86_64" },
          capabilities: {
            commandNames: ["device.status.request"],
            maxConcurrentCommands: 1,
            supportsCommandCancellation: false,
          },
        },
        1,
      ),
    ),
  );

  const errorPromise = waitForMessage(socket, "error");
  socket.send(
    JSON.stringify(
      clientMessage(
        "device.status",
        {
          statusRevision: 1,
          status: "ready",
          activeCommandCount: 0,
          queuedCommandCount: 0,
          accounts: [],
        },
        3,
      ),
    ),
  );
  const errorMessage = await errorPromise;
  assert.equal(errorMessage.sequence, 1);
  const payload = errorMessage.payload as {
    fatal: boolean;
    error: { code: string; category: string };
  };
  assert.equal(payload.fatal, true);
  assert.equal(payload.error.code, "PROTOCOL_INVALID_SEQUENCE");
  assert.equal(payload.error.category, "protocol");

  const [closeCode] = (await once(socket, "close")) as [number, Buffer];
  assert.equal(closeCode, 4409);
});

test("sensitive command result is rejected by the shared contract", async () => {
  const deviceId = randomUUID();
  const socket = await connectDevice(deviceId);
  await completeHandshake(socket, deviceId);

  const idempotencyKey = randomUUID();
  const commandMessagePromise = waitForMessage(socket, "command.request");
  const commandResponsePromise = jsonRequest(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/commands`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 1,
        idempotencyKey,
        commandType: "device.status.request",
        timeoutMs: 3000,
      }),
    },
  );
  const commandMessage = await commandMessagePromise;
  const command = commandMessage.payload as {
    commandId: string;
    expiresAt: string;
  };

  socket.send(
    JSON.stringify(
      clientMessage(
        "command.ack",
        {
          commandId: command.commandId,
          idempotencyKey,
          expiresAt: command.expiresAt,
          status: "accepted",
          acknowledgedAt: new Date().toISOString(),
        },
        3,
      ),
    ),
  );

  const errorPromise = waitForMessage(socket, "error");
  const closePromise = once(socket, "close");
  socket.send(
    JSON.stringify({
      protocolVersion: 1,
      messageId: randomUUID(),
      type: "command.result",
      timestamp: new Date().toISOString(),
      sequence: 4,
      payload: {
        commandId: command.commandId,
        idempotencyKey,
        expiresAt: command.expiresAt,
        status: "succeeded",
        completedAt: new Date().toISOString(),
        result: {
          token: "must-not-cross-the-control-plane",
        },
      },
    }),
  );

  const errorMessage = await errorPromise;
  const payload = errorMessage.payload as {
    fatal: boolean;
    error: { code: string };
  };
  assert.equal(payload.fatal, true);
  assert.equal(payload.error.code, "PROTOCOL_INVALID_MESSAGE");
  const [closeCode] = (await closePromise) as [number, Buffer];
  assert.equal(closeCode, 4400);

  const commandResponse = await commandResponsePromise;
  assert.equal(commandResponse.response.status, 409);
});

test("invalid CORS origin receives a stable error", async () => {
  const { response, body } = await jsonRequest("/health", {
    headers: { origin: "https://not-allowed.example" },
  });
  assert.equal(response.status, 403);
  const error = body.error as { code: string };
  assert.equal(error.code, "CORS_ORIGIN_DENIED");
});
