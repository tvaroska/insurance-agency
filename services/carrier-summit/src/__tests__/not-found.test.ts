import { describe, it, expect } from "bun:test";
import { app } from "../index";
import { authHeader } from "./setup";

describe("Carrier Summit unknown /v1/* routes return JSON 404", () => {
  it("returns JSON 404 for unknown authenticated /v1/summit/* GET route", async () => {
    const headers = await authHeader(["carrier:quotes:read"]);
    const res = await app.request("/v1/summit/does-not-exist", { headers });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error_code).toBe("NOT_FOUND");
    expect(body.message).toContain("/v1/summit/does-not-exist");
  });

  it("returns JSON 404 for unknown authenticated /v1/summit/* POST route", async () => {
    const headers = await authHeader(["carrier:quotes:write"]);
    const res = await app.request("/v1/summit/does-not-exist", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error_code).toBe("NOT_FOUND");
  });

  it("returns JSON 404 for unknown /v1/* route outside /v1/summit", async () => {
    const res = await app.request("/v1/unknown-endpoint");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error_code).toBe("NOT_FOUND");
  });
});
