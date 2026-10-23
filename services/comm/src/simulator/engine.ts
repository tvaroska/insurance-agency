import type { PrismaClient } from "../generated/prisma/client";
import { SIMULATOR_RULES, type SimulatorTurnRule } from "./rules";

export interface SimulatedReplyInput {
  to: string;
  channel: string;
  subject?: string;
  body: string;
  clientId?: string;
  outboundTimestamp: string;
}

export interface SimulatedReplyResult {
  message_id: string;
  scenario_id: string;
  turn: number;
  client_id: string;
  direction: "inbound";
  channel: string;
  from: string;
  to: string;
  subject: string | null;
  body: string;
  timestamp: string;
}

function normalizeRecipient(addr: string): string {
  const trimmed = addr.trim().toLowerCase();
  // Strip +1 or non-digit formatting if phone-like, while preserving email addresses
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return trimmed;
}

function matchesRuleTarget(
  rule: SimulatorTurnRule,
  clientId: string | undefined,
  normalizedTo: string,
): boolean {
  if (clientId && rule.client_ids.includes(clientId)) {
    return true;
  }
  return rule.recipient_matches.some(
    (m) => m.toLowerCase() === normalizedTo,
  );
}

export async function processSimulatedReply(
  input: SimulatedReplyInput,
  db: PrismaClient,
): Promise<SimulatedReplyResult | null> {
  if (process.env.SIMULATOR_DISABLED === "true") {
    return null;
  }

  const normalizedTo = normalizeRecipient(input.to);
  const combinedText = `${input.subject ?? ""} ${input.body}`.toLowerCase();

  // Find candidate scenarios matching client_id or recipient
  const candidateScenarios = new Set<string>();
  for (const rule of SIMULATOR_RULES) {
    if (matchesRuleTarget(rule, input.clientId, normalizedTo)) {
      candidateScenarios.add(rule.scenario_id);
    }
  }

  if (candidateScenarios.size === 0) {
    return null;
  }

  for (const scenarioId of candidateScenarios) {
    const prefix = `msg_sim_${scenarioId}_`;
    const existingReplies = await db.message.count({
      where: {
        message_id: { startsWith: prefix },
      },
    });

    const rule = SIMULATOR_RULES.find(
      (r) => r.scenario_id === scenarioId && r.turn_index === existingReplies,
    );
    if (!rule) continue;

    const keywordMatched = rule.trigger_keywords.some((kw) =>
      combinedText.includes(kw.toLowerCase()),
    );
    if (!keywordMatched) continue;

    const replyMessageId = `${prefix}t${existingReplies + 1}_${crypto.randomUUID().slice(0, 8)}`;
    const baseMs = Date.parse(input.outboundTimestamp);
    const replyTimestamp = new Date(
      (Number.isNaN(baseMs) ? Date.now() : baseMs) + 10,
    ).toISOString();
    const toAddr =
      input.channel === "email" ? "service@evergreen-ins.com" : "800-555-EVER";

    await db.message.create({
      data: {
        message_id: replyMessageId,
        client_id: rule.reply.client_id,
        direction: "inbound",
        channel: input.channel,
        subject: input.channel === "email" ? rule.reply.subject : null,
        body: rule.reply.body,
        from_addr: rule.reply.from_addr,
        to_addr: toAddr,
        timestamp: replyTimestamp,
        read: false,
        status: "delivered",
        template_id: null,
        topics: JSON.stringify(rule.reply.topics),
        attachments: "[]",
      },
    });

    return {
      message_id: replyMessageId,
      scenario_id: scenarioId,
      turn: existingReplies + 1,
      client_id: rule.reply.client_id,
      direction: "inbound",
      channel: input.channel,
      from: rule.reply.from_addr,
      to: toAddr,
      subject: input.channel === "email" ? rule.reply.subject : null,
      body: rule.reply.body,
      timestamp: replyTimestamp,
    };
  }

  return null;
}
