import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { start, type Ctx } from "./support";

const REPO_ROOT = join(import.meta.dir, "../../..");

interface SmokeStep {
  name: string;
  rule: string;
  request: {
    method: string;
    path: string;
    auth?: string;
    body?: unknown;
  };
  expect: {
    status: number;
    headers_present?: string[];
    json_match?: Record<string, unknown>;
    array_length?: Record<string, number>;
  };
  capture?: Record<string, string>;
}

interface SmokeSpec {
  service: string;
  version: string;
  steps: SmokeStep[];
}

function interpolate(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      if (!(k in vars)) throw new Error(`Unknown smoke template variable: ${k}`);
      return vars[k];
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, vars)]));
  }
  return value;
}

describe("public smoke contract (specs/smoke/claims.smoke.yaml)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("replays every declarative step in specs/smoke/claims.smoke.yaml", async () => {
    const raw = readFileSync(join(REPO_ROOT, "specs/smoke/claims.smoke.yaml"), "utf8");
    const spec = Bun.YAML.parse(raw) as SmokeSpec;
    expect(spec.service).toBe("claims");
    expect(spec.steps.length).toBeGreaterThanOrEqual(10);

    const vars: Record<string, string> = {};
    for (const step of spec.steps) {
      const path = interpolate(step.request.path, vars) as string;
      const body = step.request.body !== undefined ? interpolate(step.request.body, vars) : undefined;
      const client = step.request.auth
        ? ctx.svc.withToken(interpolate(step.request.auth, vars) as string)
        : ctx.svc.http;

      const res = await client.request(step.request.method, path, { body });
      expect(res.status, `step ${step.name} (${step.rule})`).toBe(step.expect.status);

      for (const h of step.expect.headers_present ?? []) {
        expect(res.headers.get(h), `step ${step.name} header ${h}`).toBeTruthy();
      }
      if (step.expect.json_match) {
        const expected = interpolate(step.expect.json_match, vars) as Record<string, unknown>;
        expect(res.body, `step ${step.name} (${step.rule})`).toMatchObject(expected);
      }
      for (const [key, len] of Object.entries(step.expect.array_length ?? {})) {
        expect(Array.isArray(res.body?.[key]), `step ${step.name} array ${key}`).toBe(true);
        expect(res.body[key].length, `step ${step.name} array ${key} length`).toBe(len);
      }
      for (const [varName, field] of Object.entries(step.capture ?? {})) {
        const val = res.body?.[field];
        expect(typeof val, `step ${step.name} capture ${field}`).toBe("string");
        vars[varName] = val as string;
      }
    }
  });
});
