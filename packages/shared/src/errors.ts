import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Context, ErrorHandler } from "hono";
import type { ErrorCode, ErrorResponse, FieldError } from "./types";

export function createErrorResponse(
  errorCode: ErrorCode,
  message: string,
  opts?: { correlationId?: string; details?: FieldError[] },
): ErrorResponse {
  const response: ErrorResponse = { error_code: errorCode, message };
  if (opts?.correlationId) response.correlation_id = opts.correlationId;
  if (opts?.details) response.details = opts.details;
  return response;
}

function httpError(status: ContentfulStatusCode, body: ErrorResponse): HTTPException {
  return new HTTPException(status, {
    message: body.message,
    res: new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  });
}

export function validationError(details: FieldError[]): HTTPException {
  return httpError(
    400,
    createErrorResponse("VALIDATION_ERROR", "One or more fields failed validation.", { details }),
  );
}

export function notFoundError(resource: string): HTTPException {
  return httpError(404, createErrorResponse("NOT_FOUND", `${resource} not found.`));
}

export function conflictError(message: string): HTTPException {
  return httpError(409, createErrorResponse("CONFLICT", message));
}

export function internalError(correlationId: string): HTTPException {
  return httpError(
    500,
    createErrorResponse("INTERNAL_ERROR", "An unexpected error occurred.", { correlationId }),
  );
}

export const errorHandler: ErrorHandler = (err: Error, c: Context) => {
  const correlationId: string = c.get?.("correlationId") ?? crypto.randomUUID();

  if (err instanceof HTTPException) {
    const res = err.getResponse();
    if (res.headers.get("Content-Type")?.includes("application/json")) {
      // Inject correlation ID into pre-built JSON responses
      return res.json().then((body: ErrorResponse) => {
        body.correlation_id = correlationId;
        return c.json(body, res.status as ContentfulStatusCode);
      });
    }
    const code = statusToErrorCode(err.status);
    return c.json(
      createErrorResponse(code, err.message, { correlationId }),
      err.status as ContentfulStatusCode,
    );
  }

  console.error(`[${correlationId}] Unhandled error:`, err);
  return c.json(
    createErrorResponse("INTERNAL_ERROR", "An unexpected error occurred.", { correlationId }),
    500,
  );
};

function statusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400: return "VALIDATION_ERROR";
    case 401: return "AUTH_ERROR";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 429: return "RATE_LIMIT_EXCEEDED";
    default: return "INTERNAL_ERROR";
  }
}
