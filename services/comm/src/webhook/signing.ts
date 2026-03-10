import { createHmac } from "crypto";

export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function buildWebhookEnvelope(eventType: string, data: unknown) {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    data,
  };
}

/**
 * Exponential back-off schedule for webhook retries.
 * Returns delay in milliseconds: 1s, 2s, 4s, 8s, 16s (5 retries max).
 */
export function calculateRetryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), 16000);
}
