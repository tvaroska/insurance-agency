import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract, startService, type Service } from "../harness";
import { API, COOKIE_NAME, jwtPayload, openPortal, quoteRow, policyRow, documentRow, start, submit, SUBMISSION, UUID, type Ctx } from "./support";

const contract = loadContract("carrier-summit");
let open: Ctx;
let strict: Ctx;

const SEED = {
  tables: {
    quotes: [quoteRow({ quote_id: "QT-PENDING" })],
    policies: [policyRow({ policy_id: "POL-DOCS" })],
    policy_documents: [documentRow("SDOC-901", "POL-DOCS")],
  },
};

beforeAll(async () => {
  open = await start();
  strict = await start({ MODALITY_MODE: "strict" });
}, 60_000);
beforeEach(async () => {
  await open.svc.seed(SEED);
  await strict.svc.seed(SEED);
});

const bootCookie = (res: { headers: Headers }) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`));

describe("bootstrap cookie", () => {
  for (const path of ["/", "/index.html"]) {
    test(`SMT-R14: GET ${path} sets the bootstrap cookie, in strict and permissive mode`, async () => {
      for (const svc of [strict.svc, open.svc]) {
        const res = await svc.http.get(path);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        const cookie = bootCookie(res)!;
        expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=${UUID}; HttpOnly; SameSite=Strict; Path=/$`));
      }
    });
  }

  test("SMT-R14: each load issues a fresh value and earlier values stay valid", async () => {
    const first = bootCookie(await strict.svc.http.get("/"))!.split(";")[0];
    const second = bootCookie(await strict.svc.http.get("/"))!.split(";")[0];
    expect(first).not.toBe(second);
    for (const cookie of [first, second]) {
      expect((await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: cookie } })).status).toBe(200);
    }
  });

  test("SMT-R14: no other response sets the cookie", async () => {
    for (const [method, path] of [["GET", "/some/deep/link"], ["HEAD", "/"], ["GET", "/health"], ["GET", "/auth/dev-token"], ["GET", "/auth/portal-session"]]) {
      const res = await open.svc.http.request(method, path);
      expect(bootCookie(res)).toBeUndefined();
    }
    const portal = await openPortal(strict.svc);
    expect(bootCookie(await portal.client.get(`${API}/quotes/QT-PENDING`))).toBeUndefined();
  });
});

describe("session endpoint", () => {
  test("SMT-R15: in permissive mode a session is issued to anyone, with or without a cookie", async () => {
    for (const headers of [{} as Record<string, string>, { Cookie: `${COOKIE_NAME}=bogus` }]) {
      const res = await open.svc.http.get("/auth/portal-session", { headers });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(["session_token", "service", "modality", "header", "expires_in"]);
      expect(res.body.session_token).toMatch(new RegExp(`^portal_sess_carrier-summit_${UUID}$`));
      expect(res.body).toMatchObject({ service: "carrier-summit", modality: "web-portal", header: "X-Portal-Session", expires_in: 3600 });
    }
  });

  test("SMT-R15: in strict mode a session needs a bootstrap cookie this process issued", async () => {
    const none = await strict.svc.http.get("/auth/portal-session");
    expectError(none, 403, "PORTAL_BOOTSTRAP_REQUIRED");
    contract.check(none);
    const unknown = await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: `${COOKIE_NAME}=11111111-2222-3333-4444-555555555555` } });
    expectError(unknown, 403, "PORTAL_BOOTSTRAP_REQUIRED");
    const cookie = bootCookie(await strict.svc.http.get("/"))!.split(";")[0];
    const wrongName = await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: cookie.replace(COOKIE_NAME, "evergreen_portal_boot_other") } });
    expectError(wrongName, 403, "PORTAL_BOOTSTRAP_REQUIRED");
    const ok = await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: `theme=dark; ${cookie}; lang=en` } });
    expect(ok.status).toBe(200);
    contract.check(ok);
    expect(ok.body.session_token).toMatch(new RegExp(`^portal_sess_carrier-summit_${UUID}$`));
  });

  test("SMT-R15: each call issues a new token and earlier tokens stay valid", async () => {
    const portal = await openPortal(strict.svc);
    const again = await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: portal.cookie } });
    expect(again.body.session_token).not.toBe(portal.sessionToken);
    expect((await portal.client.get(`${API}/quotes/QT-PENDING`)).status).toBe(200);
    const second = strict.svc.withToken(portal.devToken).with({ "X-Portal-Session": again.body.session_token });
    expect((await second.get(`${API}/quotes/QT-PENDING`)).status).toBe(200);
  });

  test("SMT-R15: a cookie issued by the permissive instance is unknown to the strict one", async () => {
    const foreign = bootCookie(await open.svc.http.get("/"))!.split(";")[0];
    expectError(await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: foreign } }), 403, "PORTAL_BOOTSTRAP_REQUIRED");
  });
});

