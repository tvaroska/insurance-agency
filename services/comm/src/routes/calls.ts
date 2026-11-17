import { Hono } from "hono";
import {
  requireScopes,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { prisma } from "../prisma";
import { handleGetTranscript } from "../tools/get_transcript";
import { parseToolResultJson } from "../tools/parse-result";

type AppVariables = CorrelationVariables & AuthVariables;

const callsRouter = new Hono<{ Variables: AppVariables }>();

// ── GET /transcripts/:call_id — Get call transcript via REST ─────────

callsRouter.get(
  "/transcripts/:call_id",
  requireScopes("comm:calls:read"),
  async (c) => {
    const callId = c.req.param("call_id");

    const result = await handleGetTranscript({ call_id: callId }, prisma);

    if (result.isError) {
      const parsed = parseToolResultJson(result);
      if (parsed.error === "not_found") {
        return c.json({ error_code: "NOT_FOUND", message: parsed.message }, 404);
      }
      return c.json({ error_code: "VALIDATION_ERROR", details: [parsed.error] }, 400);
    }

    const parsed = parseToolResultJson(result);
    return c.json(parsed);
  },
);

export { callsRouter };
