import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  conflictError,
  createErrorResponse,
  errorHandler,
  internalError,
  notFoundError,
  validationError,
} from "../errors";
import { correlationId } from "../correlation";
import type { FieldError } from "../types";

describe("createErrorResponse", () => {
  test("creates minimal error response", () => {
    const res = createErrorResponse("NOT_FOUND", "Client not found.");
    expect(res).toEqual({
      error_code: "NOT_FOUND",
      message: "Client not found.",
    });
  });

  test("includes correlation_id when provided", () => {
    const res = createErrorResponse("INTERNAL_ERROR", "Oops", {
      correlationId: "abc-123",
    });
    expect(res.correlation_id).toBe("abc-123");
  });

  test("includes field details when provided", () => {
    const details: FieldError[] = [
      { field: "email", message: "Invalid format", code: "invalid_format" },
    ];
    const res = createErrorResponse("VALIDATION_ERROR", "Validation failed", { details });
    expect(res.details).toHaveLength(1);
    expect(res.details![0].field).toBe("email");
  });
});

describe("error factory functions", () => {
  test("validationError creates 400 HTTPException", () => {
    const err = validationError([
      { field: "effective_date", message: "Must be in the future.", code: "out_of_range" },
    ]);
    expect(err.status).toBe(400);
    const res = err.getResponse();
    expect(res.status).toBe(400);
  });

  test("notFoundError creates 404 HTTPException", () => {
    const err = notFoundError("Client");
    expect(err.status).toBe(404);
  });

  test("conflictError creates 409 HTTPException", () => {
    const err = conflictError("Quote already bound.");
    expect(err.status).toBe(409);
  });

  test("internalError creates 500 HTTPException", () => {
    const err = internalError("corr-id-123");
    expect(err.status).toBe(500);
  });

  test("error response body is valid JSON", async () => {
    const err = notFoundError("Policy");
    const res = err.getResponse();
    const body = await res.json();
    expect(body.error_code).toBe("NOT_FOUND");
    expect(body.message).toBe("Policy not found.");
  });
});

describe("errorHandler with correlation middleware", () => {
  function createApp() {
    const app = new Hono();
    app.use(correlationId);
    app.onError(errorHandler);
    return app;
  }

  test("includes correlation_id from context in thrown HTTPException", async () => {
    const app = createApp();
    app.get("/fail", () => {
      throw notFoundError("Client");
    });
    const res = await app.request("/fail");
    const body = await res.json();
    expect(body.error_code).toBe("NOT_FOUND");
    expect(body.correlation_id).toBeTruthy();
  });

  test("uses externally provided correlation ID", async () => {
    const app = createApp();
    app.get("/fail", () => {
      throw conflictError("Already bound.");
    });
    const res = await app.request("/fail", {
      headers: { "X-Correlation-ID": "ext-999" },
    });
    const body = await res.json();
    expect(body.correlation_id).toBe("ext-999");
  });

  test("includes correlation_id on unhandled errors", async () => {
    const app = createApp();
    app.get("/crash", () => {
      throw new Error("boom");
    });
    const res = await app.request("/crash");
    const body = await res.json();
    expect(body.error_code).toBe("INTERNAL_ERROR");
    expect(body.correlation_id).toBeTruthy();
  });

  test("includes correlation_id on validation errors", async () => {
    const app = createApp();
    app.get("/validate", () => {
      throw validationError([
        { field: "email", message: "Invalid", code: "invalid_format" },
      ]);
    });
    const res = await app.request("/validate");
    const body = await res.json();
    expect(body.error_code).toBe("VALIDATION_ERROR");
    expect(body.correlation_id).toBeTruthy();
    expect(body.details).toHaveLength(1);
  });
});
