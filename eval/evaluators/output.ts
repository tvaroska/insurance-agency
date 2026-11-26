import type { GymSnapshot, OutputCheck, OutputScore, StateDiffResult } from "../types";
import { PORT_SERVICE_MAP } from "../types";
import { diffSnapshots, PRIMARY_KEY_CANDIDATES } from "./state-diff";

// ── Auth & Scorer Headers ───────────────────────────────────────────

export function scorerHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const secret = process.env.EVERGREEN_SCORER_SECRET;
  return {
    "X-Eval-Scorer": "true",
    ...(secret ? { "X-Evergreen-Scorer-Secret": secret } : {}),
    ...extra,
  };
}

interface TokenCache {
  baseUrl: string;
  fetchRef: typeof fetch;
  token: string;
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;

async function acquireToken(baseUrl: string): Promise<string> {
  if (
    cachedToken &&
    cachedToken.baseUrl === baseUrl &&
    cachedToken.fetchRef === globalThis.fetch &&
    cachedToken.expiresAt > Date.now()
  ) {
    return cachedToken.token;
  }

  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: scorerHeaders({
      "Content-Type": "application/json",
    }),
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
    baseUrl,
    fetchRef: globalThis.fetch,
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };
  return cachedToken.token;
}

// ── Base URL resolution ─────────────────────────────────────────────

