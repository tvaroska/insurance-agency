import type { OutputCheck, OutputScore } from "../types";
import { PORT_SERVICE_MAP } from "../types";

// ── Auth ────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;

async function acquireToken(baseUrl: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: "agent-readonly",
      client_secret: "dev-secret",
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to acquire token: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };
  return cachedToken.token;
}

// ── Base URL resolution ─────────────────────────────────────────────

export function defaultBaseUrls(): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [port, service] of Object.entries(PORT_SERVICE_MAP)) {
    urls[service] = `http://localhost:${port}`;
  }
  return urls;
}

// ── Body matching ───────────────────────────────────────────────────

function deepPartialMatch(
  actual: unknown,
  expected: unknown,
  path = "",
): { matched: boolean; detail?: string } {
  if (expected === null || expected === undefined) {
    return { matched: actual === expected };
  }

  if (typeof expected !== "object") {
    const matched = actual === expected;
    return matched
      ? { matched: true }
      : { matched: false, detail: `${path || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return { matched: false, detail: `${path || "value"}: expected array, got ${typeof actual}` };
    }
    // Each expected element must exist somewhere in actual
    for (let i = 0; i < expected.length; i++) {
      const found = actual.some(
        (item) => deepPartialMatch(item, expected[i]).matched,
      );
      if (!found) {
        return {
          matched: false,
          detail: `${path}[${i}]: expected element ${JSON.stringify(expected[i])} not found in array`,
        };
      }
    }
    return { matched: true };
  }

  // Object partial match
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    return { matched: false, detail: `${path || "value"}: expected object, got ${typeof actual}` };
  }

  for (const [key, val] of Object.entries(expected as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    const result = deepPartialMatch(
      (actual as Record<string, unknown>)[key],
      val,
      childPath,
    );
    if (!result.matched) {
      return result;
    }
  }
  return { matched: true };
}

// ── Output evaluator ────────────────────────────────────────────────

export async function evaluateOutput(
  checks: OutputCheck[],
  baseUrls?: Record<string, string>,
): Promise<OutputScore[]> {
  const urls = baseUrls ?? defaultBaseUrls();
  const scores: OutputScore[] = [];

  // Acquire token from the first available service
  const firstUrl = Object.values(urls)[0];
  if (!firstUrl) throw new Error("No base URLs configured");
  const token = await acquireToken(firstUrl);

  for (const check of checks) {
    const serviceUrl = urls[check.service];
    if (!serviceUrl) {
      scores.push({
        name: check.name,
        passed: false,
        weight: check.weight,
        detail: `Unknown service: ${check.service}`,
      });
      continue;
    }

    try {
      const res = await fetch(`${serviceUrl}/v1${check.path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Status check
      if (res.status !== check.expect.status) {
        scores.push({
          name: check.name,
          passed: false,
          weight: check.weight,
          detail: `Expected status ${check.expect.status}, got ${res.status}`,
        });
        continue;
      }

      const body = await res.json();

      // Array length checks
      if (check.expect.arrayMinLength !== undefined || check.expect.arrayMaxLength !== undefined) {
        // Support both raw arrays and { data: [...] } wrappers
        const arr = Array.isArray(body)
          ? body
          : (typeof body === "object" && body !== null && Array.isArray((body as Record<string, unknown>).data))
            ? (body as Record<string, unknown>).data as unknown[]
            : null;

        if (!arr) {
          scores.push({
            name: check.name,
            passed: false,
            weight: check.weight,
            detail: "Expected array response for length check",
          });
          continue;
        }

        const len = arr.length;
        if (check.expect.arrayMinLength !== undefined && len < check.expect.arrayMinLength) {
          scores.push({
            name: check.name,
            passed: false,
            weight: check.weight,
            detail: `Array length ${len} < min ${check.expect.arrayMinLength}`,
          });
          continue;
        }
        if (check.expect.arrayMaxLength !== undefined && len > check.expect.arrayMaxLength) {
          scores.push({
            name: check.name,
            passed: false,
            weight: check.weight,
            detail: `Array length ${len} > max ${check.expect.arrayMaxLength}`,
          });
          continue;
        }
      }

      // Body match check
      if (check.expect.bodyMatch) {
        const result = deepPartialMatch(body, check.expect.bodyMatch);
        if (!result.matched) {
          scores.push({
            name: check.name,
            passed: false,
            weight: check.weight,
            detail: result.detail ?? "Body match failed",
          });
          continue;
        }
      }

      scores.push({ name: check.name, passed: true, weight: check.weight });
    } catch (err) {
      scores.push({
        name: check.name,
        passed: false,
        weight: check.weight,
        detail: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return scores;
}