describe("strict guard", () => {
  const routes: [string, string, unknown][] = [
    ["GET", `${API}/quotes/QT-PENDING`, undefined],
    ["POST", `${API}/underwriting/QT-PENDING/decision`, { decision: "approve" }],
    ["GET", `${API}/policies/POL-DOCS/documents`, undefined],
    ["POST", `${API}/submissions`, SUBMISSION],
    ["GET", `${API}/inspections/QT-PENDING`, undefined],
    ["GET", `${API}/inspections/QT-PENDING/conditions`, undefined],
  ];
  for (const [method, path, body] of routes) {
    test(`SMT-R16: ${method} ${path} needs a portal session in strict mode`, async () => {
      const { result: bare, diff } = await strict.svc.changes(() => strict.api.request(method, path, { body }));
      expectError(bare, 403, "MODALITY_VIOLATION");
      contract.check(bare);
      expect(diff).toEqual({});
      expectError(await strict.svc.http.request(method, path, { body }), 403, "MODALITY_VIOLATION");
      const portal = await openPortal(strict.svc);
      const ok = await portal.client.request(method, path, { body });
      expect([200, 201]).toContain(ok.status);
    });
  }

  test("SMT-R16: an unknown, malformed or empty session value is refused", async () => {
    for (const value of ["portal_sess_carrier-summit_11111111-2222-3333-4444-555555555555", "portal_sess_x", "true", " "]) {
      const res = await strict.api.get(`${API}/quotes/QT-PENDING`, { headers: { "X-Portal-Session": value } });
      expectError(res, 403, "MODALITY_VIOLATION");
    }
  });

  test("SMT-R16: a valid session does not replace the bearer token or the scope", async () => {
    const portal = await openPortal(strict.svc);
    const session = { "X-Portal-Session": portal.sessionToken };
    expectError(await strict.svc.http.get(`${API}/quotes/QT-PENDING`, { headers: session }), 401, "AUTH_ERROR");
    expectError(await strict.svc.withToken("not-a-jwt").get(`${API}/quotes/QT-PENDING`, { headers: session }), 401, "AUTH_ERROR");
    const narrow = await strict.svc.client({ scopes: ["carrier:policies:read"] });
    const refused = await narrow.get(`${API}/quotes/QT-PENDING`, { headers: session });
    expectError(refused, 403, "FORBIDDEN");
    expect((await narrow.get(`${API}/policies/POL-DOCS/documents`, { headers: session })).status).toBe(200);
  });

  test("SMT-R16: the session may accompany any valid token, not only the dev token", async () => {
    const portal = await openPortal(strict.svc);
    const res = await strict.api.get(`${API}/quotes/QT-PENDING`, { headers: { "X-Portal-Session": portal.sessionToken } });
    expect(res.status).toBe(200);
  });

  test("SMT-R17: in permissive mode the session header is ignored", async () => {
    expect((await open.api.get(`${API}/quotes/QT-PENDING`)).status).toBe(200);
    expect((await open.api.get(`${API}/quotes/QT-PENDING`, { headers: { "X-Portal-Session": "portal_sess_x" } })).status).toBe(200);
    expect((await open.svc.status()).modality_mode).toBe("permissive");
    expect((await strict.svc.status()).modality_mode).toBe("strict");
  });

  test("SMT-R18: reset and seed discard every cookie and session", async () => {
    for (const wipe of [() => strict.svc.reset("clean"), () => strict.svc.seed(SEED)]) {
      const portal = await openPortal(strict.svc);
      expect((await portal.client.get(`${API}/quotes/QT-PENDING`)).status).not.toBe(403);
      await wipe();
      expectError(await portal.client.get(`${API}/quotes/QT-PENDING`), 403, "MODALITY_VIOLATION");
      expectError(await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: portal.cookie } }), 403, "PORTAL_BOOTSTRAP_REQUIRED");
      const reopened = await openPortal(strict.svc);
      expect((await reopened.client.get(`${API}/policies/POL-NOPE/documents`)).status).toBe(404);
    }
  });

  test("SMT-R18: time travel does not expire a session", async () => {
    const portal = await openPortal(strict.svc);
    await strict.svc.timeTravel({ days: 30 });
    expect((await portal.client.get(`${API}/quotes/QT-PENDING`)).status).toBe(200);
    expect((await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: portal.cookie } })).status).toBe(200);
  });

  test("SMT-R18: a session issued by another service is unknown here", async () => {
    const coastal: Service = await startService("carrier-coastal", { env: { MODALITY_MODE: "strict" } });
    const page = await coastal.http.get("/");
    const cookie = page.headers.getSetCookie().find((c) => c.startsWith("evergreen_portal_boot_carrier-coastal="))!.split(";")[0];
    const session = await coastal.http.get("/auth/portal-session", { headers: { Cookie: cookie } });
    expect(session.status).toBe(200);
    const res = await strict.api.get(`${API}/quotes/QT-PENDING`, { headers: { "X-Portal-Session": session.body.session_token } });
    expectError(res, 403, "MODALITY_VIOLATION");
    expectError(await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: cookie } }), 403, "PORTAL_BOOTSTRAP_REQUIRED");
  }, 30_000);

  test("SMT-R19: X-Eval-Scorer: true with X-Evergreen-Scorer-Secret passes the guard without a session; token and scope still apply", async () => {
    const scorer = {
      "X-Eval-Scorer": "true",
      "X-Evergreen-Scorer-Secret": strict.svc.scorerSecret!,
    };
    expect((await strict.api.get(`${API}/quotes/QT-PENDING`, { headers: scorer })).status).toBe(200);
    expectError(await strict.api.get(`${API}/quotes/QT-PENDING`, { headers: { "X-Eval-Scorer": "true" } }), 403, "MODALITY_VIOLATION");
    expectError(await strict.svc.http.get(`${API}/quotes/QT-PENDING`, { headers: scorer }), 401, "AUTH_ERROR");
    const narrow = await strict.svc.client({ scopes: ["carrier:policies:read"] });
    expectError(await narrow.get(`${API}/quotes/QT-PENDING`, { headers: scorer }), 403, "FORBIDDEN");
    expectError(await strict.api.get(`${API}/quotes/QT-PENDING`, { headers: { "X-Eval-Scorer": "1", "X-Evergreen-Scorer-Secret": strict.svc.scorerSecret! } }), 403, "MODALITY_VIOLATION");
    expectError(await strict.api.get(`${API}/quotes/QT-PENDING`, { headers: { "X-Evergreen-Internal": "1", "X-Evergreen-Scorer-Secret": strict.svc.scorerSecret! } }), 403, "MODALITY_VIOLATION");
  });

  test("SMT-R19: with EVERGREEN_SCORER_SECRET set the scorer must also present the secret", async () => {
    const guarded = await start({ MODALITY_MODE: "strict", EVERGREEN_SCORER_SECRET: "conformance-scorer-secret" });
    try {
      await guarded.svc.seed(SEED);
      const path = `${API}/quotes/QT-PENDING`;
      expectError(await guarded.api.get(path, { headers: { "X-Eval-Scorer": "true" } }), 403, "MODALITY_VIOLATION");
      expectError(await guarded.api.get(path, { headers: { "X-Eval-Scorer": "true", "X-Evergreen-Scorer-Secret": "wrong" } }), 403, "MODALITY_VIOLATION");
      const ok = await guarded.api.get(path, { headers: { "X-Eval-Scorer": "true", "X-Evergreen-Scorer-Secret": "conformance-scorer-secret" } });
      expect(ok.status).toBe(200);
      const portal = await openPortal(guarded.svc);
      expect((await portal.client.get(path)).status).toBe(200);
    } finally {
      await guarded.svc.stop();
    }
  }, 30_000);

  test("SMT-R20: health, dev token, OAuth tokens and the page stay open in strict mode while /sim/* requires the scorer secret", async () => {
    expect((await strict.svc.http.get("/health")).status).toBe(200);
    expect((await strict.svc.http.get("/auth/dev-token")).status).toBe(200);
    expect(typeof (await strict.svc.token({ clientId: "agent-readonly" }))).toBe("string");
    expect((await strict.svc.http.get("/sim/snapshot")).status).toBe(403);
    expect((await strict.svc.http.get("/sim/trace")).status).toBe(403);
    const sec = { "X-Evergreen-Scorer-Secret": strict.svc.scorerSecret! };
    expect((await strict.svc.http.get("/sim/snapshot", { headers: sec })).status).toBe(200);
    expect((await strict.svc.http.get("/sim/trace", { headers: sec })).status).toBe(200);
    expect((await strict.svc.http.get("/")).status).toBe(200);
  });
});

