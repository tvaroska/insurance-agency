import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { createErrorResponse } from "./errors";

// ── Simulated Clock State ───────────────────────────────────────────

let simulatedOffsetMs = 0;

/**
 * Returns the current simulated Date (wall clock + offset from time-travel).
 */
export function getSimulatedNow(): Date {
  return new Date(Date.now() + simulatedOffsetMs);
}

/**
 * Returns the current simulated clock offset in milliseconds.
 */
export function getSimulatedOffsetMs(): number {
  return simulatedOffsetMs;
}

/**
 * Resets the simulated clock back to real wall-clock time.
 */
export function resetSimulatedClock(): void {
  simulatedOffsetMs = 0;
}

/**
 * Advances the simulated clock by `days` or to `target_date`.
 */
export function advanceSimulatedClock(opts: {
  days?: number;
  target_date?: string;
}): { simulatedNow: Date; daysAdvanced: number } {
  const currentSim = getSimulatedNow();

  if (typeof opts.days === "number" && !Number.isNaN(opts.days)) {
    const deltaMs = opts.days * 86_400_000;
    simulatedOffsetMs += deltaMs;
    return {
      simulatedNow: getSimulatedNow(),
      daysAdvanced: opts.days,
    };
  }

  if (opts.target_date) {
    const target = new Date(opts.target_date);
    if (Number.isNaN(target.getTime())) {
      throw new Error(`Invalid target_date: ${opts.target_date}`);
    }
    const deltaMs = target.getTime() - currentSim.getTime();
    simulatedOffsetMs += deltaMs;
    const daysAdvanced = Math.round((deltaMs / 86_400_000) * 100) / 100;
    return {
      simulatedNow: getSimulatedNow(),
      daysAdvanced,
    };
  }

  return {
    simulatedNow: currentSim,
    daysAdvanced: 0,
  };
}

// ── Chaos Injection State & Middleware ──────────────────────────────

export interface ChaosConfig {
  enabled: boolean;
  error_rate: number;
  status_code: number;
  latency_ms: number;
}

const DEFAULT_CHAOS_CONFIG: ChaosConfig = {
  enabled: false,
  error_rate: 0,
  status_code: 503,
  latency_ms: 0,
};

let chaosConfig: ChaosConfig = { ...DEFAULT_CHAOS_CONFIG };

export function getChaosConfig(): ChaosConfig {
  return { ...chaosConfig };
}

export function setChaosConfig(update: Partial<ChaosConfig>): ChaosConfig {
  chaosConfig = {
    enabled: update.enabled ?? chaosConfig.enabled,
    error_rate:
      update.error_rate !== undefined
        ? Math.max(0, Math.min(1, update.error_rate))
        : chaosConfig.error_rate,
    status_code: update.status_code ?? chaosConfig.status_code ?? 503,
    latency_ms:
      update.latency_ms !== undefined
        ? Math.max(0, update.latency_ms)
        : chaosConfig.latency_ms,
  };
  return getChaosConfig();
}

export function resetChaosConfig(): ChaosConfig {
  chaosConfig = { ...DEFAULT_CHAOS_CONFIG };
  return getChaosConfig();
}

/**
 * Middleware that injects configurable latency and HTTP errors on `/v1/*` and `/mcp`
 * routes when chaos mode is enabled, while never affecting `/health` or `/sim/*`.
 */
export function chaosMiddleware() {
  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    if (
      !chaosConfig.enabled ||
      path === "/health" ||
      path.startsWith("/sim")
    ) {
      await next();
      return;
    }

    if (path.startsWith("/v1") || path.startsWith("/mcp")) {
      if (chaosConfig.latency_ms > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, chaosConfig.latency_ms),
        );
      }

      if (chaosConfig.error_rate > 0 && Math.random() < chaosConfig.error_rate) {
        const correlationId = c.get?.("correlationId") ?? crypto.randomUUID();
        return c.json(
          createErrorResponse(
            "SERVICE_UNAVAILABLE",
            `Simulated chaos fault (${chaosConfig.status_code}) injected by /sim/chaos.`,
            { correlationId },
          ),
          chaosConfig.status_code as any,
        );
      }
    }

    await next();
  });
}

// ── Strict 3-Modality Enforcement (S3-MOD-1) ────────────────────────

export type EnforcedModality = "mcp" | "web-portal";

/**
 * Middleware enforcing strict modality access (`MODALITY_MODE=strict`).
 * - Always allows requests with header `X-Eval-Scorer: true`.
 * - For `mcp`: blocks direct `/v1/*` REST bypass calls with 403 `MODALITY_VIOLATION`.
 * - For `web-portal`: requires `X-Portal-Session` header or browser `Referer` + `User-Agent`,
 *   blocking headless REST API bypass calls with 403 `MODALITY_VIOLATION`.
 */
