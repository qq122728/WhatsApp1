import "dotenv/config";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { startControlServer } from "./server.js";

const bootstrapLogger = new Logger("info");

try {
  const config = loadConfig();
  const logger = new Logger(config.nodeEnv === "development" ? "debug" : "info");
  const running = await startControlServer(config, logger);
  const shutdown = async (signal: string): Promise<void> => {
    logger.info("server.shutdown_requested", { signal });
    await running.close();
    process.exitCode = 0;
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
} catch (error) {
  bootstrapLogger.error("server.start_failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
}