describe("static UI", () => {
  let html: string;
  let script: string;
  let stylesheet: string;
  beforeAll(async () => {
    html = (await open.svc.http.get("/")).text;
    script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1] ?? "";
    stylesheet = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(html)?.[1] ?? "";
  });

  test("SMT-R35: the page is an HTML shell titled for the Summit portal with a root element", () => {
    expect(html).toContain("<title>Summit Fire &amp; Casualty — Commercial Agent Portal</title>");
    expect(html).toContain('<div id="root"></div>');
    expect(script).toStartWith("/assets/");
    expect(stylesheet).toStartWith("/assets/");
  });

  test("SMT-R35: the script and stylesheet named by the page are served with their own content types", async () => {
    const js = await open.svc.http.get(script);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    const css = await open.svc.http.get(stylesheet);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  test("SMT-R35: any other GET path returns the same page, so deep links reload the application", async () => {
    for (const path of ["/index.html", "/underwriting", "/some/deep/link"]) {
      const res = await open.svc.http.get(path);
      expect(res.status).toBe(200);
      expect(res.text).toBe(html);
    }
  });

  test("SMT-R37: the served script calls the token, session and API routes of this contract", async () => {
    const js = (await open.svc.http.get(script)).text;
    for (const needle of [
      "/auth/dev-token",
      "/auth/portal-session",
      "X-Portal-Session",
      "MODALITY_VIOLATION",
      "/v1/summit/submissions",
      "/v1/summit/quotes/",
      "/v1/summit/inspections/",
      "/v1/summit/underwriting/",
      "/v1/summit/policies/",
    ]) {
      expect(js).toContain(needle);
    }
  });

  test("SMT-R37: the served script carries the three screens and their actions", async () => {
    const js = (await open.svc.http.get(script)).text;
    for (const label of [
      "Property Submission", "Underwriting Review", "Policy Documents",
      "Street Address", "Year Built", "Square Footage", "Construction Type", "Roof Type", "Dwelling Limit", "Submit Property",
      "Look Up", "Quote Details", "Review Timeline", "Approve", "Decline", "Refer",
      "No documents found for this policy.", "Training Environment",
    ]) {
      expect(js).toContain(label);
    }
  });
});

describe("what the page must be able to do, driven the way the page drives it", () => {
  test("SMT-R7: the dev token is a one-hour token for dev-user with exactly the four carrier scopes", async () => {
    const res = await strict.svc.http.get("/auth/dev-token");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["token"]);
    const payload = jwtPayload(res.body.token);
    expect(payload.sub).toBe("dev-user");
    expect(payload.scope.split(" ").sort()).toEqual(
      ["carrier:policies:read", "carrier:quotes:read", "carrier:quotes:write", "carrier:underwriting:write"],
    );
    expect(payload.exp - payload.iat).toBe(3600);
  });

  test("SMT-R37: an API call with the page's three headers succeeds in strict mode", async () => {
    const portal = await openPortal(strict.svc);
    const res = await strict.svc.http.get(`${API}/quotes/QT-PENDING`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${portal.devToken}`,
        "X-Portal-Session": portal.sessionToken,
      },
    });
    expect(res.status).toBe(200);
  });

  test("SMT-R38: from a cold start the handshake needs no credentials, and a lost session is recovered by reloading the page", async () => {
    const portal = await openPortal(strict.svc);
    expect((await portal.client.get(`${API}/quotes/QT-PENDING`)).status).toBe(200);
    await strict.svc.seed(SEED);
    const lost = await portal.client.get(`${API}/quotes/QT-PENDING`);
    expect(lost.status).toBe(403);
    expect(lost.body.error_code).toBe("MODALITY_VIOLATION");
    expect((await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: portal.cookie } })).status).toBe(403);
    const again = await openPortal(strict.svc);
    expect((await again.client.get(`${API}/quotes/QT-PENDING`)).status).toBe(200);
  });

  test("SMT-R39: Underwriting Review look-up: quote, then conditions", async () => {
    const portal = await openPortal(strict.svc);
    const sub = await submit(portal.client);
    const quote = await portal.client.get(`${API}/quotes/${encodeURIComponent(sub.body.quote_id)}`);
    expect(quote.status).toBe(200);
    for (const field of ["quote_id", "client_id", "policy_type", "underwriting_status"]) expect(quote.body[field]).toBeDefined();
    const conditions = await portal.client.get(`${API}/inspections/${encodeURIComponent(sub.body.quote_id)}/conditions`);
    expect(conditions.status).toBe(200);
    expect(conditions.body.conditions).toHaveLength(3);
    for (const c of conditions.body.conditions) {
      expect(typeof c.condition_id).toBe("string");
      expect(typeof c.description).toBe("string");
      expect(c.status).toBe("pending");
    }
    const missing = await portal.client.get(`${API}/quotes/QT-NOPE`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe("quote not found.");
  });

  test("SMT-R40: Policy Documents search lists what the table shows", async () => {
    const portal = await openPortal(strict.svc);
    const res = await portal.client.get(`${API}/policies/POL-DOCS/documents`);
    expect(res.status).toBe(200);
    for (const doc of res.body.documents) {
      for (const field of ["document_id", "document_type", "filename", "file_size_bytes", "created_at"]) expect(doc[field]).toBeDefined();
      // Known gap 9: the table's Version column has no data to show.
      expect(doc).not.toHaveProperty("version");
    }
    expect((await portal.client.get(`${API}/policies/POL-NOPE/documents`)).body.message).toBe("policy not found.");
  });

  test("SMT-R41: Property Submission bundle carries the fixed submission fields and succeeds through strict portal session (Known gap 7)", async () => {
    const html = (await open.svc.http.get("/")).text;
    const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1] ?? "";
    const js = (await open.svc.http.get(script)).text;
    for (const key of ["client_id", "policy_type", "property_address", "property_details", "coverages", "deductibles", "photo_checklist"]) {
      expect(js).toContain(key);
    }
    const portal = await openPortal(strict.svc);
    const { result: res, diff } = await strict.svc.changes(() =>
      submit(portal.client, { ...SUBMISSION, deductibles: { all_perils: 1000 }, photo_checklist: ["front_exterior"] }),
    );
    expect(res.status).toBe(201);
    contract.check(res);
    expect(diff.quotes.added).toHaveLength(1);
    expect(diff.quotes.added[0]).toMatchObject({ status: "submitted", inspection_status: "scheduled" });
    expect(diff.underwriting_conditions.added).toHaveLength(3);
  });

  test("SMT-R41: legacy malformed submission body remains refused with 400", async () => {
    const portal = await openPortal(strict.svc);
    const legacyBody = {
      address: { street: "1 Aspen St", city: "Denver", state: "CO", zip: "80202" },
      property: { year_built: 1996, square_feet: 2400, construction_type: "frame", roof_type: "metal" },
      photos: ["front_exterior"],
      coverage: { dwelling_limit: 350000, deductible: 1000 },
    };
    const { result: res, diff } = await strict.svc.changes(() => submit(portal.client, legacyBody));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("One or more fields failed validation.");
    expect(res.body.details.map((d: any) => d.field)).toEqual(["client_id", "policy_type", "property_address", "property_details", "coverages"]);
    contract.check(res);
    expect(diff).toEqual({});
  });

  test("SMT-R42: Underwriting Review bundle sends approve/decline/refer for pending_review and referred quotes (Known gap 8)", async () => {
    const html = (await open.svc.http.get("/")).text;
    const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1] ?? "";
    const js = (await open.svc.http.get(script)).text;
    for (const key of ["pending_review", "referred", "approve", "decline", "refer"]) {
      expect(js).toContain(key);
    }
    const portal = await openPortal(strict.svc);
    const res = await portal.client.post(`${API}/underwriting/QT-PENDING/decision`, { decision: "refer", notes: "Awaiting roof report" });
    expect(res.status).toBe(200);
    contract.check(res);
    const reloaded = await portal.client.get(`${API}/quotes/QT-PENDING`);
    expect(reloaded.body).toMatchObject({ underwriting_status: "referred", underwriting_notes: "Awaiting roof report" });
    const final = await portal.client.post(`${API}/underwriting/QT-PENDING/decision`, { decision: "approve" });
    expect(final.body.underwriting_status).toBe("approved");
    contract.check(final);
  });

  test("SMT-R42: legacy past-tense decision words remain refused with 400", async () => {
    const portal = await openPortal(strict.svc);
    for (const decision of ["approved", "declined", "referred"]) {
      const res = await portal.client.post(`${API}/underwriting/QT-PENDING/decision`, { decision, notes: "from legacy client" });
      expect(res.status).toBe(400);
      expect(res.body.details[0]).toMatchObject({ field: "decision", code: "invalid_enum" });
      contract.check(res);
    }
    expect((await portal.client.get(`${API}/quotes/QT-PENDING`)).body.underwriting_status).toBe("pending_review");
  });

  test("Known gap 12 (static asset boundary; interactive DOM smoke is in browser.test.ts): served portal bundle carries step controls, timeline, and session-retry markers", async () => {
    const html = (await open.svc.http.get("/")).text;
    const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1] ?? "";
    const js = (await open.svc.http.get(script)).text;
    for (const marker of ["Review Timeline", "Submit Property", "MODALITY_VIOLATION", "/auth/portal-session", "Approve", "Decline", "Refer"]) {
      expect(js).toContain(marker);
    }
  });
});

describe("latency", () => {
  test("SMT-R36: CARRIER_LATENCY_MS delays authenticated API requests only", async () => {
    const injectedMs = 300;
    const slow = await start({ CARRIER_LATENCY_MS: String(injectedMs) });
    await slow.svc.seed(SEED);
    const path = `${API}/quotes/QT-PENDING`;
    const timed = async (run: () => Promise<{ status: number }>) => {
      const started = performance.now();
      const res = await run();
      return { status: res.status, ms: performance.now() - started };
    };
    const fastOfTwo = async (run: () => Promise<{ status: number }>) => {
      const a = await timed(run);
      const b = await timed(run);
      return a.ms <= b.ms ? a : b;
    };

    // Warm up and capture un-delayed baseline on the open instance.
    await open.api.get(path);
    await slow.svc.http.get("/health");
    const baselineOpen = await fastOfTwo(() => open.api.get(path));

    const authed = await timed(() => slow.api.get(path));
    expect(authed.status).toBe(200);
    expect(authed.ms).toBeGreaterThanOrEqual(injectedMs - 15);
    expect(authed.ms - baselineOpen.ms).toBeGreaterThanOrEqual(injectedMs - 50);

    const missing = await timed(() => slow.api.get(`${API}/quotes/QT-NOPE`));
    expect(missing.status).toBe(404);
    expect(missing.ms).toBeGreaterThanOrEqual(injectedMs - 15);
    expect(missing.ms - baselineOpen.ms).toBeGreaterThanOrEqual(injectedMs - 50);

    const minDelayedMs = Math.min(authed.ms, missing.ms);
    const unauthenticated = await fastOfTwo(() => slow.svc.http.get(path));
    expect(unauthenticated.status).toBe(401);
    expect(minDelayedMs - unauthenticated.ms).toBeGreaterThanOrEqual(injectedMs - 120);

    const health = await fastOfTwo(() => slow.svc.http.get("/health"));
    expect(health.status).toBe(200);
    expect(minDelayedMs - health.ms).toBeGreaterThanOrEqual(injectedMs - 120);

    const fast = await fastOfTwo(() => open.api.get(path));
    expect(fast.status).toBe(200);
    expect(minDelayedMs - fast.ms).toBeGreaterThanOrEqual(injectedMs - 120);
  }, 30_000);
});
