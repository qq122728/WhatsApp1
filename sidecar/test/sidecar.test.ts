import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  closeWhatsApp,
  getWhatsAppStatus,
  startWhatsAppLogin,
} from "../src/whatsapp.js";

test("persistent login fixture reaches authenticated state", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`
      <!doctype html>
      <html>
        <head>
          <title>WhatsApp Login Fixture</title>
          <meta name="multiconnect-auth-state" content="authenticated">
        </head>
        <body><div id="pane-side">Authenticated</div></body>
      </html>
    `);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  const profile = await mkdtemp(path.join(tmpdir(), "multiconnect-wa-"));
  const accountId = "wa_test_account_01";
  process.env.MULTICONNECT_ALLOW_TEST_URLS = "1";

  try {
    const started = await startWhatsAppLogin({
      accountId,
      userDataDir: profile,
      targetUrl: `http://127.0.0.1:${address.port}/`,
    });
    assert.equal(started.state, "authenticated");

    const status = await getWhatsAppStatus({ accountId });
    assert.equal(status.state, "authenticated");

    const closed = await closeWhatsApp({ accountId });
    assert.equal(closed.state, "closed");
  } finally {
    delete process.env.MULTICONNECT_ALLOW_TEST_URLS;
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