export function defaultBaseUrls(
  basePortEnv: string | undefined = process.env.EVERGREEN_BASE_PORT,
): Record<string, string> {
  const parsedBase =
    basePortEnv !== undefined && basePortEnv.trim() !== ""
      ? Number.parseInt(basePortEnv, 10)
      : Number.NaN;
  const useOffset = Number.isInteger(parsedBase) && parsedBase > 0;
  const urls: Record<string, string> = {};
  for (const [port, service] of Object.entries(PORT_SERVICE_MAP)) {
    const numericPort = Number(port);
    const effectivePort = useOffset
      ? parsedBase + (numericPort - 3000)
      : numericPort;
    urls[service] = `http://localhost:${effectivePort}`;
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

export interface OutputSnapshotContext {
  snapshotBefore?: GymSnapshot;
  snapshotAfter?: GymSnapshot;
}

const SNAPSHOT_TABLE_PK_MAP: Record<string, string> = {
  clients: "id",
  policies: "policy_id",
  endorsements: "endorsement_id",
  commissions: "commission_id",
  escalations: "escalation_id",
  tasks: "id",
  quote_requests: "request_id",
  carrier_quotes: "quote_id",
  leads: "lead_id",
  campaign_enrollments: "enrollment_id",
  documents: "document_id",
  envelopes: "envelope_id",
  messages: "message_id",
  quotes: "quote_id",
  claims: "claim_id",
};

function resolveSnapshotTable(service: string, path: string, explicitTable?: string): string | undefined {
  if (explicitTable) return explicitTable;
  const pathname = path.split("?")[0];
  if (service === "ams") {
    if (pathname.startsWith("/clients")) return "clients";
    if (/^\/policies\/[^/]+\/endorsements$/.test(pathname)) return "endorsements";
    if (pathname.startsWith("/policies")) return "policies";
    if (pathname.startsWith("/tasks")) return "tasks";
    if (pathname.startsWith("/escalations")) return "escalations";
    if (pathname.startsWith("/accounting/commissions")) return "commissions";
  }
  if (service === "rater") {
    if (/^\/quotes\/[^/]+\/results$/.test(pathname)) return "carrier_quotes";
    if (pathname.startsWith("/quotes")) return "quote_requests";
  }
  if (service === "crm") {
    if (pathname.startsWith("/leads")) return "leads";
    if (pathname.startsWith("/campaigns")) return "campaign_enrollments";
  }
  if (service === "ecm") {
    if (pathname.startsWith("/documents")) return "documents";
    if (pathname.startsWith("/envelopes")) return "envelopes";
  }
  if (service === "comm" && pathname.startsWith("/messages")) return "messages";
  if ((service === "summit-fire" || service === "coastal-star") && pathname.includes("/")) return "quotes";
  if (service === "claims" && pathname.startsWith("/claims")) return "claims";
  return undefined;
}

function extractRawRowId(row: Record<string, unknown>, tableName: string): string | undefined {
  const preferred = SNAPSHOT_TABLE_PK_MAP[tableName];
  if (preferred) {
    const val = row[preferred];
    if (val !== undefined && val !== null && val !== "") return String(val);
  }
  for (const key of PRIMARY_KEY_CANDIDATES) {
    const val = row[key];
    if (val !== undefined && val !== null && val !== "") return String(val);
  }
  return undefined;
}

function hasSnapshotTable(
  snapshotBefore: GymSnapshot | undefined,
  snapshotAfter: GymSnapshot | undefined,
  service: string,
  table: string,
): boolean {
  return (
    Array.isArray(snapshotBefore?.[service]?.[table]) ||
    Array.isArray(snapshotAfter?.[service]?.[table])
  );
}

function collectEpisodeRowIds(
  diff: StateDiffResult,
  service: string,
  table: string,
  scope: "inserted" | "updated" | "mutated",
): Set<string> {
  const tableDiff = diff.services[service]?.[table];
  const ids = new Set<string>();
  if (!tableDiff) return ids;
  if (scope === "inserted" || scope === "mutated") {
    for (const row of tableDiff.inserted) {
      const id = extractRawRowId(row, table);
      if (id) ids.add(id);
    }
  }
  if (scope === "updated" || scope === "mutated") {
    for (const upd of tableDiff.updated) {
      const id = extractRawRowId(upd.after, table);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function filterBodyToEpisodeIds(
  body: unknown,
  table: string,
  allowedIds: Set<string>,
): { filteredBody: unknown; singleRecordMissing: boolean } {
  const matchesRow = (item: unknown): boolean => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
    const id = extractRawRowId(item as Record<string, unknown>, table);
    return id !== undefined && allowedIds.has(id);
  };
  if (Array.isArray(body)) {
    return { filteredBody: body.filter(matchesRow), singleRecordMissing: false };
  }
  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return {
        filteredBody: { ...obj, data: obj.data.filter(matchesRow) },
        singleRecordMissing: false,
      };
    }
    if (!matchesRow(obj)) {
      return { filteredBody: null, singleRecordMissing: true };
    }
  }
  return { filteredBody: body, singleRecordMissing: false };
}

export async function evaluateOutput(
  checks: OutputCheck[],
  baseUrls?: Record<string, string>,
  snapshotContext?: OutputSnapshotContext,
): Promise<OutputScore[]> {
  const urls = baseUrls ?? defaultBaseUrls();
  const scores: OutputScore[] = [];
  const episodeDiff =
    snapshotContext?.snapshotBefore && snapshotContext?.snapshotAfter
      ? diffSnapshots(snapshotContext.snapshotBefore, snapshotContext.snapshotAfter)
      : undefined;

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
      let resStatus = 200;
      let rawBody: unknown;

      if (check.snapshotTable) {
        if (episodeDiff) {
          if (
            hasSnapshotTable(
              snapshotContext?.snapshotBefore,
              snapshotContext?.snapshotAfter,
              check.service,
              check.snapshotTable,
            )
          ) {
            const tableDiff = episodeDiff.services[check.service]?.[check.snapshotTable];
            const rows =
              check.episodeScope === "inserted"
                ? (tableDiff?.inserted ?? [])
                : check.episodeScope === "updated"
                  ? (tableDiff?.updated.map((u) => u.after) ?? [])
                  : check.episodeScope === "mutated"
                    ? [...(tableDiff?.inserted ?? []), ...(tableDiff?.updated.map((u) => u.after) ?? [])]
                    : (snapshotContext?.snapshotAfter?.[check.service]?.[check.snapshotTable] ?? []);
            rawBody = { data: rows };
          } else {
            rawBody = { data: [] };
          }
        } else {
          const snapRes = await fetch(`${serviceUrl}/sim/snapshot`, {
            headers: scorerHeaders(),
          });
          resStatus = snapRes.status;
          const snapJson = (await snapRes.json()) as { tables?: Record<string, unknown[]> };
          rawBody = { data: snapJson.tables?.[check.snapshotTable] ?? [] };
        }
      } else {
        const res = await fetch(`${serviceUrl}/v1${check.path}`, {
          headers: scorerHeaders({
            Authorization: `Bearer ${token}`,
          }),
        });
        resStatus = res.status;
        rawBody = await res.json();
      }

      // Status check
      if (resStatus !== check.expect.status) {
        scores.push({
          name: check.name,
          passed: false,
          weight: check.weight,
          detail: `Expected status ${check.expect.status}, got ${resStatus}`,
        });
        continue;
      }

      let body = rawBody;
      if (check.episodeScope && !check.snapshotTable && episodeDiff) {
        const snapTable = resolveSnapshotTable(check.service, check.path);
        const tableAvailable = Boolean(
          snapTable &&
            hasSnapshotTable(
              snapshotContext?.snapshotBefore,
              snapshotContext?.snapshotAfter,
              check.service,
              snapTable,
            ),
        );
        const allowedIds = tableAvailable
          ? collectEpisodeRowIds(episodeDiff, check.service, snapTable!, check.episodeScope)
          : new Set<string>();
        const filtered = filterBodyToEpisodeIds(rawBody, snapTable ?? "", allowedIds);
        if (filtered.singleRecordMissing) {
          scores.push({
            name: check.name,
            passed: false,
            weight: check.weight,
            detail: `Record was not ${check.episodeScope} during this episode`,
          });
          continue;
        }
        body = filtered.filteredBody;
      }

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
