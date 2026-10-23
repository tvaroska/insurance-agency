/**
 * OpenEnv / Simulation Control Plane TypeScript Client (`eval/openenv/client.ts`).
 *
 * Orchestrates fast (<100ms) in-memory/SQLite state resets, database snapshots,
 * simulated clock time-travel, and chaos fault injection across all 8 Evergreen
 * Insurance API Gym microservices (`/sim/*`).
 */

import { PORT_SERVICE_MAP } from "../types";

export interface ServiceEndpoint {
  service: string;
  port: number;
  baseUrl: string;
}

export const SERVICE_ENDPOINTS: ServiceEndpoint[] = Object.entries(
  PORT_SERVICE_MAP,
).map(([portStr, service]) => {
  const port = Number(portStr);
  return {
    service,
    port,
    baseUrl: `http://localhost:${port}`,
  };
});

export interface SimResetResponse {
  status: "reset";
  service: string;
  seed_mode: string;
  simulated_time: string;
}

export interface SimSnapshotResponse {
  service: string;
  timestamp: string;
  simulated_time: string;
  tables: Record<string, unknown[]>;
}

export interface SimTimeTravelRequest {
  days?: number;
  target_date?: string;
}

export interface SimTimeTravelResponse {
  status: "ok";
  service: string;
  simulated_time: string;
  days_advanced: number;
  transitions: Record<string, number>;
}

export interface SimChaosRequest {
  enabled: boolean;
  error_rate?: number;
  status_code?: number;
  latency_ms?: number;
}

export interface SimChaosResponse {
  status: "ok";
  service: string;
  chaos: {
    enabled: boolean;
    error_rate: number;
    status_code: number;
    latency_ms: number;
  };
}

export interface SimClientOptions {
  endpoints?: ServiceEndpoint[];
  fetchImpl?: typeof fetch;
  services?: string[];
}

function resolveTargets(options?: SimClientOptions): ServiceEndpoint[] {
  const all = options?.endpoints ?? SERVICE_ENDPOINTS;
  if (!options?.services || options.services.length === 0) {
    return all;
  }
  const filter = new Set(options.services);
  return all.filter((ep) => filter.has(ep.service));
}

/**
 * Resets all (or selected) microservices to clean or realistic seed data via `POST /sim/reset`.
 */
export async function resetAllServices(
  seedMode: "clean" | "realistic" | string = "realistic",
  options?: SimClientOptions,
): Promise<Record<string, SimResetResponse>> {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const targets = resolveTargets(options);

  const pairs = await Promise.all(
    targets.map(async (ep) => {
      const res = await fetchFn(`${ep.baseUrl}/sim/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed_mode: seedMode }),
      });
      if (!res.ok) {
        throw new Error(
          `Failed to reset ${ep.service} (${res.status}): ${await res.text()}`,
        );
      }
      const data = (await res.json()) as SimResetResponse;
      return [ep.service, data] as const;
    }),
  );

  return Object.fromEntries(pairs);
}

/**
 * Captures a full database state snapshot across all (or selected) microservices via `GET /sim/snapshot`.
 */
export async function snapshotAllServices(
  options?: SimClientOptions,
): Promise<Record<string, SimSnapshotResponse>> {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const targets = resolveTargets(options);

  const pairs = await Promise.all(
    targets.map(async (ep) => {
      const res = await fetchFn(`${ep.baseUrl}/sim/snapshot`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(
          `Failed to snapshot ${ep.service} (${res.status}): ${await res.text()}`,
        );
      }
      const data = (await res.json()) as SimSnapshotResponse;
      return [ep.service, data] as const;
    }),
  );

  return Object.fromEntries(pairs);
}

/**
 * Advances the simulated clock across all (or selected) microservices via `POST /sim/time-travel`.
 */
export async function timeTravelAllServices(
  params: SimTimeTravelRequest,
  options?: SimClientOptions,
): Promise<Record<string, SimTimeTravelResponse>> {
  if (params.days === undefined && !params.target_date) {
    throw new Error(
      "timeTravelAllServices requires either `days` or `target_date`.",
    );
  }
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const targets = resolveTargets(options);

  const pairs = await Promise.all(
    targets.map(async (ep) => {
      const res = await fetchFn(`${ep.baseUrl}/sim/time-travel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        throw new Error(
          `Failed time-travel on ${ep.service} (${res.status}): ${await res.text()}`,
        );
      }
      const data = (await res.json()) as SimTimeTravelResponse;
      return [ep.service, data] as const;
    }),
  );

  return Object.fromEntries(pairs);
}

/**
 * Configures chaos fault injection (`error_rate`, `status_code`, `latency_ms`)
 * across all (or selected) microservices via `POST /sim/chaos`.
 */
export async function configureChaosAllServices(
  config: SimChaosRequest,
  options?: SimClientOptions,
): Promise<Record<string, SimChaosResponse>> {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const targets = resolveTargets(options);

  const pairs = await Promise.all(
    targets.map(async (ep) => {
      const res = await fetchFn(`${ep.baseUrl}/sim/chaos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        throw new Error(
          `Failed chaos config on ${ep.service} (${res.status}): ${await res.text()}`,
        );
      }
      const data = (await res.json()) as SimChaosResponse;
      return [ep.service, data] as const;
    }),
  );

  return Object.fromEntries(pairs);
}
