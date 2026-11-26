import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchAllClients, fetchClient, fetchClientPolicies } from "../clients/ams-client";
import { fetchClaim } from "../clients/claims-client";

describe("ECM service-to-service clients mark outbound calls internal", () => {
  let fetchSpy: ReturnType<typeof spyOn> | undefined;
  afterEach(() => fetchSpy?.mockRestore());

  test("AMS and Claims clients attach X-Evergreen-Internal: 1 alongside Authorization", async () => {
    const prevSecret = process.env.EVERGREEN_SCORER_SECRET;
    process.env.EVERGREEN_SCORER_SECRET = "ecm-internal-secret";
    try {
      const seen: Record<string, string>[] = [];
      fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input: unknown, init?: RequestInit) => {
        seen.push(init?.headers as Record<string, string>);
        return new Response(JSON.stringify({ data: [], pagination: { has_more: false } }), { status: 200 });
      }) as unknown as typeof fetch);

      await fetchClient("CLI-001", "Bearer agent-token");
      await fetchClientPolicies("CLI-001", "Bearer agent-token");
      await fetchAllClients("Bearer agent-token");
      await fetchClaim("CLM-2026-000010", "Bearer agent-token");

      expect(seen).toHaveLength(4);
      for (const headers of seen) {
        expect(headers).toEqual({
          Authorization: "Bearer agent-token",
          "X-Evergreen-Internal": "1",
          "X-Evergreen-Scorer-Secret": "ecm-internal-secret",
        });
      }
    } finally {
      if (prevSecret === undefined) delete process.env.EVERGREEN_SCORER_SECRET;
      else process.env.EVERGREEN_SCORER_SECRET = prevSecret;
    }
  });
});
