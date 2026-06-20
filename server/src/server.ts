import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ServerConfig } from "./config.js";
import { DeviceChannelHub } from "./device-channel.js";
import { createApp } from "./app.js";
import { Logger } from "./logger.js";
import { InMemoryDeviceStore } from "./store/device-store.js";

export interface RunningControlServer {
  httpServer: Server;
  hub: DeviceChannelHub;
  store: InMemoryDeviceStore;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startControlServer(
  config: ServerConfig,
  logger = new Logger(config.nodeEnv === "development" ? "debug" : "info"),
): Promise<RunningControlServer> {
  const store = new InMemoryDeviceStore();
  const hub = new DeviceChannelHub(store, config, logger);
  const app = createApp(config, store, hub, logger);
  const httpServer = createHttpServer(app);
  hub.attach(httpServer);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off("error", onError);
      resolve();
    });
  });

  const address = httpServer.address() as AddressInfo;
  const displayHost = address.address.includes(":")
    ? `[${address.address}]`
    : address.address;
  const baseUrl = `http://${displayHost}:${address.port}`;
  logger.warn("storage.volatile", {
    storageKind: "memory",
    durable: false,
    warning: "Device registrations and command state are lost on restart",
  });
  logger.info("server.started", {
    host: address.address,
    port: address.port,
    requireTls: config.requireTls,
  });

  return {
    httpServer,
    hub,
    store,
    baseUrl,
    close: async () => {
      hub.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error !== undefined) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      logger.info("server.stopped");
    },
  };
}
