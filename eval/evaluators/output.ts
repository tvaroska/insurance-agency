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
    headers: {
      "Content-Type": "application/json",
      "X-Eval-Scorer": "true",
    },
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

function extractCandidateRecords(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
  }
  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return obj.data.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      );
    }
    return [obj];
  }
  return [];
}

function getFieldByPath(record: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cur: unknown = record;
  for (const part of parts) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function evaluateBodyRegex(
  body: unknown,
  bodyRegex: Record<string, string | string[]>,
): { matched: boolean; detail?: string } {
  const candidates = extractCandidateRecords(body);
  if (candidates.length === 0) {
    return { matched: false, detail: "No candidate records found for bodyRegex check" };
  }

  const recordMatchesAll = (record: Record<string, unknown>): { ok: boolean; reason?: string } => {
    for (const [fieldPath, rawPatterns] of Object.entries(bodyRegex)) {
      const val = getFieldByPath(record, fieldPath);
      const text = typeof val === "string" ? val : val !== undefined && val !== null ? JSON.stringify(val) : "";
      const patterns = Array.isArray(rawPatterns) ? rawPatterns : [rawPatterns];
      for (const pat of patterns) {
        const re = new RegExp(pat, "i");
        if (!re.test(text)) {
          return {
            ok: false,
            reason: `Field '${fieldPath}' did not match regex /${pat}/i`,
          };
        }
      }
    }
    return { ok: true };
  };

  let lastReason: string | undefined;
  for (const candidate of candidates) {
    const res = recordMatchesAll(candidate);
    if (res.ok) {
      return { matched: true };
    }
    lastReason = res.reason;
  }

  return {
    matched: false,
    detail: lastReason ?? "No record matched bodyRegex patterns",
  };
}

export function evaluateBodyForbiddenRegex(
  body: unknown,
  bodyForbiddenRegex: Record<string, string | string[]>,
): { matched: boolean; detail?: string } {
  const candidates = extractCandidateRecords(body);
  for (const candidate of candidates) {
    for (const [fieldPath, rawPatterns] of Object.entries(bodyForbiddenRegex)) {
      const val = getFieldByPath(candidate, fieldPath);
      if (val === undefined || val === null) continue;
      const text = typeof val === "string" ? val : JSON.stringify(val);
      const patterns = Array.isArray(rawPatterns) ? rawPatterns : [rawPatterns];
      for (const pat of patterns) {
        const re = new RegExp(pat, "i");
        if (re.test(text)) {
          return {
            matched: false,
            detail: `Field '${fieldPath}' matched forbidden regex /${pat}/i`,
          };
        }
      }
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
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Eval-Scorer": "true",
        },
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

      // Rule 0 regex content match check
      if (check.expect.bodyRegex) {
        const result = evaluateBodyRegex(body, check.expect.bodyRegex);
        if (!result.matched) {
          scores.push({
            name: check.name,
            passed: false,
            weight: check.weight,
            detail: result.detail ?? "bodyRegex check failed",
          });
          continue;
        }
      }

      // Rule 0 forbidden regex content check
      if (check.expect.bodyForbiddenRegex) {
        const result = evaluateBodyForbiddenRegex(body, check.expect.bodyForbiddenRegex);
        if (!result.matched) {
          scores.push({
            name: check.name,
            passed: false,
            weight: check.weight,
            detail: result.detail ?? "bodyForbiddenRegex check failed",
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
