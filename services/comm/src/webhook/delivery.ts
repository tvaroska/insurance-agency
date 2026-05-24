import type { PrismaClient } from "../generated/prisma/client";
import { signPayload, buildWebhookEnvelope } from "./signing";

export interface WebhookDeliveryRecord {
  delivery_id: string;
  webhook_id: string;
  event_id: string;
  event_type: string;
  payload: string;
  signature: string;
  status: string;
  attempts: number;
  last_attempt_at: string;
  next_retry_at: string | null;
  response_status: number;
  created_at: string;
}

/**
 * Simulate webhook delivery for a given event.
 * Looks up active webhooks subscribed to the event type,
 * computes HMAC-SHA256 signature, and records delivery.
 */
export async function simulateDelivery(
  db: PrismaClient,
  eventType: string,
  eventData: unknown,
): Promise<WebhookDeliveryRecord[]> {
  const activeWebhooks = await db.webhook.findMany({
    where: { active: true },
  });

  const deliveries: WebhookDeliveryRecord[] = [];

  for (const wh of activeWebhooks) {
    const subscribedEvents: string[] = JSON.parse(wh.events);
    if (!subscribedEvents.includes(eventType)) continue;

    const envelope = buildWebhookEnvelope(eventType, eventData);
    const payloadStr = JSON.stringify(envelope);
    const signature = signPayload(payloadStr, wh.secret);
    const now = new Date().toISOString();

    const delivery = {
      delivery_id: `del_${crypto.randomUUID()}`,
      webhook_id: wh.webhook_id,
      event_id: envelope.event_id,
      event_type: eventType,
      payload: payloadStr,
      status: "delivered",
      attempts: 1,
      last_attempt_at: now,
      next_retry_at: null,
      response_status: 200,
      created_at: now,
    };

    await db.webhookDelivery.create({ data: delivery });

    deliveries.push({ ...delivery, signature });
  }

  return deliveries;
}
