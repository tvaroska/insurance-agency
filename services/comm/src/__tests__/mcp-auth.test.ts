import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { Hono } from "hono";
import { jwtAuth, generateDevToken } from "@evergreen/shared";

describe("comm /mcp requires a Bearer token", () => {
  test("src/index.ts mounts jwtAuth on /mcp before the MCP transport handler", () => {
    const src = readFileSync(join(import.meta.dir, "..", "index.ts"), "utf-8");
    const authIdx = src.indexOf('app.use("/mcp", jwtAuth)');
    const handlerIdx = src.indexOf('app.all("/mcp"');
    expect(authIdx).toBeGreaterThan(-1);
    expect(handlerIdx).toBeGreaterThan(authIdx);
  });

  test("unauthenticated /mcp is rejected with 401; a valid token passes", async () => {
    const app = new Hono();
    app.use("/mcp", jwtAuth);
    app.all("/mcp", (c) => c.json({ ok: true }));

    const anon = await app.request("/mcp", { method: "POST", body: "{}" });
    expect(anon.status).toBe(401);

    const token = await generateDevToken({ scopes: ["comm:messages:send"] });
    const authed = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "{}",
    });
    expect(authed.status).toBe(200);
  });
});
