import { describe, expect, test, beforeEach, mock } from "bun:test";
import type { OutputCheck } from "../types";

// ── Helpers ────────────────────────────────────────────────────────

const TOKEN_RESPONSE = {
  access_token: "test-token",
  expires_in: 3600,
};

const BASE_URLS = { ams: "http://localhost:3000", crm: "http://localhost:3002" };

function makeCheck(overrides: Partial<OutputCheck> = {}): OutputCheck {
  return {
    name: "test-check",
    weight: 1,
    service: "ams",
    method: "GET",
    path: "/clients",
    expect: { status: 200 },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(responses: Record<string, { body: unknown; status?: number }>) {
  return mock((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

    if (urlStr.endsWith("/oauth/token")) {
      return Promise.resolve(jsonResponse(TOKEN_RESPONSE));
    }

    for (const [pattern, resp] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve(jsonResponse(resp.body, resp.status ?? 200));
      }
    }

    return Promise.resolve(jsonResponse({ error: "not found" }, 404));
  });
}

// ── Tests ──────────────────────────────────────────────────────────

// Re-import evaluateOutput fresh each test to reset cachedToken
let evaluateOutput: typeof import("../evaluators/output").evaluateOutput;
let defaultBaseUrls: typeof import("../evaluators/output").defaultBaseUrls;

beforeEach(async () => {
  // Clear module cache to reset cachedToken
  const modulePath = require.resolve("../evaluators/output");
  delete require.cache[modulePath];

  const mod = await import("../evaluators/output");
  evaluateOutput = mod.evaluateOutput;
  defaultBaseUrls = mod.defaultBaseUrls;
});

describe("defaultBaseUrls", () => {
  test("returns PORT_SERVICE_MAP as localhost URLs", () => {
    const urls = defaultBaseUrls();
    expect(urls.ams).toBe("http://localhost:3000");
    expect(urls.rater).toBe("http://localhost:3001");
    expect(urls.crm).toBe("http://localhost:3002");
    expect(urls.ecm).toBe("http://localhost:3003");
    expect(urls.comm).toBe("http://localhost:3004");
    expect(urls.claims).toBe("http://localhost:3007");
  });
});

describe("evaluateOutput", () => {
  describe("auth", () => {
    test("acquires OAuth token from first base URL", async () => {
      const fetchMock = mockFetch({
        "/v1/clients": { body: [] },
      });
      globalThis.fetch = fetchMock as typeof fetch;

      await evaluateOutput([makeCheck()], BASE_URLS);

      const tokenCall = fetchMock.mock.calls[0];
      const tokenUrl = typeof tokenCall[0] === "string" ? tokenCall[0] : "";
      expect(tokenUrl).toBe("http://localhost:3000/oauth/token");
    });

    test("reuses cached token across multiple checks", async () => {
      const fetchMock = mockFetch({
        "/v1/clients": { body: [] },
        "/v1/policies": { body: [] },
      });
      globalThis.fetch = fetchMock as typeof fetch;

      await evaluateOutput(
        [makeCheck(), makeCheck({ name: "check-2", path: "/policies" })],
        BASE_URLS,
      );

      // Token endpoint called once, service endpoints called twice
      const tokenCalls = fetchMock.mock.calls.filter((c) => {
        const url = typeof c[0] === "string" ? c[0] : "";
        return url.includes("/oauth/token");
      });
      expect(tokenCalls).toHaveLength(1);
    });

    test("attaches X-Eval-Scorer: true header on token and check requests", async () => {
      const fetchMock = mockFetch({
        "/v1/clients": { body: [] },
      });
      globalThis.fetch = fetchMock as typeof fetch;

      await evaluateOutput([makeCheck()], BASE_URLS);

      for (const call of fetchMock.mock.calls) {
        const init = (call as unknown[])[1] as { headers?: Record<string, string> } | undefined;
        expect(init?.headers?.["X-Eval-Scorer"]).toBe("true");
      }
    });
  });

  describe("status checks", () => {
    test("passes when status matches expected", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { id: "CLI-001" }, status: 200 },
      }) as typeof fetch;

      const [score] = await evaluateOutput([makeCheck()], BASE_URLS);
      expect(score.passed).toBe(true);
    });

    test("fails when status does not match", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: {}, status: 404 },
      }) as typeof fetch;

      const [score] = await evaluateOutput([makeCheck()], BASE_URLS);
      expect(score.passed).toBe(false);
    });

    test("includes status mismatch detail", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: {}, status: 500 },
      }) as typeof fetch;

      const [score] = await evaluateOutput([makeCheck()], BASE_URLS);
      expect(score.detail).toBe("Expected status 200, got 500");
    });
  });

  describe("array length checks", () => {
    test("passes when array length within bounds", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: [1, 2, 3] },
      }) as typeof fetch;

      const check = makeCheck({
        expect: { status: 200, arrayMinLength: 2, arrayMaxLength: 5 },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(true);
    });

    test("passes with { data: [...] } wrapper format", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { data: [1, 2, 3] } },
      }) as typeof fetch;

      const check = makeCheck({
        expect: { status: 200, arrayMinLength: 2 },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(true);
    });

    test("fails when below arrayMinLength", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: [1] },
      }) as typeof fetch;

      const check = makeCheck({
        expect: { status: 200, arrayMinLength: 3 },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(false);
      expect(score.detail).toBe("Array length 1 < min 3");
    });

    test("fails when above arrayMaxLength", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: [1, 2, 3, 4, 5] },
      }) as typeof fetch;

      const check = makeCheck({
        expect: { status: 200, arrayMaxLength: 3 },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(false);
      expect(score.detail).toBe("Array length 5 > max 3");
    });

    test("fails when response is not array or wrapper", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { name: "not an array" } },
      }) as typeof fetch;

      const check = makeCheck({
        expect: { status: 200, arrayMinLength: 1 },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(false);
      expect(score.detail).toBe("Expected array response for length check");
    });
  });

  describe("body match", () => {
    test("passes on exact object match", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { name: "Alice", status: "active" } },
      }) as typeof fetch;

      const check = makeCheck({
        expect: {
          status: 200,
          bodyMatch: { name: "Alice", status: "active" },
        },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(true);
    });

    test("passes on partial object match (extra keys OK)", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { name: "Alice", status: "active", id: "CLI-001" } },
      }) as typeof fetch;

      const check = makeCheck({
        expect: { status: 200, bodyMatch: { name: "Alice" } },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(true);
    });

    test("fails on missing key", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { name: "Alice" } },
      }) as typeof fetch;

      const check = makeCheck({
        expect: { status: 200, bodyMatch: { email: "alice@test.com" } },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(false);
      expect(score.detail).toContain("email");
    });

    test("fails on wrong value", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { status: "inactive" } },
      }) as typeof fetch;

      const check = makeCheck({
        expect: { status: 200, bodyMatch: { status: "active" } },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(false);
      expect(score.detail).toContain("status");
    });

    test("passes on array subset match (contains semantics)", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": {
          body: { tags: ["vip", "commercial", "residential"] },
        },
      }) as typeof fetch;

      const check = makeCheck({
        expect: {
          status: 200,
          bodyMatch: { tags: ["vip", "residential"] },
        },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(true);
    });

    test("fails when expected array element not found", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { tags: ["vip", "commercial"] } },
      }) as typeof fetch;

      const check = makeCheck({
        expect: {
          status: 200,
          bodyMatch: { tags: ["missing-tag"] },
        },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(false);
      expect(score.detail).toContain("not found in array");
    });

    test("handles nested object matching", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": {
          body: {
            address: { city: "Portland", state: "OR", zip: "97201" },
          },
        },
      }) as typeof fetch;

      const check = makeCheck({
        expect: {
          status: 200,
          bodyMatch: { address: { state: "OR" } },
        },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(true);
    });

    test("handles null matching", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { deletedAt: null } },
      }) as typeof fetch;

      const check = makeCheck({
        expect: { status: 200, bodyMatch: { deletedAt: null } },
      });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(true);
    });
  });

  describe("unknown service", () => {
    test("returns passed:false with Unknown service detail", async () => {
      globalThis.fetch = mockFetch({}) as typeof fetch;

      const check = makeCheck({ service: "nonexistent" });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.passed).toBe(false);
      expect(score.detail).toBe("Unknown service: nonexistent");
    });
  });

  describe("network errors", () => {
    test("returns passed:false with Request failed detail", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock((url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("/oauth/token")) {
          return Promise.resolve(jsonResponse(TOKEN_RESPONSE));
        }
        return Promise.reject(new Error("Connection refused"));
      }) as typeof fetch;

      const [score] = await evaluateOutput([makeCheck()], BASE_URLS);
      expect(score.passed).toBe(false);
      expect(score.detail).toBe("Request failed: Connection refused");
    });
  });

  describe("scoring", () => {
    test("returns correct weights on each score", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: {} },
      }) as typeof fetch;

      const check = makeCheck({ weight: 0.3 });
      const [score] = await evaluateOutput([check], BASE_URLS);
      expect(score.weight).toBe(0.3);
    });

    test("handles multiple checks with mixed pass/fail", async () => {
      globalThis.fetch = mockFetch({
        "/v1/clients": { body: { id: "CLI-001" }, status: 200 },
        "/v1/policies": { body: {}, status: 404 },
      }) as typeof fetch;

      const checks = [
        makeCheck({ name: "client-exists", weight: 0.4 }),
        makeCheck({ name: "policy-exists", path: "/policies", weight: 0.6 }),
      ];
      const scores = await evaluateOutput(checks, BASE_URLS);

      expect(scores).toHaveLength(2);
      expect(scores[0].passed).toBe(true);
      expect(scores[0].name).toBe("client-exists");
      expect(scores[1].passed).toBe(false);
      expect(scores[1].name).toBe("policy-exists");
    });
  });
});
