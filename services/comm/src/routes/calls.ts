import { Hono } from "hono";
import {
  requireScopes,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { handleGetTranscript } from "../tools/get_transcript";

type AppVariables = CorrelationVariables & AuthVariables;

const callsRouter = new Hono<{ Variables: AppVariables }>();

// ── GET /transcripts/:call_id — Get call transcript via REST ─────────

callsRouter.get(
  "/transcripts/:call_id",
  requireScopes("comm:calls:read"),
  async (c) => {
    const callId = c.req.param("call_id");

    const result = await handleGetTranscript({ call_id: callId }, db);

    if (result.isError) {
      const parsed = JSON.parse(result.content[0].text as string);
      if (parsed.error === "not_found") {
        return c.json({ error_code: "NOT_FOUND", message: parsed.message }, 404);
      }
      return c.json({ error_code: "VALIDATION_ERROR", details: [parsed.error] }, 400);
    }

    const parsed = JSON.parse(result.content[0].text as string);
    return c.json(parsed);
  },
);

export { callsRouter };
