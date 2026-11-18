import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./paths";
import type { Service } from "./service";

interface SmokeStep {
  name: string;
  rule: string;
  request: {
    method: string;
    path: string;
    auth?: string;
    headers?: Record<string, string>;
    query?: Record<string, string | number | boolean>;
    body?: unknown;
  };
  expect: {
    status: number;
    headers_present?: string[];
    json_match?: Record<string, unknown>;
    array_length?: Record<string, number>;
    text_contains?: string[];
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

function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export async function runSmokeContract(svc: Service, serviceName: string): Promise<void> {
  const raw = readFileSync(join(REPO_ROOT, "specs/smoke", `${serviceName}.smoke.yaml`), "utf8");
  const spec = Bun.YAML.parse(raw) as SmokeSpec;
  expect(spec.service).toBe(serviceName);
  expect(spec.steps.length).toBeGreaterThanOrEqual(8);

  const vars: Record<string, string> = {};
  for (const step of spec.steps) {
    const path = interpolate(step.request.path, vars) as string;
    const body = step.request.body !== undefined ? interpolate(step.request.body, vars) : undefined;
    const headers = step.request.headers
      ? (interpolate(step.request.headers, vars) as Record<string, string>)
      : undefined;
    const query = step.request.query
      ? (interpolate(step.request.query, vars) as Record<string, string | number | boolean>)
      : undefined;
    const client = step.request.auth
      ? svc.withToken(interpolate(step.request.auth, vars) as string)
      : svc.http;

    const res = await client.request(step.request.method, path, { body, headers, query });
    expect(res.status, `step ${step.name} (${step.rule}): ${res.text.slice(0, 300)}`).toBe(step.expect.status);

    for (const h of step.expect.headers_present ?? []) {
      expect(res.headers.get(h), `step ${step.name} header ${h}`).toBeTruthy();
    }
    if (step.expect.json_match) {
      const expected = interpolate(step.expect.json_match, vars) as Record<string, unknown>;
      expect(res.body, `step ${step.name} (${step.rule})`).toMatchObject(expected);
    }
    for (const [key, len] of Object.entries(step.expect.array_length ?? {})) {
      const arr = getByPath(res.body, key);
      expect(Array.isArray(arr), `step ${step.name} array ${key}`).toBe(true);
      expect((arr as unknown[]).length, `step ${step.name} array ${key} length`).toBe(len);
    }
    for (const needle of step.expect.text_contains ?? []) {
      expect(res.text, `step ${step.name} text_contains`).toContain(interpolate(needle, vars) as string);
    }
    for (const [varName, fieldPath] of Object.entries(step.capture ?? {})) {
      const val = getByPath(res.body, fieldPath);
      expect(typeof val, `step ${step.name} capture ${fieldPath} from ${res.text.slice(0, 200)}`).toBe("string");
      vars[varName] = val as string;
    }
  }
}
