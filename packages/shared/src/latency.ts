import { createMiddleware } from "hono/factory";

/**
 * Simulates carrier API latency for realistic training scenarios.
 * Reads CARRIER_LATENCY_MS env var; defaults to 0 (no delay).
 */
export const carrierLatency = createMiddleware(async (c, next) => {
  const ms = parseInt(process.env.CARRIER_LATENCY_MS || "0", 10);
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  await next();
});
