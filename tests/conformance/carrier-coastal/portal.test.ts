import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, startService, type Service } from "../harness";
import { API, COOKIE_NAME, DEFAULT_COVERAGES, jwtPayload, openPortal, policyRow, quoteRow, spaced, start, UUID, type Ctx } from "./support";

let open: Ctx;
let strict: Ctx;

const SEED = {
  tables: {
    quotes: [quoteRow({ quote_id: "QT-ASSESSED" }), quoteRow({ quote_id: "QT-OTHER" })],
    policies: [policyRow({ policy_id: "POL-OLD" })],
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
    test(`CST-R14: GET ${path} sets the bootstrap cookie, in strict and permissive mode`, async () => {
      for (const svc of [strict.svc, open.svc]) {
        const res = await svc.http.get(path);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(bootCookie(res)!).toMatch(new RegExp(`^${COOKIE_NAME}=${UUID}; HttpOnly; SameSite=Strict; Path=/$`));
      }
    });
  }

  test("CST-R14: each load issues a fresh value and earlier values stay valid", async () => {
    const first = bootCookie(await strict.svc.http.get("/"))!.split(";")[0];
    const second = bootCookie(await strict.svc.http.get("/"))!.split(";")[0];
    expect(first).not.toBe(second);
    for (const cookie of [first, second]) {
      expect((await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: cookie } })).status).toBe(200);
    }
  });

  test("CST-R14: no other response sets the cookie", async () => {
    for (const [method, path] of [["GET", "/some/deep/link"], ["HEAD", "/"], ["GET", "/health"], ["GET", "/auth/dev-token"], ["GET", "/auth/portal-session"]]) {
      expect(bootCookie(await open.svc.http.request(method, path))).toBeUndefined();
    }
    const portal = await openPortal(strict.svc);
    expect(bootCookie(await portal.client.get(`${API}/quotes/QT-ASSESSED/risk-assessment`))).toBeUndefined();
  });
});

describe("session endpoint", () => {
  test("CST-R15: in permissive mode a session is issued to anyone, with or without a cookie", async () => {
    for (const headers of [{}, { Cookie: `${COOKIE_NAME}=bogus` }]) {
      const res = await open.svc.http.get("/auth/portal-session", { headers });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(["session_token", "service", "modality", "header", "expires_in"]);
      expect(res.body.session_token).toMatch(new RegExp(`^portal_sess_carrier-coastal_${UUID}$`));
      expect(res.body).toMatchObject({ service: "carrier-coastal", modality: "web-portal", header: "X-Portal-Session", expires_in: 3600 });
    }
  });

  test("CST-R15: in strict mode a session needs a bootstrap cookie this process issued", async () => {
    expectError(await strict.svc.http.get("/auth/portal-session"), 403, "PORTAL_BOOTSTRAP_REQUIRED");
    const unknown = await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: `${COOKIE_NAME}=11111111-2222-3333-4444-555555555555` } });
    expectError(unknown, 403, "PORTAL_BOOTSTRAP_REQUIRED");
    const cookie = bootCookie(await strict.svc.http.get("/"))!.split(";")[0];
    const wrongName = await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: cookie.replace(COOKIE_NAME, "evergreen_portal_boot_other") } });
    expectError(wrongName, 403, "PORTAL_BOOTSTRAP_REQUIRED");
    const ok = await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: `theme=dark; ${cookie}; lang=en` } });
    expect(ok.status).toBe(200);
    expect(ok.body.session_token).toMatch(new RegExp(`^portal_sess_carrier-coastal_${UUID}$`));
  });

  test("CST-R15: each call issues a new token and earlier tokens stay valid", async () => {
    const portal = await openPortal(strict.svc);
    const again = await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: portal.cookie } });
    expect(again.body.session_token).not.toBe(portal.sessionToken);
    expect((await portal.client.get(`${API}/quotes/QT-ASSESSED/risk-assessment`)).status).toBe(200);
    const second = strict.svc.withToken(portal.devToken).with({ "X-Portal-Session": again.body.session_token });
    expect((await second.get(`${API}/quotes/QT-ASSESSED/risk-assessment`)).status).toBe(200);
  });

  test("CST-R15: a cookie issued by the permissive instance is unknown to the strict one", async () => {
    const foreign = bootCookie(await open.svc.http.get("/"))!.split(";")[0];
    expectError(await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: foreign } }), 403, "PORTAL_BOOTSTRAP_REQUIRED");
  });
});

