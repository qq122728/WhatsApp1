import { createInterface } from "node:readline";
import {
  failure,
  SidecarError,
  success,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "./protocol.js";
import {
  closeAllWhatsApp,
  closeWhatsApp,
  getWhatsAppStatus,
  startWhatsAppLogin,
} from "./whatsapp.js";

async function dispatch(request: RequestEnvelope): Promise<unknown> {
  switch (request.method) {
    case "health":
      return {
        status: "ok",
        version: "0.1.0",
        pid: process.pid,
      };
    case "whatsapp.startLogin":
      return startWhatsAppLogin(request.params);
    case "whatsapp.getStatus":
      return getWhatsAppStatus(request.params);
    case "whatsapp.close":
      return closeWhatsApp(request.params);
    default:
      throw new SidecarError(
        "METHOD_NOT_FOUND",
        "The requested sidecar method is not supported.",
      );
  }
}

function writeResponse(response: ResponseEnvelope): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on("line", (line) => {
  void (async () => {
    let id = "unknown";
    try {
      const parsed = JSON.parse(line) as Partial<RequestEnvelope>;
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.method !== "string"
      ) {
        throw new SidecarError(
          "INVALID_REQUEST",
          "Sidecar requests require string id and method fields.",
        );
      }
      id = parsed.id;
      writeResponse(success(id, await dispatch(parsed as RequestEnvelope)));
    } catch (error) {
      writeResponse(failure(id, error));
    }
  })();
});

async function shutdown(): Promise<void> {
  input.close();
  await closeAllWhatsApp();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