export function strictModalityGuard(modality: EnforcedModality) {
  return createMiddleware(async (c, next) => {
    const mode = (process.env.MODALITY_MODE || "permissive").toLowerCase();
    if (mode !== "strict") {
      await next();
      return;
    }

    // Always allow evaluation scorer queries
    const evalScorer = c.req.header("X-Eval-Scorer");
    if (evalScorer && evalScorer.toLowerCase() === "true") {
      await next();
      return;
    }

    const correlationId = c.get?.("correlationId") ?? crypto.randomUUID();

    if (modality === "mcp") {
      return c.json(
        createErrorResponse(
          "MODALITY_VIOLATION",
          "MODALITY_MODE=strict prohibits direct REST API bypass on Comm Hub. Use the MCP endpoint (/mcp) or stdio transport.",
          { correlationId },
        ),
        403,
      );
    }

    if (modality === "web-portal") {
      const portalSession = c.req.header("X-Portal-Session");
      const referer = c.req.header("Referer") || c.req.header("Referrer");
      const userAgent = c.req.header("User-Agent") || "";
      const hasPortalSession = Boolean(portalSession && portalSession.trim().length > 0);
      const hasBrowserPortalContext =
        Boolean(referer) && userAgent.includes("Mozilla");

      if (hasPortalSession || hasBrowserPortalContext) {
        await next();
        return;
      }

      return c.json(
        createErrorResponse(
          "MODALITY_VIOLATION",
          "MODALITY_MODE=strict requires interacting through the Carrier Web Portal UI (with X-Portal-Session from /auth/portal-session or browser Referer).",
          { correlationId },
        ),
        403,
      );
    }

    await next();
  });
}

/**
 * Creates the `/auth/portal-session` endpoint for React carrier portals.
 */
export function portalSessionEndpoint(serviceName: string) {
  const router = new Hono();
  router.get("/auth/portal-session", (c) => {
    const sessionToken = `portal_sess_${serviceName}_${crypto.randomUUID().slice(0, 12)}`;
    return c.json({
      session_token: sessionToken,
      service: serviceName,
      modality: "web-portal",
      header: "X-Portal-Session",
      expires_in: 3600,
    });
  });
  return router;
}

// ── Simulation Control Plane Router (/sim/*) ────────────────────────

export interface SimTableConfig {
  name: string;
  delegate: string;
  orderBy: string;
}

export interface SimRouterOptions {
  serviceName: string;
  prisma: any;
  tables: SimTableConfig[];
  onTimeTravel?: (
    days: number,
    simulatedNow: Date,
  ) => Promise<Record<string, number>>;
  onReset?: (seedMode: string) => Promise<void>;
}

/**
 * Creates the `/sim` router providing:
 * - `GET /sim/snapshot`
 * - `POST /sim/reset`
 * - `POST /sim/time-travel`
 * - `POST /sim/chaos`
 * - `GET /sim/status`
 */
export function createSimRouter(options: SimRouterOptions) {
  const router = new Hono();

  // GET /sim/snapshot
  router.get("/snapshot", async (c) => {
    const tableData: Record<string, unknown[]> = {};
    for (const tbl of options.tables) {
      const model = options.prisma?.[tbl.delegate];
      if (model && typeof model.findMany === "function") {
        tableData[tbl.name] = await model.findMany({
          orderBy: { [tbl.orderBy]: "asc" },
        });
      } else {
        tableData[tbl.name] = [];
      }
    }

    return c.json({
      service: options.serviceName,
      timestamp: new Date().toISOString(),
      simulated_time: getSimulatedNow().toISOString(),
      tables: tableData,
    });
  });

  // POST /sim/reset
  router.post("/reset", async (c) => {
    let body: { seed_mode?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      // optional JSON body
    }

    const seedMode = body.seed_mode || process.env.SEED_MODE || "realistic";
    resetChaosConfig();
    resetSimulatedClock();

    if (options.onReset) {
      await options.onReset(seedMode);
    }

    return c.json({
      status: "reset",
      service: options.serviceName,
      seed_mode: seedMode,
      simulated_time: getSimulatedNow().toISOString(),
    });
  });

  // POST /sim/time-travel
  router.post("/time-travel", async (c) => {
    let body: { days?: number; target_date?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Request body must be valid JSON with 'days' or 'target_date'.",
        ),
        400,
      );
    }

    if (body.days === undefined && !body.target_date) {
      return c.json(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Provide either 'days' (number) or 'target_date' (ISO date string).",
        ),
        400,
      );
    }

    let clockResult: { simulatedNow: Date; daysAdvanced: number };
    try {
      clockResult = advanceSimulatedClock({
        days: body.days,
        target_date: body.target_date,
      });
    } catch (err: any) {
      return c.json(
        createErrorResponse(
          "VALIDATION_ERROR",
          err?.message || "Invalid time-travel parameters.",
        ),
        400,
      );
    }

    const transitions = options.onTimeTravel
      ? await options.onTimeTravel(
          clockResult.daysAdvanced,
          clockResult.simulatedNow,
        )
      : {};

    return c.json({
      status: "ok",
      service: options.serviceName,
      simulated_time: clockResult.simulatedNow.toISOString(),
      days_advanced: clockResult.daysAdvanced,
      transitions,
    });
  });

  // POST /sim/chaos
  router.post("/chaos", async (c) => {
    let body: Partial<ChaosConfig> = {};
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        createErrorResponse("VALIDATION_ERROR", "Invalid JSON body for /sim/chaos."),
        400,
      );
    }

    if (typeof body.enabled !== "boolean") {
      return c.json(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Field 'enabled' (boolean) is required.",
        ),
        400,
      );
    }

    const updated = setChaosConfig(body);
    return c.json({
      status: "ok",
      service: options.serviceName,
      chaos: updated,
    });
  });

  // GET /sim/status
  router.get("/status", (c) => {
    return c.json({
      status: "ok",
      service: options.serviceName,
      simulated_time: getSimulatedNow().toISOString(),
      clock_offset_ms: getSimulatedOffsetMs(),
      chaos: getChaosConfig(),
      modality_mode: process.env.MODALITY_MODE || "permissive",
    });
  });

  return router;
}
