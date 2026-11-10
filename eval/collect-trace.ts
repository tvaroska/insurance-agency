import { parseArgs } from "util";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

import type { OtlpSpan, OtlpTrace, ResourceSpan, ScopeSpan } from "./types";
import { defaultBaseUrls } from "./evaluators/output";

// Collects the service-side request logs (GET /sim/trace on every service) into one
// OTLP JSON trace that `bun eval/score.ts --traces <file>` accepts.

/** defaultBaseUrls(), with any services overridden by the EVERGREEN_BASE_URLS JSON object. */
export function resolveBaseUrls(
  overrides: string | undefined = process.env.EVERGREEN_BASE_URLS,
): Record<string, string> {
  if (!overrides) return defaultBaseUrls();
  let parsed: unknown;
  try {
    parsed = JSON.parse(overrides);
  } catch {
    throw new Error("EVERGREEN_BASE_URLS must be a JSON object of service name to base URL");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((url) => typeof url === "string")
  ) {
    throw new Error("EVERGREEN_BASE_URLS must be a JSON object of service name to base URL");
  }
  return { ...defaultBaseUrls(), ...(parsed as Record<string, string>) };
}

/**
 * Merges per-service traces into one trace with every span in start-time order.
 * parseOtlpTrace sorts by whole milliseconds and keeps file order for ties, so spans are
 * regrouped into consecutive same-service runs to keep sub-millisecond order across services.
 */
export function mergeTraces(traces: OtlpTrace[]): OtlpTrace {
  const entries: { resourceSpan: ResourceSpan; scopeSpan: ScopeSpan; span: OtlpSpan }[] = [];
  for (const trace of traces) {
    for (const resourceSpan of trace.resourceSpans) {
      for (const scopeSpan of resourceSpan.scopeSpans) {
        for (const span of scopeSpan.spans) entries.push({ resourceSpan, scopeSpan, span });
      }
    }
  }
  entries.sort((a, b) => {
    const diff = BigInt(a.span.startTimeUnixNano) - BigInt(b.span.startTimeUnixNano);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  });

  const resourceSpans: ResourceSpan[] = [];
  let previous: (typeof entries)[number] | undefined;
  for (const entry of entries) {
    if (entry.resourceSpan !== previous?.resourceSpan || entry.scopeSpan !== previous?.scopeSpan) {
      resourceSpans.push({
        resource: entry.resourceSpan.resource,
        scopeSpans: [{ ...entry.scopeSpan, spans: [] }],
      });
    }
    resourceSpans[resourceSpans.length - 1].scopeSpans[0].spans.push(entry.span);
    previous = entry;
  }
  return { resourceSpans };
}

/** Fetches GET /sim/trace from every service and merges the results; fails if any service fails. */
export async function collectTrace(
  baseUrls: Record<string, string> = resolveBaseUrls(),
  fetchImpl: typeof fetch = fetch,
): Promise<OtlpTrace> {
  const results = await Promise.allSettled(
    Object.entries(baseUrls).map(async ([service, baseUrl]) => {
      const url = `${baseUrl}/sim/trace`;
      let res: Response;
      try {
        res = await fetchImpl(url);
      } catch (err) {
        throw new Error(`${service}: GET ${url} failed: ${err instanceof Error ? err.message : err}`);
      }
      if (!res.ok) throw new Error(`${service}: GET ${url} returned ${res.status}`);
      return (await res.json()) as OtlpTrace;
    }),
  );

  const failures = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []));
  if (failures.length > 0) {
    throw new Error(`Could not collect the service-side trace:\n  ${failures.join("\n  ")}`);
  }
  return mergeTraces(
    results.map((r) => (r as PromiseFulfilledResult<OtlpTrace>).value),
  );
}

function serviceName(resourceSpan: ResourceSpan): string {
  const attr = resourceSpan.resource.attributes.find((a) => a.key === "service.name");
  return attr?.value.stringValue ?? "unknown";
}

/** "ams 3, comm 2" style span counts per service. */
export function summarizeTrace(trace: OtlpTrace): string {
  const counts = new Map<string, number>();
  for (const resourceSpan of trace.resourceSpans) {
    const spans = resourceSpan.scopeSpans.reduce((n, s) => n + s.spans.length, 0);
    const name = serviceName(resourceSpan);
    counts.set(name, (counts.get(name) ?? 0) + spans);
  }
  return [...counts].map(([name, n]) => `${name} ${n}`).join(", ") || "no spans";
}

// ── CLI ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help || !values.out) {
    console.log(`Usage: bun eval/collect-trace.ts --out <file>

Merges GET /sim/trace from all 8 services into one OTLP JSON trace for
bun eval/score.ts --traces <file>. Base URLs default to http://localhost:3000-3007;
override any of them with EVERGREEN_BASE_URLS='{"ams":"http://ams:3000"}'.`);
    process.exit(values.help ? 0 : 1);
  }

  try {
    const trace = await collectTrace();
    const outPath = resolve(values.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(trace, null, 2));
    console.log(`Wrote ${outPath} (${summarizeTrace(trace)})`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
