import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { correlationId } from "../correlation";

function createApp() {
  const app = new Hono();
  app.use(correlationId);
  app.get("/test", (c) => c.json({ id: c.get("correlationId") }));
  return app;
}

describe("correlationId middleware", () => {
  test("generates a UUID when no header is provided", async () => {
    const app = createApp();
    const res = await app.request("/test");
    const body = await res.json();
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.headers.get("X-Correlation-ID")).toBe(body.id);
  });

  test("uses X-Correlation-ID from request header", async () => {
    const app = createApp();
    const res = await app.request("/test", {
      headers: { "X-Correlation-ID": "ext-abc-123" },
    });
    const body = await res.json();
    expect(body.id).toBe("ext-abc-123");
    expect(res.headers.get("X-Correlation-ID")).toBe("ext-abc-123");
  });

  test("sets response header on every request", async () => {
    const app = createApp();
    const res1 = await app.request("/test");
    const res2 = await app.request("/test");
    const id1 = res1.headers.get("X-Correlation-ID");
    const id2 = res2.headers.get("X-Correlation-ID");
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });
});
