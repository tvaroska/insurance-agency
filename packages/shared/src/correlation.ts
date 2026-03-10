import { createMiddleware } from "hono/factory";

const HEADER = "X-Correlation-ID";

export type CorrelationVariables = {
  correlationId: string;
};

export const correlationId = createMiddleware<{
  Variables: CorrelationVariables;
}>(async (c, next) => {
  const id = c.req.header(HEADER) ?? crypto.randomUUID();
  c.set("correlationId", id);
  await next();
  c.header(HEADER, id);
});
