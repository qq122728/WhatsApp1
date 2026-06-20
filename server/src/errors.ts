import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { createRestErrorEnvelope } from "./protocol.js";
import type { Logger } from "./logger.js";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function zodDetails(error: ZodError): unknown {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

export function errorHandler(logger: Logger) {
  return (
    error: unknown,
    request: Request,
    response: Response,
    _next: NextFunction,
  ): void => {
    if (error instanceof ZodError) {
      response.status(400).json(
        createRestErrorEnvelope(
          "INVALID_ARGUMENT",
          "Request validation failed",
          false,
          {
            requestId: request.requestId,
            details: zodDetails(error),
          },
        ),
      );
      return;
    }

    if (error instanceof AppError) {
      response.status(error.status).json(
        createRestErrorEnvelope(error.code, error.message, error.retryable, {
          requestId: request.requestId,
          details: error.details,
        }),
      );
      return;
    }

    const isMalformedJson =
      error instanceof SyntaxError &&
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 400;

    if (isMalformedJson) {
      response.status(400).json(
        createRestErrorEnvelope(
          "INVALID_JSON",
          "Request body must be valid JSON",
          false,
          { requestId: request.requestId },
        ),
      );
      return;
    }

    const isPayloadTooLarge =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 413;

    if (isPayloadTooLarge) {
      response.status(413).json(
        createRestErrorEnvelope(
          "PAYLOAD_TOO_LARGE",
          "Request payload exceeds the configured size limit",
          false,
          { requestId: request.requestId },
        ),
      );
      return;
    }

    logger.error("request.failed", {
      requestId: request.requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    response.status(500).json(
      createRestErrorEnvelope(
        "INTERNAL_ERROR",
        "An unexpected server error occurred",
        false,
        { requestId: request.requestId },
      ),
    );
  };
}
