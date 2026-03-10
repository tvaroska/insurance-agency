import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { Hono } from "hono";
import {
  maskSsn,
  maskPhone,
  maskEmail,
  maskDob,
  maskAccountNumber,
  maskDriverLicense,
  maskPii,
  requestLogger,
} from "../logging";
import { correlationId, type CorrelationVariables } from "../correlation";

// ---------------------------------------------------------------------------
// Individual masking functions
// ---------------------------------------------------------------------------

describe("maskSsn", () => {
  test("masks SSN keeping last 4 digits", () => {
    expect(maskSsn("123-45-6789")).toBe("***-**-6789");
  });

  test("handles SSN without dashes", () => {
    expect(maskSsn("123456789")).toBe("***-**-6789");
  });
});

describe("maskPhone", () => {
  test("masks phone with parentheses", () => {
    expect(maskPhone("(555) 123-7890")).toBe("(***) ***-7890");
  });

  test("masks phone with dashes", () => {
    expect(maskPhone("555-123-7890")).toBe("(***) ***-7890");
  });

  test("masks phone digits only", () => {
    expect(maskPhone("5551237890")).toBe("(***) ***-7890");
  });
});

describe("maskEmail", () => {
  test("masks email keeping first char and domain", () => {
    expect(maskEmail("john.doe@example.com")).toBe("j***@example.com");
  });

  test("handles single-char local part", () => {
    expect(maskEmail("a@test.com")).toBe("a***@test.com");
  });
});

describe("maskDob", () => {
  test("always returns [REDACTED]", () => {
    expect(maskDob()).toBe("[REDACTED]");
  });
});

describe("maskAccountNumber", () => {
  test("masks account number keeping last 4", () => {
    expect(maskAccountNumber("123456789")).toBe("****6789");
  });

  test("handles account with dashes", () => {
    expect(maskAccountNumber("1234-5678-90")).toBe("****7890");
  });
});

describe("maskDriverLicense", () => {
  test("masks DL keeping last 4 chars", () => {
    expect(maskDriverLicense("DL12345678")).toBe("****5678");
  });

  test("handles short license", () => {
    expect(maskDriverLicense("A1234")).toBe("****1234");
  });
});

// ---------------------------------------------------------------------------
// Deep object masking (maskPii)
// ---------------------------------------------------------------------------

describe("maskPii", () => {
  test("masks PII fields by key name", () => {
    const input = {
      ssn: "123-45-6789",
      email: "john@example.com",
      phone: "(555) 123-4567",
      dob: "1990-01-15",
      driver_license: "DL98765432",
      bank_account: "9876543210",
    };
    const result = maskPii(input) as Record<string, string>;
    expect(result.ssn).toBe("***-**-6789");
    expect(result.email).toBe("j***@example.com");
    expect(result.phone).toBe("(***) ***-4567");
    expect(result.dob).toBe("[REDACTED]");
    expect(result.driver_license).toBe("****5432");
    expect(result.bank_account).toBe("****3210");
  });

  test("preserves non-PII fields", () => {
    const input = { name: "John", status: "active", count: 42 };
    const result = maskPii(input) as Record<string, unknown>;
    expect(result.name).toBe("John");
    expect(result.status).toBe("active");
    expect(result.count).toBe(42);
  });

  test("masks nested objects", () => {
    const input = {
      client: {
        name: "Jane",
        ssn: "111-22-3333",
        contact: { email: "jane@test.com" },
      },
    };
    const result = maskPii(input) as any;
    expect(result.client.name).toBe("Jane");
    expect(result.client.ssn).toBe("***-**-3333");
    expect(result.client.contact.email).toBe("j***@test.com");
  });

  test("masks arrays of objects", () => {
    const input = [
      { email: "a@b.com" },
      { email: "c@d.com" },
    ];
    const result = maskPii(input) as any[];
    expect(result[0].email).toBe("a***@b.com");
    expect(result[1].email).toBe("c***@d.com");
  });

  test("masks inline SSN patterns in strings", () => {
    const input = "Client SSN is 123-45-6789 on file";
    expect(maskPii(input)).toBe("Client SSN is ***-**-6789 on file");
  });

  test("masks inline email patterns in strings", () => {
    const input = "Contact at john@example.com for details";
    expect(maskPii(input)).toBe("Contact at j***@example.com for details");
  });

  test("returns null/undefined unchanged", () => {
    expect(maskPii(null)).toBeNull();
    expect(maskPii(undefined)).toBeUndefined();
  });

  test("returns numbers unchanged", () => {
    expect(maskPii(42)).toBe(42);
  });

  test("handles alternate key names", () => {
    const input = {
      social_security: "999-88-7777",
      date_of_birth: "1985-05-20",
      dl_number: "X1234567",
      account_number: "00112233",
      mobile: "2125551234",
    };
    const result = maskPii(input) as Record<string, string>;
    expect(result.social_security).toBe("***-**-7777");
    expect(result.date_of_birth).toBe("[REDACTED]");
    expect(result.dl_number).toBe("****4567");
    expect(result.account_number).toBe("****2233");
    expect(result.mobile).toBe("(***) ***-1234");
  });
});

// ---------------------------------------------------------------------------
// Request logger middleware
// ---------------------------------------------------------------------------

describe("requestLogger", () => {
  type AppVars = { Variables: CorrelationVariables };
  let logSpy: ReturnType<typeof spyOn>;

  function createApp() {
    const app = new Hono<AppVars>();
    app.use(correlationId);
    app.use(requestLogger);
    app.get("/health", (c) => c.json({ ok: true }));
    app.get("/clients", (c) => c.json({ data: [] }));
    return app;
  }

  afterEach(() => {
    logSpy?.mockRestore();
  });

  test("logs structured JSON for each request", async () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    await app.request("/health");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/health");
    expect(entry.status).toBe(200);
    expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
    expect(entry.timestamp).toBeTruthy();
    expect(entry.correlation_id).toBeTruthy();
  });

  test("includes correlation ID from context", async () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    await app.request("/health", {
      headers: { "X-Correlation-ID": "test-corr-123" },
    });

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.correlation_id).toBe("test-corr-123");
  });

  test("masks PII in query parameters", async () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    await app.request("/clients?ssn=123-45-6789&status=active");

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.query.ssn).toBe("***-**-6789");
    expect(entry.query.status).toBe("active");
  });

  test("omits query field when no query params", async () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    await app.request("/health");

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.query).toBeUndefined();
  });

  test("includes user-agent when present", async () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    await app.request("/health", {
      headers: { "User-Agent": "TestAgent/1.0" },
    });

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.user_agent).toBe("TestAgent/1.0");
  });
});
