import assert from "node:assert/strict";
import type { ServerConfig } from "../src/config.js";
import { startControlServer } from "../src/server.js";

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

const running = await startControlServer(config);

try {
  const response = await fetch(`${running.baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    protocolVersion: number;
    type: string;
    data: { status: string; storage: { kind: string; durable: boolean } };
  };
  assert.equal(body.protocolVersion, 1);
  assert.equal(body.type, "health.status");
  assert.equal(body.data.status, "ok");
  assert.deepEqual(body.data.storage, { kind: "memory", durable: false });
  console.log("self-check passed");
} finally {
  await running.close();
}