describe("strict guard", () => {
  const routes: [string, string, unknown][] = [
    ["POST", `${API}/quotes/submit`, { client_id: "CLI-001", policy_type: "personal_auto", effective_date: "2026-04-01" }],
    ["GET", `${API}/quotes/QT-ASSESSED/risk-assessment`, undefined],
    ["POST", `${API}/quotes/quick`, { vin: "1HGCM82633A004352", client_id: "CLI-003", driver_name: "Driver" }],
    ["POST", `${API}/quotes/QT-ASSESSED/recalculate`, {}],
    ["POST", `${API}/quotes/QT-OTHER/bind`, { effective_date: "2026-04-01" }],
    ["GET", `${API}/policies/POL-OLD/id-card`, undefined],
  ];
  for (const [method, path, body] of routes) {
    test(`CST-R16: ${method} ${path} needs a portal session in strict mode`, async () => {
      const { result: bare, diff } = await strict.svc.changes(() => strict.api.request(method, path, { body }));
      expectError(bare, 403, "MODALITY_VIOLATION");
      expect(diff).toEqual({});
      expectError(await strict.svc.http.request(method, path, { body }), 403, "MODALITY_VIOLATION");
      const portal = await openPortal(strict.svc);
      const ok = await spaced(() => portal.client.request(method, path, { body }));
      expect([200, 201]).toContain(ok.status);
    });
  }

  test("CST-R16: an unknown, malformed or empty session value is refused", async () => {
    for (const value of ["portal_sess_carrier-coastal_11111111-2222-3333-4444-555555555555", "portal_sess_x", "true", " "]) {
      const res = await strict.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`, { headers: { "X-Portal-Session": value } });
      expectError(res, 403, "MODALITY_VIOLATION");
    }
  });

  test("CST-R16: a valid session does not replace the bearer token or the scope", async () => {
    const portal = await openPortal(strict.svc);
    const session = { "X-Portal-Session": portal.sessionToken };
    const path = `${API}/quotes/QT-ASSESSED/risk-assessment`;
    expectError(await strict.svc.http.get(path, { headers: session }), 401, "AUTH_ERROR");
    expectError(await strict.svc.withToken("not-a-jwt").get(path, { headers: session }), 401, "AUTH_ERROR");
    const narrow = await strict.svc.client({ scopes: ["carrier:policies:read"] });
    expectError(await narrow.get(path, { headers: session }), 403, "FORBIDDEN");
    expect((await narrow.get(`${API}/policies/POL-OLD/id-card`, { headers: session })).status).toBe(200);
  });

  test("CST-R16: the session may accompany any valid token, not only the dev token", async () => {
    const portal = await openPortal(strict.svc);
    const res = await strict.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`, { headers: { "X-Portal-Session": portal.sessionToken } });
    expect(res.status).toBe(200);
  });

  test("CST-R17: in permissive mode the session header is ignored", async () => {
    const path = `${API}/quotes/QT-ASSESSED/risk-assessment`;
    expect((await open.api.get(path)).status).toBe(200);
    expect((await open.api.get(path, { headers: { "X-Portal-Session": "portal_sess_x" } })).status).toBe(200);
    expect((await open.svc.status()).modality_mode).toBe("permissive");
    expect((await strict.svc.status()).modality_mode).toBe("strict");
  });

  test("CST-R18: reset and seed discard every cookie and session", async () => {
    const path = `${API}/quotes/QT-ASSESSED/risk-assessment`;
    for (const wipe of [() => strict.svc.reset("clean"), () => strict.svc.seed(SEED)]) {
      const portal = await openPortal(strict.svc);
      expect((await portal.client.get(path)).status).not.toBe(403);
      await wipe();
      expectError(await portal.client.get(path), 403, "MODALITY_VIOLATION");
      expectError(await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: portal.cookie } }), 403, "PORTAL_BOOTSTRAP_REQUIRED");
      const reopened = await openPortal(strict.svc);
      expect((await reopened.client.get(`${API}/policies/POL-NOPE/id-card`)).status).toBe(404);
    }
  });

  test("CST-R18: time travel does not expire a session", async () => {
    const portal = await openPortal(strict.svc);
    await strict.svc.timeTravel({ days: 30 });
    expect((await portal.client.get(`${API}/quotes/QT-ASSESSED/risk-assessment`)).status).toBe(200);
    expect((await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: portal.cookie } })).status).toBe(200);
  });

  test("CST-R18: a session issued by another service is unknown here", async () => {
    const summit: Service = await startService("carrier-summit", { env: { MODALITY_MODE: "strict" } });
    const page = await summit.http.get("/");
    const cookie = page.headers.getSetCookie().find((c) => c.startsWith("evergreen_portal_boot_carrier-summit="))!.split(";")[0];
    const session = await summit.http.get("/auth/portal-session", { headers: { Cookie: cookie } });
    expect(session.status).toBe(200);
    const res = await strict.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`, { headers: { "X-Portal-Session": session.body.session_token } });
    expectError(res, 403, "MODALITY_VIOLATION");
    expectError(await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: cookie } }), 403, "PORTAL_BOOTSTRAP_REQUIRED");
  }, 30_000);

  test("CST-R19: X-Eval-Scorer: true passes the guard without a session; token and scope still apply", async () => {
    const scorer = { "X-Eval-Scorer": "true" };
    const path = `${API}/quotes/QT-ASSESSED/risk-assessment`;
    expect((await strict.api.get(path, { headers: scorer })).status).toBe(200);
    expectError(await strict.svc.http.get(path, { headers: scorer }), 401, "AUTH_ERROR");
    const narrow = await strict.svc.client({ scopes: ["carrier:policies:read"] });
    expectError(await narrow.get(path, { headers: scorer }), 403, "FORBIDDEN");
    expectError(await strict.api.get(path, { headers: { "X-Eval-Scorer": "1" } }), 403, "MODALITY_VIOLATION");
    expectError(await strict.api.get(path, { headers: { "X-Evergreen-Internal": "1" } }), 403, "MODALITY_VIOLATION");
  });

  test("CST-R19: with EVERGREEN_SCORER_SECRET set the scorer must also present the secret", async () => {
    const guarded = await start({ MODALITY_MODE: "strict", EVERGREEN_SCORER_SECRET: "conformance-scorer-secret" });
    await guarded.svc.seed(SEED);
    const path = `${API}/quotes/QT-ASSESSED/risk-assessment`;
    expectError(await guarded.api.get(path, { headers: { "X-Eval-Scorer": "true" } }), 403, "MODALITY_VIOLATION");
    expectError(await guarded.api.get(path, { headers: { "X-Eval-Scorer": "true", "X-Evergreen-Scorer-Secret": "wrong" } }), 403, "MODALITY_VIOLATION");
    const ok = await guarded.api.get(path, { headers: { "X-Eval-Scorer": "true", "X-Evergreen-Scorer-Secret": "conformance-scorer-secret" } });
    expect(ok.status).toBe(200);
    const portal = await openPortal(guarded.svc);
    expect((await portal.client.get(path)).status).toBe(200);
  }, 30_000);

  test("CST-R20: health, dev token, OAuth tokens, the control plane and the page stay open in strict mode", async () => {
    expect((await strict.svc.http.get("/health")).status).toBe(200);
    expect((await strict.svc.http.get("/auth/dev-token")).status).toBe(200);
    expect(typeof (await strict.svc.token({ clientId: "agent-readonly" }))).toBe("string");
    expect((await strict.svc.http.get("/sim/snapshot")).status).toBe(200);
    expect((await strict.svc.http.get("/sim/trace")).status).toBe(200);
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

  test("CST-R43: the page is an HTML shell titled for the Coastal Star portal with a root element", () => {
    expect(html).toContain("<title>Coastal Star Auto Portal</title>");
    expect(html).toContain('<div id="root"></div>');
    expect(script).toStartWith("/assets/");
    expect(stylesheet).toStartWith("/assets/");
  });

  test("CST-R43: the script and stylesheet named by the page are served with their own content types", async () => {
    const js = await open.svc.http.get(script);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    const css = await open.svc.http.get(stylesheet);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  test("CST-R43: any other GET path returns the same page, so deep links reload the application", async () => {
    for (const path of ["/index.html", "/bind", "/some/deep/link"]) {
      const res = await open.svc.http.get(path);
      expect(res.status).toBe(200);
      expect(res.text).toBe(html);
    }
  });

  test("CST-R45: the served script calls the token, session and API routes of this contract", async () => {
    const js = (await open.svc.http.get(script)).text;
    for (const needle of [
      "/auth/dev-token",
      "/auth/portal-session",
      "X-Portal-Session",
      "MODALITY_VIOLATION",
      "/v1/coastal/quotes/quick",
      "/v1/coastal/quotes/",
      "/recalculate",
      "/bind",
      "/v1/coastal/policies/",
      "/id-card",
    ]) {
      expect(js).toContain(needle);
    }
  });

  test("CST-R45: the served script carries the three screens and their actions", async () => {
    const js = (await open.svc.http.get(script)).text;
    for (const label of [
      "Quick Quote", "Compare & Customize", "Bind & Go",
      "Decode", "Driver Name", "Date of Birth", "License Number", "Client ID", "Get Quote",
      "Bodily Injury", "Property Damage", "Collision Deductible", "Comprehensive Deductible", "Uninsured Motorist", "Recalculate",
      "Effective Date", "Payment Plan", "Bind Now", "Policy bound successfully!", "Training Environment",
    ]) {
      expect(js).toContain(label);
    }
  });
});

describe("what the page must be able to do, driven the way the page drives it", () => {
  test("CST-R7: the dev token is a one-hour token for dev-user with exactly the four carrier scopes", async () => {
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

  test("CST-R45: an API call with the page's three headers succeeds in strict mode", async () => {
    const portal = await openPortal(strict.svc);
    const res = await strict.svc.http.get(`${API}/quotes/QT-ASSESSED/risk-assessment`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${portal.devToken}`,
        "X-Portal-Session": portal.sessionToken,
      },
    });
    expect(res.status).toBe(200);
  });

  test("CST-R46: from a cold start the handshake needs no credentials, and a lost session is recovered by reloading the page", async () => {
    const path = `${API}/quotes/QT-ASSESSED/risk-assessment`;
    const portal = await openPortal(strict.svc);
    expect((await portal.client.get(path)).status).toBe(200);
    await strict.svc.seed(SEED);
    const lost = await portal.client.get(path);
    expect(lost.status).toBe(403);
    expect(lost.body.error_code).toBe("MODALITY_VIOLATION");
    expect((await strict.svc.http.get("/auth/portal-session", { headers: { Cookie: portal.cookie } })).status).toBe(403);
    const again = await openPortal(strict.svc);
    expect((await again.client.get(path)).status).toBe(200);
  });

  test("CST-R47: Quick Quote with the body the page sends creates a quote; licence and premiums go astray (Known gap 7)", async () => {
    const portal = await openPortal(strict.svc);
    const { result: res, diff } = await strict.svc.changes(() =>
      spaced(() =>
        portal.client.post(`${API}/quotes/quick`, {
          vin: "1HGCM82633A004352",
          driver_name: "Maria Rodriguez",
          driver_dob: "1985-05-05",
          license_number: "TX-1234567",
          client_id: "CLI-003",
        }),
      ),
    );
    expect(res.status).toBe(201);
    expect(typeof res.body.quote_id).toBe("string");
    expect(res.body.client_id).toBe("CLI-003");
    expect(res.body.status).toBe("assessed");
    expect(diff.quotes.added).toHaveLength(1);
    // The page sends license_number; the API stores driver_license.
    expect(diff.quotes.added[0]).toMatchObject({ driver_name: "Maria Rodriguez", driver_dob: "1985-05-05", driver_license: null });
    // The page reads top-level premium fields; the API nests them.
    expect(res.body).not.toHaveProperty("premium_annual");
    expect(res.body.premium).toEqual({ annual: 1200, semi_annual: 624, monthly: 100 });
  });

  test("CST-R48: Compare & Customize with a coverages list changes the adjusted premium", async () => {
    const portal = await openPortal(strict.svc);
    const res = await portal.client.post(`${API}/quotes/QT-ASSESSED/recalculate`, {
      coverages: [...DEFAULT_COVERAGES.slice(0, 2), { type: "collision", deductible: 2500 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.original_premium.annual).toBe(1000);
    expect(res.body.adjusted_premium.annual).toBe(700);
    expect((await portal.client.post(`${API}/quotes/QT-NOPE/recalculate`, {})).body.message).toBe("quote not found.");
  });

  test("CST-R48: the flat body the shipped page sends is ignored (Known gap 8)", async () => {
    const portal = await openPortal(strict.svc);
    const pageBody = { bodily_injury: "25/50", property_damage: 25000, collision_deductible: 2500, comprehensive_deductible: 1000, uninsured_motorist: "25/50" };
    const fromPage = await portal.client.post(`${API}/quotes/QT-ASSESSED/recalculate`, pageBody);
    const fromEmpty = await portal.client.post(`${API}/quotes/QT-ASSESSED/recalculate`, {});
    expect(fromPage.status).toBe(200);
    expect(fromPage.body).toEqual(fromEmpty.body);
    // The page treats both premiums as numbers; the API returns objects.
    expect(typeof fromPage.body.original_premium).toBe("object");
    expect(typeof fromPage.body.adjusted_premium).toBe("object");
  });

  test("CST-R49: Bind & Go binds the quote, then fetches the ID card of the new policy", async () => {
    const portal = await openPortal(strict.svc);
    const { result: bound, diff } = await strict.svc.changes(() =>
      spaced(() => portal.client.post(`${API}/quotes/QT-ASSESSED/bind`, { effective_date: "2026-04-01", payment_plan: "semi_annual" })),
    );
    expect(bound.status).toBe(200);
    for (const field of ["policy_id", "bind_status", "effective_date", "expiration_date", "bound_at"]) expect(bound.body[field]).toBeDefined();
    expect(diff.policies.added).toHaveLength(1);
    const card = await portal.client.get(`${API}/policies/${encodeURIComponent(bound.body.policy_id)}/id-card`);
    expect(card.status).toBe(200);
    expect(card.body.card_data.insured_name).toBe("CLI-900");
    // Known gap 9: the page reads these at the top level of the card and of the bind response.
    expect(card.body).not.toHaveProperty("insured_name");
    expect(card.body).not.toHaveProperty("vehicle");
    expect(bound.body).not.toHaveProperty("premium_annual");
    const again = await portal.client.post(`${API}/quotes/QT-ASSESSED/bind`, { effective_date: "2026-04-01", payment_plan: "semi_annual" });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe("Quote has already been bound.");
  });

  test.todo("Known gap 7: the Quick Quote screen shows the premiums and stores the licence in a browser (field names differ between page and API)");
  test.todo("Known gap 8: the Compare & Customize screen changes the premium in a browser (the page sends a body the API ignores)");
  test.todo("Known gap 9: the Bind & Go screen shows plan prices and the insured on the ID card in a browser (the page reads fields the API does not return there)");
  test.todo("Known gap 12: rendering, button gating, the page's own VIN decode and session retry (needs a real browser)");
});

describe("latency", () => {
  test("CST-R44: CARRIER_LATENCY_MS delays authenticated API requests only", async () => {
    const slow = await start({ CARRIER_LATENCY_MS: "300" });
    await slow.svc.seed(SEED);
    const path = `${API}/quotes/QT-ASSESSED/risk-assessment`;
    const timed = async (run: () => Promise<{ status: number }>) => {
      const started = performance.now();
      const res = await run();
      return { status: res.status, ms: performance.now() - started };
    };
    const authed = await timed(() => slow.api.get(path));
    expect(authed.status).toBe(200);
    expect(authed.ms).toBeGreaterThanOrEqual(290);
    const missing = await timed(() => slow.api.get(`${API}/policies/POL-NOPE/id-card`));
    expect(missing.status).toBe(404);
    expect(missing.ms).toBeGreaterThanOrEqual(290);
    const unauthenticated = await timed(() => slow.svc.http.get(path));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.ms).toBeLessThan(250);
    expect((await timed(() => slow.svc.http.get("/health"))).ms).toBeLessThan(250);
    expect((await timed(() => open.api.get(path))).ms).toBeLessThan(250);
  }, 30_000);
});
