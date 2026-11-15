import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import {
  API,
  cents,
  decodeVin,
  DEFAULT_COVERAGES,
  ENUM_GAPS,
  ISO_TIME,
  policyRow,
  quoteRow,
  rawQuoteRow,
  recommendation,
  riskFactors,
  riskScore,
  riskTier,
  spaced,
  start,
  type Ctx,
} from "./support";

const contract = loadContract("carrier-coastal");
let ctx: Ctx;

const CARD = {
  card_id: "IDC-EXISTING-1",
  policy_id: "POL-CARD",
  card_data: { carrier: "Coastal Star Insurance", policy_number: "POL-CARD", insured_name: "Someone Else" },
  issued_at: "2026-01-02T03:04:05.000Z",
};

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: {
      quotes: [
        quoteRow({ quote_id: "QT-ASSESSED" }),
        quoteRow({ quote_id: "QT-NOPREM", premium_annual: null, premium_monthly: null }),
        rawQuoteRow({ quote_id: "QT-RAW" }),
        quoteRow({ quote_id: "QT-BOUND", status: "bound", bind_status: "bound", bound_at: "2026-01-06T00:00:00Z", policy_id: "POL-OLD" }),
        rawQuoteRow({ quote_id: "QT-EXPIRED", status: "expired" }),
      ],
      policies: [policyRow({ policy_id: "POL-OLD" }), policyRow({ policy_id: "POL-CARD" })],
      id_cards: [CARD],
    },
  });
});

const post = (path: string, body: unknown = {}) => spaced(() => ctx.api.post(`${API}${path}`, body));
const quote = async (id: string) => (await ctx.svc.table("quotes")).find((q) => q.quote_id === id)!;

/** An id of the given prefix whose risk score (CST-R21) satisfies `want`. */
function idWithScore(prefix: string, want: (score: number) => boolean): string {
  for (let i = 0; i < 10_000; i++) {
    if (want(riskScore(`${prefix}-${i}`))) return `${prefix}-${i}`;
  }
  throw new Error("no id found");
}

describe("risk arithmetic", () => {
  test("CST-R21: the documented example scores 80", () => {
    expect(riskScore("QT-001-CSTL")).toBe(80);
  });

  const bands: [string, (s: number) => boolean][] = [
    ["below 45", (s) => s < 45],
    ["45 to 49", (s) => s >= 45 && s < 50],
    ["50 to 59", (s) => s >= 50 && s < 60],
    ["60 to 64", (s) => s >= 60 && s < 65],
    ["65 to 69", (s) => s >= 65 && s < 70],
    ["70 to 74", (s) => s >= 70 && s < 75],
    ["75 and above", (s) => s >= 75],
  ];
  for (const [label, want] of bands) {
    test(`CST-R21: assessing a quote whose id scores ${label} stores the score, tier and factors of the id`, async () => {
      const id = idWithScore("QT-BAND", want);
      const score = riskScore(id);
      await ctx.svc.seed({ tables: { quotes: [rawQuoteRow({ quote_id: id })] } });
      const res = await post("/quotes/submit", { quote_id: id });
      expect(res.status).toBe(201);
      expect(res.body.risk_score).toBe(score);
      expect(res.body.risk_score).toBeGreaterThanOrEqual(30);
      expect(res.body.risk_score).toBeLessThanOrEqual(89);
      const row = await quote(id);
      expect(row.risk_score).toBe(score);
      expect(JSON.parse(row.risk_factors)).toEqual(riskFactors(score));
      const assessment = await ctx.api.get(`${API}/quotes/${id}/risk-assessment`);
      expect(assessment.body).toMatchObject({ risk_score: score, risk_tier: riskTier(score), recommendation: recommendation(score) });
    });
  }

  test("CST-R22: tiers switch at 50 and 75", async () => {
    const cases: [number, string][] = [[49, "non_standard"], [50, "standard"], [74, "standard"], [75, "preferred"]];
    for (const [score, tier] of cases) {
      const id = idWithScore("QT-TIER", (s) => s === score);
      await ctx.svc.seed({ tables: { quotes: [rawQuoteRow({ quote_id: id })] } });
      const res = await post("/quotes/submit", { quote_id: id });
      expect([res.body.risk_score, res.body.risk_tier]).toEqual([score, tier]);
    }
  });

  test("CST-R23: the three factors switch at 60, 70 and 50", async () => {
    const expectations: [number, string[]][] = [
      [49, ["neutral", "neutral", "negative"]],
      [50, ["neutral", "neutral", "positive"]],
      [59, ["neutral", "neutral", "positive"]],
      [60, ["positive", "neutral", "positive"]],
      [69, ["positive", "neutral", "positive"]],
      [70, ["positive", "positive", "positive"]],
    ];
    for (const [score, impacts] of expectations) {
      const id = idWithScore("QT-FACTOR", (s) => s === score);
      await ctx.svc.seed({ tables: { quotes: [rawQuoteRow({ quote_id: id })] } });
      await post("/quotes/submit", { quote_id: id });
      const factors = (await ctx.api.get(`${API}/quotes/${id}/risk-assessment`)).body.factors;
      expect(factors.map((f: any) => f.factor)).toEqual(["driver_age", "vehicle_value", "claims_history"]);
      expect(factors.map((f: any) => f.impact)).toEqual(impacts);
    }
    const low = idWithScore("QT-FACTOR", (s) => s === 49);
    await ctx.svc.seed({ tables: { quotes: [rawQuoteRow({ quote_id: low })] } });
    await post("/quotes/submit", { quote_id: low });
    expect((await ctx.api.get(`${API}/quotes/${low}/risk-assessment`)).body.factors.map((f: any) => f.detail)).toEqual([
      "Driver age within acceptable range",
      "Vehicle value is moderate",
      "Recent claims on file",
    ]);
    const high = idWithScore("QT-FACTOR", (s) => s === 70);
    await ctx.svc.seed({ tables: { quotes: [rawQuoteRow({ quote_id: high })] } });
    await post("/quotes/submit", { quote_id: high });
    expect((await ctx.api.get(`${API}/quotes/${high}/risk-assessment`)).body.factors.map((f: any) => f.detail)).toEqual([
      "Primary driver in preferred age range",
      "Vehicle value within low-risk tier",
      "No claims in past 3 years",
    ]);
  });

  test("CST-R24: the recommendation follows the stored score and switches at 45 and 65", async () => {
    const cases: [number, string][] = [[30, "decline"], [44, "decline"], [45, "review"], [64, "review"], [65, "approve"], [89, "approve"]];
    await ctx.svc.seed({
      tables: { quotes: cases.map(([score]) => quoteRow({ quote_id: `QT-REC-${score}`, risk_score: score })) },
    });
    for (const [score, expected] of cases) {
      const res = await ctx.api.get(`${API}/quotes/QT-REC-${score}/risk-assessment`);
      expect([res.body.risk_score, res.body.recommendation]).toEqual([score, expected]);
    }
  });
});

describe("POST /quotes/submit, new quote", () => {
  const NEW = { client_id: "CLI-001", policy_type: "personal_auto", effective_date: "2026-04-01" };

  test("CST-R25: an empty body reports the three required fields, in order, and writes nothing", async () => {
    const { result: res, diff } = await ctx.svc.changes(() => post("/quotes/submit", {}));
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details.map((d: any) => [d.field, d.code])).toEqual([
      ["client_id", "required"],
      ["policy_type", "required"],
      ["effective_date", "required"],
    ]);
    expect(diff).toEqual({});
  });

  for (const field of ["client_id", "policy_type", "effective_date"]) {
    for (const [label, value] of [["missing", undefined], ["null", null], ["an empty string", ""]] as const) {
      test(`CST-R25: ${field} ${label} is a required error on that field only`, async () => {
        const body: Record<string, unknown> = { ...NEW, [field]: value };
        if (value === undefined) delete body[field];
        const { result: res, diff } = await ctx.svc.changes(() => post("/quotes/submit", body));
        expectError(res, 400, "VALIDATION_ERROR", { field, code: "required" });
        expect(res.body.details).toHaveLength(1);
        expect(diff).toEqual({});
      });
    }
  }

  test("CST-R25: an empty quote_id selects the new-quote form", async () => {
    expectError(await post("/quotes/submit", { quote_id: "" }), 400, "VALIDATION_ERROR", { field: "client_id", code: "required" });
    expect((await post("/quotes/submit", { ...NEW, quote_id: "" })).status).toBe(201);
  });

  test("CST-R26: a new quote is stored assessed, with risk from its id and a premium from its type and score", async () => {
    const before = (await ctx.svc.now()).getTime();
    const coverages = [{ type: "collision", deductible: 500 }];
    const { result: res, diff } = await ctx.svc.changes(() => post("/quotes/submit", { ...NEW, coverages }));
    expect(res.status).toBe(201);
    const id: string = res.body.quote_id;
    expect(id).toMatch(/^QT-CSTL-\d{13}$/);
    expect(res.body.request_id).toMatch(/^QR-\d{13}$/);
    expect(Math.abs(Number(id.slice("QT-CSTL-".length)) - before)).toBeLessThan(60_000);
    const score = riskScore(id);
    const annual = cents(1400 * (1 + (score - 50) / 100));
    expect(Object.keys(diff)).toEqual(["quotes"]);
    expect(diff.quotes.changed).toEqual([]);
    expect(diff.quotes.removed).toEqual([]);
    expect(diff.quotes.added).toEqual([
      {
        quote_id: id,
        request_id: res.body.request_id,
        client_id: "CLI-001",
        policy_type: "personal_auto",
        premium_annual: annual,
        premium_monthly: cents(annual / 12),
        premium_semi_annual: null,
        coverages: JSON.stringify(coverages),
        deductibles: "{}",
        status: "assessed",
        decline_reason: null,
        valid_until: null,
        submitted_at: res.body.assessed_at,
        risk_score: score,
        risk_tier: riskTier(score),
        risk_factors: JSON.stringify(riskFactors(score)),
        assessed_at: res.body.assessed_at,
        bind_status: "unbound",
        bound_at: null,
        policy_id: null,
        vin: null,
        vehicle_year: null,
        vehicle_make: null,
        vehicle_model: null,
        driver_name: null,
        driver_dob: null,
        driver_license: null,
        coverage_config: null,
      },
    ]);
    expect(res.body.assessed_at).toMatch(ISO_TIME);
    expect(Math.abs(Date.parse(res.body.assessed_at) - before)).toBeLessThan(60_000);
  });

  test("CST-R26: the base premium is 2800 for bop and 1400 for every other type; coverages default to []", async () => {
    for (const [type, base] of [["bop", 2800], ["personal_auto", 1400], ["homeowners", 1400], ["anything", 1400]] as const) {
      const res = await post("/quotes/submit", { ...NEW, policy_type: type });
      expect(res.status).toBe(201);
      const score = riskScore(res.body.quote_id);
      expect(res.body.risk_score).toBe(score);
      expect(res.body.premium_annual).toBe(cents(base * (1 + (score - 50) / 100)));
      expect(res.body.premium_monthly).toBe(cents(res.body.premium_annual / 12));
      expect(res.body.coverages).toEqual([]);
    }
  });

  test("CST-R27: the response is 201 with the eleven documented fields", async () => {
    const res = await post("/quotes/submit", NEW);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual([
      "quote_id", "request_id", "client_id", "policy_type", "premium_annual", "premium_monthly", "coverages", "status",
      "risk_score", "risk_tier", "assessed_at",
    ]);
    expect(res.body).toMatchObject({ client_id: "CLI-001", policy_type: "personal_auto", status: "assessed" });
    expect(res.body.risk_tier).toBe(riskTier(res.body.risk_score));
    // Tolerated issues are Known gap 3 of specs/carrier-coastal.spec.md.
    contract.check(res, { allow: [...ENUM_GAPS, /missing required property 'deductibles'/, /missing required property 'submitted_at'/] });
  });

  test("CST-R27: a new quote can be assessed, recalculated and bound straight away", async () => {
    const res = await post("/quotes/submit", NEW);
    const id = res.body.quote_id;
    expect((await ctx.api.get(`${API}/quotes/${id}/risk-assessment`)).status).toBe(200);
    expect((await post(`/quotes/${id}/recalculate`)).status).toBe(200);
    expect((await post(`/quotes/${id}/bind`, { effective_date: "2026-05-01" })).status).toBe(200);
  });

  test.todo("Known gap 1: an invalid body is 422 (the service answers 400)");
  test.todo("Known gap 3: the new-quote response matches CoastalQuoteAssessed (no deductibles or submitted_at; policy_type outside the documented enum)");
});

describe("POST /quotes/submit, existing quote", () => {
  test("CST-R28: an unknown quote is 404", async () => {
    const res = await post("/quotes/submit", { quote_id: "QT-NOPE" });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("quote not found.");
    contract.check(res);
  });

  for (const [id, status] of [["QT-ASSESSED", "assessed"], ["QT-BOUND", "bound"], ["QT-EXPIRED", "expired"]]) {
    test(`CST-R28: a quote that is ${status} cannot be submitted again`, async () => {
      const { result: res, diff } = await ctx.svc.changes(() => post("/quotes/submit", { quote_id: id }));
      expectError(res, 409, "CONFLICT");
      expect(res.body.message).toBe(`Quote already has status '${status}'. Only 'quoted' quotes can be submitted.`);
      contract.check(res);
      expect(diff).toEqual({});
    });
  }

  test("CST-R29: a quoted quote becomes assessed; only the status and risk columns change", async () => {
    const before = (await ctx.svc.now()).getTime();
    const { result: res, diff } = await ctx.svc.changes(() =>
      post("/quotes/submit", { quote_id: "QT-RAW", client_id: "IGNORED", policy_type: "bop", coverages: [] }),
    );
    expect(res.status).toBe(201);
    const score = riskScore("QT-RAW");
    expect(Object.keys(res.body)).toEqual([
      "quote_id", "request_id", "client_id", "policy_type", "premium_annual", "premium_monthly", "coverages", "deductibles",
      "status", "risk_score", "risk_tier", "assessed_at", "submitted_at",
    ]);
    expect(res.body).toEqual({
      quote_id: "QT-RAW",
      request_id: "QR-T-1",
      client_id: "CLI-900",
      policy_type: "personal_auto",
      premium_annual: 1000,
      premium_monthly: 83.33,
      coverages: [{ type: "bodily_injury", limit: "100/300" }, { type: "collision", deductible: 500 }],
      deductibles: { collision: 500 },
      status: "assessed",
      risk_score: score,
      risk_tier: riskTier(score),
      assessed_at: res.body.assessed_at,
      submitted_at: "2026-01-05T09:00:00Z",
    });
    expect(Math.abs(Date.parse(res.body.assessed_at) - before)).toBeLessThan(60_000);
    expect(Object.keys(diff)).toEqual(["quotes"]);
    expect(diff.quotes.added).toEqual([]);
    expect(diff.quotes.changed).toHaveLength(1);
    expect([...diff.quotes.changed[0].fields].sort()).toEqual(["assessed_at", "risk_factors", "risk_score", "risk_tier", "status"]);
    expect(JSON.parse(diff.quotes.changed[0].after.risk_factors as string)).toEqual(riskFactors(score));
    contract.check(res, { allow: ENUM_GAPS });
  });

  test("CST-R29: once assessed, a second submit is a conflict", async () => {
    expect((await post("/quotes/submit", { quote_id: "QT-RAW" })).status).toBe(201);
    expectError(await post("/quotes/submit", { quote_id: "QT-RAW" }), 409, "CONFLICT");
  });
});

describe("GET /quotes/{quote_id}/risk-assessment", () => {
  test("CST-R30: the stored assessment is returned with a recommendation", async () => {
    const stored = [{ factor: "custom", impact: "neutral", detail: "stored as given" }];
    await ctx.svc.seed({ tables: { quotes: [quoteRow({ quote_id: "QT-STORED", risk_score: 66, risk_tier: "standard", risk_factors: stored })] } });
    const { result: res, diff } = await ctx.svc.changes(() => ctx.api.get(`${API}/quotes/QT-STORED/risk-assessment`));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["quote_id", "risk_score", "risk_tier", "factors", "recommendation", "assessed_at"]);
    expect(res.body).toEqual({
      quote_id: "QT-STORED",
      risk_score: 66,
      risk_tier: "standard",
      factors: stored,
      recommendation: "approve",
      assessed_at: "2026-01-05T09:00:00Z",
    });
    expect(diff).toEqual({});
  });

  test("CST-R30: an assessment with the standard factors matches the OpenAPI schema", async () => {
    const res = await ctx.api.get(`${API}/quotes/QT-ASSESSED/risk-assessment`);
    expect(res.status).toBe(200);
    contract.check(res);
  });

  test("CST-R30: an unknown quote is 404 'quote not found.'", async () => {
    const res = await ctx.api.get(`${API}/quotes/QT-NOPE/risk-assessment`);
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("quote not found.");
    contract.check(res);
  });

  test("CST-R30: a quote that was never assessed is 404 'risk assessment not found.'", async () => {
    const res = await ctx.api.get(`${API}/quotes/QT-RAW/risk-assessment`);
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("risk assessment not found.");
    await ctx.svc.seed({ tables: { quotes: [quoteRow({ quote_id: "QT-NO-TIME", assessed_at: null })] } });
    const noTime = await ctx.api.get(`${API}/quotes/QT-NO-TIME/risk-assessment`);
    expect(noTime.body.message).toBe("risk assessment not found.");
  });
});

describe("POST /quotes/quick", () => {
  const QUICK = { vin: "1HGCM82633A004352", client_id: "CLI-003", driver_name: "Maria Rodriguez", driver_dob: "1985-05-05" };
  const baseMs = Date.parse("2026-10-14T12:00:00.000Z");
  const yearsAgo = (years: number) => new Date(baseMs - years * 365.25 * 86_400_000 - 40 * 86_400_000).toISOString().slice(0, 10);
  const vinWithYear = (prefix: string, year: number) => {
    for (let i = 0; i < 10_000; i++) {
      const vin = `${prefix}${String(i).padStart(14, "0")}`;
      if (decodeVin(vin).year === year) return vin;
    }
    throw new Error("no VIN found");
  };

  test("CST-R31: an empty body reports vin, client_id and driver_name, in order, and writes nothing", async () => {
    const { result: res, diff } = await ctx.svc.changes(() => post("/quotes/quick", {}));
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details.map((d: any) => [d.field, d.code])).toEqual([
      ["vin", "required"],
      ["client_id", "required"],
      ["driver_name", "required"],
    ]);
    expect(diff).toEqual({});
  });

  for (const field of ["vin", "client_id", "driver_name"]) {
    test(`CST-R31: an empty ${field} is a required error on that field only`, async () => {
      const res = await post("/quotes/quick", { ...QUICK, [field]: "" });
      expectError(res, 400, "VALIDATION_ERROR", { field, code: "required" });
      expect(res.body.details).toHaveLength(1);
    });
  }

  test("CST-R31: the VIN's length and characters are not checked", async () => {
    const res = await post("/quotes/quick", { ...QUICK, vin: "zzz" });
    expect(res.status).toBe(201);
    expect(res.body.vehicle).toEqual({ vin: "zzz", ...decodeVin("zzz") });
    expect(res.body.vehicle.make).toBe("Generic");
    expect(res.body.vehicle.model).toBe("Sedan");
  });

  test("CST-R32: the documented example decodes to a 2021 Honda Accord", async () => {
    const res = await post("/quotes/quick", QUICK);
    expect(res.body.vehicle).toEqual({ vin: "1HGCM82633A004352", year: 2021, make: "Honda", model: "Accord" });
  });

  const makes: [string, string, string[]][] = [
    ["1HG", "Honda", ["Civic", "Accord", "CR-V"]],
    ["1FA", "Ford", ["Mustang", "Fusion", "F-150"]],
    ["1G1", "Chevrolet", ["Malibu", "Equinox", "Silverado"]],
    ["5YJ", "Tesla", ["Model 3", "Model Y", "Model S"]],
    ["WBA", "BMW", ["3 Series", "5 Series", "X3"]],
    ["JTD", "Toyota", ["Camry", "RAV4", "Corolla"]],
    ["XYZ", "Generic", ["Sedan"]],
  ];
  for (const [prefix, make, models] of makes) {
    test(`CST-R32: prefix ${prefix} decodes to ${make} with year and model from the VIN hash`, async () => {
      const seenModels = new Set<string>();
      for (const tail of ["AAAAAAAAAAAAA1", "BBBBBBBBBBBBB2", "CCCCCCCCCCCCC3", "DDDDDDDDDDDDD4"]) {
        const vin = `${prefix}${tail}`;
        const res = await post("/quotes/quick", { ...QUICK, vin });
        expect(res.status).toBe(201);
        expect(res.body.vehicle).toEqual({ vin, ...decodeVin(vin) });
        expect(res.body.vehicle.make).toBe(make);
        expect(models).toContain(res.body.vehicle.model);
        expect(res.body.vehicle.year).toBeGreaterThanOrEqual(2018);
        expect(res.body.vehicle.year).toBeLessThanOrEqual(2025);
        seenModels.add(res.body.vehicle.model);
      }
      if (models.length > 1) expect(seenModels.size).toBeGreaterThan(1);
    });
  }

  test("CST-R32: the prefix is matched in upper case while the hash uses the VIN as given", async () => {
    const vin = "1hgcm82633a004352";
    const res = await post("/quotes/quick", { ...QUICK, vin });
    expect(res.body.vehicle.make).toBe("Honda");
    expect(res.body.vehicle).toEqual({ vin, ...decodeVin(vin) });
    expect(decodeVin(vin)).not.toEqual(decodeVin(vin.toUpperCase()));
  });

  const vehicleFactors: [string, number, number][] = [["two years old or newer", 2025, 1.15], ["three to five years old", 2022, 1.0], ["older than five years", 2019, 0.9]];
  const driverFactors: [string, string | undefined, number][] = [
    ["under 25", yearsAgo(20), 1.4],
    ["25 to 29", yearsAgo(27), 1.15],
    ["30 to 65", yearsAgo(40), 1.0],
    ["over 65", yearsAgo(70), 1.1],
    ["no date of birth (1990-01-01 is assumed)", undefined, 1.0],
  ];
  for (const [vehicleLabel, year, vehicleFactor] of vehicleFactors) {
    for (const [driverLabel, dob, driverFactor] of driverFactors) {
      test(`CST-R33: premium for a vehicle ${vehicleLabel} and a driver ${driverLabel}`, async () => {
        const vin = vinWithYear("1HG", year);
        const res = await post("/quotes/quick", { vin, client_id: "CLI-003", driver_name: "Driver", ...(dob ? { driver_dob: dob } : {}) });
        expect(res.status).toBe(201);
        expect(res.body.vehicle.year).toBe(year);
        const annual = cents(1200 * vehicleFactor * driverFactor);
        expect(res.body.premium).toEqual({ annual, semi_annual: cents(annual * 0.52), monthly: cents(annual / 12) });
      });
    }
  }

  test("CST-R33: the vehicle-age steps fall between 2024 and 2023 and between 2021 and 2020", async () => {
    const expected: [number, number][] = [[2025, 1380], [2024, 1380], [2023, 1200], [2022, 1200], [2021, 1200], [2020, 1080], [2019, 1080], [2018, 1080]];
    for (const [year, annual] of expected) {
      const res = await post("/quotes/quick", { vin: vinWithYear("JTD", year), client_id: "CLI-003", driver_name: "Driver", driver_dob: yearsAgo(40) });
      expect([res.body.vehicle.year, res.body.premium.annual]).toEqual([year, annual]);
    }
  });

  test("CST-R33: the age bands switch at 25 and 30", async () => {
    const vin = vinWithYear("1HG", 2022);
    const annualFor = async (years: number) =>
      (await post("/quotes/quick", { vin, client_id: "CLI-003", driver_name: "Driver", driver_dob: yearsAgo(years) })).body.premium.annual;
    expect(await annualFor(24)).toBe(1680);
    expect(await annualFor(25)).toBe(1380);
    expect(await annualFor(29)).toBe(1380);
    expect(await annualFor(30)).toBe(1200);
    expect(await annualFor(65)).toBe(1200);
    expect(await annualFor(66)).toBe(1320);
  });

  test("CST-R34: the risk score is a whole number from 50 to 84 with the matching tier and the quick-quote factors", async () => {
    const scores = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const res = await post("/quotes/quick", QUICK);
      const score = res.body.risk_score;
      scores.add(score);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(50);
      expect(score).toBeLessThanOrEqual(84);
      expect(res.body.risk_tier).toBe(score >= 75 ? "preferred" : "standard");
      const row = await quote(res.body.quote_id);
      expect(JSON.parse(row.risk_factors)).toEqual([
        { factor: "driver_age", impact: score >= 60 ? "positive" : "neutral", detail: "Driver age assessment" },
        { factor: "vehicle_value", impact: "neutral", detail: "2021 Honda Accord" },
        { factor: "claims_history", impact: "positive", detail: "No claims on file" },
      ]);
    }
    expect(scores.size).toBeGreaterThan(1);
  });

  test("CST-R35: a quick quote stores an assessed personal auto quote with vehicle, driver and default coverages", async () => {
    const before = (await ctx.svc.now()).getTime();
    const { result: res, diff } = await ctx.svc.changes(() => post("/quotes/quick", { ...QUICK, driver_license: "TX-1234567" }));
    expect(res.status).toBe(201);
    expect(res.body.quote_id).toMatch(/^QT-CSTL-\d{13}$/);
    expect(Object.keys(diff)).toEqual(["quotes"]);
    const row: any = diff.quotes.added[0];
    expect(diff.quotes.added).toHaveLength(1);
    expect(row.request_id).toMatch(/^QR-\d{13}$/);
    expect(row).toEqual({
      quote_id: res.body.quote_id,
      request_id: row.request_id,
      client_id: "CLI-003",
      policy_type: "personal_auto",
      premium_annual: res.body.premium.annual,
      premium_monthly: res.body.premium.monthly,
      premium_semi_annual: res.body.premium.semi_annual,
      coverages: JSON.stringify(DEFAULT_COVERAGES),
      deductibles: '{"collision":500,"comprehensive":250}',
      status: "assessed",
      decline_reason: null,
      valid_until: null,
      submitted_at: res.body.assessed_at,
      risk_score: res.body.risk_score,
      risk_tier: res.body.risk_tier,
      risk_factors: row.risk_factors,
      assessed_at: res.body.assessed_at,
      bind_status: "unbound",
      bound_at: null,
      policy_id: null,
      vin: "1HGCM82633A004352",
      vehicle_year: 2021,
      vehicle_make: "Honda",
      vehicle_model: "Accord",
      driver_name: "Maria Rodriguez",
      driver_dob: "1985-05-05",
      driver_license: "TX-1234567",
      coverage_config: JSON.stringify(DEFAULT_COVERAGES),
    });
    expect(Math.abs(Date.parse(res.body.assessed_at) - before)).toBeLessThan(60_000);
  });

  test("CST-R35: date of birth and licence are stored as null when not given; the policy type is always personal_auto", async () => {
    const res = await post("/quotes/quick", { vin: "5YJ3E1EA7KF317000", client_id: "CLI-003", driver_name: "No Details", policy_type: "bop" });
    const row = await quote(res.body.quote_id);
    expect(row).toMatchObject({ driver_dob: null, driver_license: null, policy_type: "personal_auto" });
  });

  test("CST-R36: the response is 201 with vehicle, premium breakdown, risk and default coverages", async () => {
    const res = await post("/quotes/quick", QUICK);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual([
      "quote_id", "client_id", "vehicle", "premium", "risk_score", "risk_tier", "coverages", "status", "assessed_at",
    ]);
    expect(Object.keys(res.body.vehicle)).toEqual(["vin", "year", "make", "model"]);
    expect(Object.keys(res.body.premium)).toEqual(["annual", "semi_annual", "monthly"]);
    expect(res.body.coverages).toEqual(DEFAULT_COVERAGES);
    expect(res.body).toMatchObject({ client_id: "CLI-003", status: "assessed", premium: { annual: 1200, semi_annual: 624, monthly: 100 } });
    contract.check(res);
  });
});

describe("POST /quotes/{quote_id}/recalculate", () => {
  const recalc = (coverages: unknown, id = "QT-ASSESSED") => ctx.api.post(`${API}/quotes/${id}/recalculate`, coverages === undefined ? {} : { coverages });

  test("CST-R37: an unknown quote is 404", async () => {
    const res = await ctx.api.post(`${API}/quotes/QT-NOPE/recalculate`, {});
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("quote not found.");
    contract.check(res);
  });

  const limits: [string, string | number, number][] = [
    ["bodily_injury", "25/50", 0.7], ["bodily_injury", "50/100", 0.85], ["bodily_injury", "100/300", 1.0],
    ["bodily_injury", "250/500", 1.2], ["bodily_injury", "500/500", 1.35],
    ["property_damage", 25000, 0.8], ["property_damage", 50000, 1.0], ["property_damage", 100000, 1.15], ["property_damage", 250000, 1.3],
    ["property_damage", "25000", 0.8],
    ["uninsured_motorist", "25/50", 0.75], ["uninsured_motorist", "50/100", 0.9], ["uninsured_motorist", "100/300", 1.0], ["uninsured_motorist", "250/500", 1.15],
  ];
  for (const [type, limit, factor] of limits) {
    test(`CST-R37: limit ${JSON.stringify(limit)} on ${type} multiplies the premium by ${factor}`, async () => {
      const res = await recalc([{ type, limit }]);
      expect(res.status).toBe(200);
      expect(res.body.adjusted_premium.annual).toBe(cents(1000 * factor));
    });
  }

  const deductibles: [string, number | string, number][] = [
    ["collision", 250, 1.15], ["collision", 500, 1.0], ["collision", 1000, 0.85], ["collision", 2500, 0.7], ["collision", "1000", 0.85],
    ["comprehensive", 100, 1.2], ["comprehensive", 250, 1.0], ["comprehensive", 500, 0.85], ["comprehensive", 1000, 0.7],
  ];
  for (const [type, deductible, factor] of deductibles) {
    test(`CST-R37: deductible ${JSON.stringify(deductible)} on ${type} multiplies the premium by ${factor}`, async () => {
      const res = await recalc([{ type, deductible }]);
      expect(res.body.adjusted_premium.annual).toBe(cents(1000 * factor));
    });
  }

  test("CST-R37: factors multiply, and semi-annual and monthly follow from the annual amount", async () => {
    const coverages = [
      { type: "bodily_injury", limit: "250/500" },
      { type: "property_damage", limit: 100000 },
      { type: "collision", deductible: 1000 },
      { type: "comprehensive", deductible: 100 },
      { type: "uninsured_motorist", limit: "25/50" },
    ];
    const res = await recalc(coverages);
    const annual = cents(1000 * 1.2 * 1.15 * 0.85 * 1.2 * 0.75);
    expect(res.body.adjusted_premium).toEqual({ annual, semi_annual: cents(annual * 0.52), monthly: cents(annual / 12) });
    expect(res.body.coverages).toEqual(coverages);
  });

  test("CST-R37: unknown types and values contribute nothing", async () => {
    const res = await recalc([
      { type: "towing", limit: "100/300" },
      { type: "bodily_injury", limit: "1/2" },
      { type: "collision", deductible: 123 },
      { type: "collision", limit: "250" },
      { type: "bodily_injury", deductible: "25/50" },
      { type: "comprehensive" },
    ]);
    expect(res.body.adjusted_premium).toEqual({ annual: 1000, semi_annual: 520, monthly: 83.33 });
  });

  test("CST-R37: without coverages in the body the quote's stored coverages are used", async () => {
    await ctx.svc.seed({
      tables: { quotes: [quoteRow({ quote_id: "QT-STORED", coverages: [{ type: "bodily_injury", limit: "500/500" }, { type: "collision", deductible: 2500 }] })] },
    });
    const res = await ctx.api.post(`${API}/quotes/QT-STORED/recalculate`, {});
    expect(res.body.adjusted_premium.annual).toBe(cents(1000 * 1.35 * 0.7));
    expect(res.body.coverages).toEqual([{ type: "bodily_injury", limit: "500/500" }, { type: "collision", deductible: 2500 }]);
  });

  test("CST-R37: a quote without a premium is recalculated from 1200", async () => {
    const res = await recalc([{ type: "property_damage", limit: 25000 }], "QT-NOPREM");
    expect(res.status).toBe(200);
    expect(res.body.original_premium).toEqual({ annual: null, monthly: null });
    expect(res.body.adjusted_premium).toEqual({ annual: 960, semi_annual: 499.2, monthly: 80 });
    // Tolerated issue is Known gap 3 of specs/carrier-coastal.spec.md.
    contract.check(res, { allow: [/original_premium\/(annual|monthly): is null/] });
  });

  test("CST-R37: recalculating writes nothing, whatever the quote's state", async () => {
    const { diff } = await ctx.svc.changes(async () => {
      await recalc([{ type: "collision", deductible: 2500 }]);
      await recalc(undefined, "QT-BOUND");
      await recalc(undefined, "QT-RAW");
    });
    expect(diff).toEqual({});
  });

  test("CST-R38: the response has the original and adjusted premium and the coverages used", async () => {
    const res = await recalc([{ type: "collision", deductible: 250 }]);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["quote_id", "original_premium", "adjusted_premium", "coverages"]);
    expect(res.body).toEqual({
      quote_id: "QT-ASSESSED",
      original_premium: { annual: 1000, monthly: 83.33 },
      adjusted_premium: { annual: 1150, semi_annual: 598, monthly: 95.83 },
      coverages: [{ type: "collision", deductible: 250 }],
    });
    contract.check(res);
  });

  test.todo("Known gap 3: a recalculation of a quote without a premium matches RecalculateResponse (original premium is null)");
});

describe("POST /quotes/{quote_id}/bind", () => {
  const bind = (id: string, body: unknown) => post(`/quotes/${id}/bind`, body);

  test("CST-R39: effective_date is required", async () => {
    for (const body of [{}, { effective_date: null }, { effective_date: "" }, { payment_plan: "annual" }]) {
      const { result: res, diff } = await ctx.svc.changes(() => bind("QT-ASSESSED", body));
      expectError(res, 400, "VALIDATION_ERROR", { field: "effective_date", code: "required" });
      expect(res.body.details).toHaveLength(1);
      expect(diff).toEqual({});
    }
  });

  test("CST-R39: an unknown payment plan is an invalid_enum error, reported together with a missing date", async () => {
    const plan = await bind("QT-ASSESSED", { effective_date: "2026-04-01", payment_plan: "weekly" });
    expectError(plan, 400, "VALIDATION_ERROR", { field: "payment_plan", code: "invalid_enum" });
    expect(plan.body.details).toHaveLength(1);
    const both = await bind("QT-ASSESSED", { payment_plan: "quarterly" });
    expect(both.body.details.map((d: any) => [d.field, d.code])).toEqual([["effective_date", "required"], ["payment_plan", "invalid_enum"]]);
  });

  test("CST-R39: the body is validated before the quote is looked up", async () => {
    expectError(await bind("QT-NOPE", {}), 400, "VALIDATION_ERROR");
    expectError(await bind("QT-BOUND", {}), 400, "VALIDATION_ERROR");
  });

  test("CST-R39: an unknown quote is 404", async () => {
    const res = await bind("QT-NOPE", { effective_date: "2026-04-01" });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("quote not found.");
    contract.check(res);
  });

  test("CST-R39: a bound quote is 409 and nothing changes", async () => {
    const { result: res, diff } = await ctx.svc.changes(() => bind("QT-BOUND", { effective_date: "2026-04-01" }));
    expectError(res, 409, "CONFLICT");
    expect(res.body.message).toBe("Quote has already been bound.");
    contract.check(res);
    expect(diff).toEqual({});
  });

  for (const [id, status] of [["QT-RAW", "quoted"], ["QT-EXPIRED", "expired"]]) {
    test(`CST-R39: a ${status} quote must be assessed first: 400 on quote_id, without a code`, async () => {
      const { result: res, diff } = await ctx.svc.changes(() => bind(id, { effective_date: "2026-04-01" }));
      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe("VALIDATION_ERROR");
      expect(res.body.details).toEqual([
        { field: "quote_id", message: `Quote must be assessed before binding. Current status: '${status}'.` },
      ]);
      expect(diff).toEqual({});
    });
  }

  test("CST-R40: binding inserts an active policy copied from the quote and marks the quote bound", async () => {
    const before = (await ctx.svc.now()).getTime();
    const { result: res, diff } = await ctx.svc.changes(() => bind("QT-ASSESSED", { effective_date: "2026-04-01", payment_plan: "monthly" }));
    expect(res.status).toBe(200);
    const policyId: string = res.body.policy_id;
    expect(policyId).toMatch(/^POL-CSTL-\d{13}$/);
    expect(Math.abs(Number(policyId.slice("POL-CSTL-".length)) - before)).toBeLessThan(60_000);
    expect(Object.keys(diff).sort()).toEqual(["policies", "quotes"]);
    expect(diff.policies.added).toEqual([
      {
        policy_id: policyId,
        client_id: "CLI-900",
        policy_type: "personal_auto",
        effective_date: "2026-04-01",
        expiration_date: "2027-04-01",
        premium_current: 1000,
        status: "active",
        coverages: '[{"type":"bodily_injury","limit":"100/300"},{"type":"collision","deductible":500}]',
        created_at: res.body.bound_at,
        updated_at: res.body.bound_at,
      },
    ]);
    expect(diff.quotes.added).toEqual([]);
    expect(diff.quotes.changed).toHaveLength(1);
    const change = diff.quotes.changed[0];
    expect([...change.fields].sort()).toEqual(["bind_status", "bound_at", "policy_id", "status"]);
    expect(change.after).toMatchObject({ quote_id: "QT-ASSESSED", status: "bound", bind_status: "bound", bound_at: res.body.bound_at, policy_id: policyId });
    expect(res.body.bound_at).toMatch(ISO_TIME);
  });

  test("CST-R40: the expiration date is the same month and day one year later, without checking the date", async () => {
    const cases: [string, string][] = [["2026-12-31", "2027-12-31"], ["2028-02-29", "2029-02-29"], ["2026-1-5", "2027-01-05"]];
    await ctx.svc.seed({ tables: { quotes: cases.map((_, i) => quoteRow({ quote_id: `QT-DATE-${i}` })) } });
    for (const [i, [effective, expiration]] of cases.entries()) {
      const res = await bind(`QT-DATE-${i}`, { effective_date: effective });
      expect(res.status).toBe(200);
      expect([res.body.effective_date, res.body.expiration_date]).toEqual([effective, expiration]);
    }
  });

  test("CST-R40: a quote without a premium binds with premium_current 0", async () => {
    const res = await bind("QT-NOPREM", { effective_date: "2026-04-01" });
    expect(res.status).toBe(200);
    expect(res.body.premium_current).toBe(0);
    expect((await ctx.svc.table("policies")).find((p) => p.policy_id === res.body.policy_id)!.premium_current).toBe(0);
  });

  test("CST-R40: every payment plan is accepted and none changes the policy", async () => {
    const plans = ["annual", "monthly", "semi_annual", undefined];
    await ctx.svc.seed({ tables: { quotes: plans.map((_, i) => quoteRow({ quote_id: `QT-PLAN-${i}` })) } });
    for (const [i, plan] of plans.entries()) {
      const res = await bind(`QT-PLAN-${i}`, { effective_date: "2026-04-01", ...(plan ? { payment_plan: plan } : {}) });
      expect(res.status).toBe(200);
      expect(res.body.premium_current).toBe(1000);
    }
    const policies = await ctx.svc.table("policies");
    expect(policies).toHaveLength(4);
    expect(new Set(policies.map((p) => JSON.stringify({ ...p, policy_id: 0, created_at: 0, updated_at: 0 }))).size).toBe(1);
    expect(Object.keys(policies[0])).not.toContain("payment_plan");
  });

  test("CST-R41: the response is 200 with the seven documented fields", async () => {
    const res = await bind("QT-ASSESSED", { effective_date: "2026-04-01" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["quote_id", "policy_id", "bind_status", "effective_date", "expiration_date", "premium_current", "bound_at"]);
    expect(res.body).toMatchObject({ quote_id: "QT-ASSESSED", bind_status: "bound", effective_date: "2026-04-01", expiration_date: "2027-04-01", premium_current: 1000 });
    contract.check(res);
  });

  test("CST-R41: a second bind of the same quote is a conflict and creates no second policy", async () => {
    await bind("QT-ASSESSED", { effective_date: "2026-04-01" });
    const { result: res, diff } = await ctx.svc.changes(() => bind("QT-ASSESSED", { effective_date: "2026-05-01" }));
    expectError(res, 409, "CONFLICT");
    expect(diff).toEqual({});
  });

  test("CST-R2: a quote bound through the API points at an existing policy", async () => {
    const res = await bind("QT-ASSESSED", { effective_date: "2026-04-01" });
    const row = await quote("QT-ASSESSED");
    expect(row).toMatchObject({ status: "bound", bind_status: "bound", policy_id: res.body.policy_id });
    expect(row.bound_at).toBe(res.body.bound_at);
    expect((await ctx.svc.table("policies")).some((p) => p.policy_id === row.policy_id)).toBe(true);
  });

  test.todo("Known gap 1: binding an unassessed quote or sending an invalid body is 422 (the service answers 400)");
});

describe("GET /policies/{policy_id}/id-card", () => {
  test("CST-R42: an unknown policy is 404 'policy not found.'", async () => {
    const res = await ctx.api.get(`${API}/policies/POL-NOPE/id-card`);
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("policy not found.");
    contract.check(res);
  });

  test("CST-R42: an existing card is returned as stored and nothing is written", async () => {
    const { result: res, diff } = await ctx.svc.changes(() => ctx.api.get(`${API}/policies/POL-CARD/id-card`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(CARD);
    expect(diff).toEqual({});
  });

  test("CST-R42: the first read creates the card from the policy", async () => {
    const before = (await ctx.svc.now()).getTime();
    const { result: res, diff } = await ctx.svc.changes(() => spaced(() => ctx.api.get(`${API}/policies/POL-OLD/id-card`)));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["card_id", "policy_id", "card_data", "issued_at"]);
    expect(res.body.card_id).toMatch(/^IDC-POLOLD-\d{13}$/);
    expect(Math.abs(Number(res.body.card_id.split("-")[2]) - before)).toBeLessThan(60_000);
    expect(res.body.policy_id).toBe("POL-OLD");
    expect(res.body.issued_at).toMatch(ISO_TIME);
    expect(Object.keys(res.body.card_data)).toEqual([
      "carrier", "carrier_code", "policy_number", "insured_name", "policy_type", "effective_date", "expiration_date", "coverages_summary",
    ]);
    expect(res.body.card_data).toEqual({
      carrier: "Coastal Star Insurance",
      carrier_code: "CSTL",
      policy_number: "POL-OLD",
      insured_name: "CLI-900",
      policy_type: "personal_auto",
      effective_date: "2026-01-01",
      expiration_date: "2030-01-01",
      coverages_summary: [{ type: "bodily_injury", limit: "50000/100000" }, { type: "collision" }],
    });
    expect(diff).toEqual({
      id_cards: {
        added: [{ card_id: res.body.card_id, policy_id: "POL-OLD", card_data: JSON.stringify(res.body.card_data), issued_at: res.body.issued_at }],
        removed: [],
        changed: [],
      },
    });
    contract.check(res);
  });

  test("CST-R42: repeating the read returns the same card and keeps one row", async () => {
    const first = await ctx.api.get(`${API}/policies/POL-OLD/id-card`);
    await Bun.sleep(5);
    const { result: second, diff } = await ctx.svc.changes(() => ctx.api.get(`${API}/policies/POL-OLD/id-card`));
    expect(second.body).toEqual(first.body);
    expect(diff).toEqual({});
    expect((await ctx.svc.table("id_cards")).filter((c) => c.policy_id === "POL-OLD")).toHaveLength(1);
  });

  test("CST-R42: the card id uses the first eight letters and digits of the policy id; a null limit is kept", async () => {
    await ctx.svc.seed({
      tables: {
        policies: [
          policyRow({
            policy_id: "POL-PA-2025-002103",
            coverages: [{ type: "bodily_injury", limit: "50000/100000", deductible: null }, { type: "collision", limit: null, deductible: 500 }],
          }),
        ],
      },
    });
    const res = await ctx.api.get(`${API}/policies/POL-PA-2025-002103/id-card`);
    expect(res.body.card_id).toMatch(/^IDC-POLPA202-\d{13}$/);
    expect(res.body.card_data.coverages_summary).toEqual([{ type: "bodily_injury", limit: "50000/100000" }, { type: "collision", limit: null }]);
  });

  test("CST-R42: the card of a freshly bound policy reflects the bind", async () => {
    const bound = await post("/quotes/QT-ASSESSED/bind", { effective_date: "2026-04-01" });
    const res = await ctx.api.get(`${API}/policies/${bound.body.policy_id}/id-card`);
    expect(res.status).toBe(200);
    expect(res.body.card_data).toMatchObject({
      policy_number: bound.body.policy_id,
      insured_name: "CLI-900",
      effective_date: "2026-04-01",
      expiration_date: "2027-04-01",
      coverages_summary: [{ type: "bodily_injury", limit: "100/300" }, { type: "collision" }],
    });
    contract.check(res);
  });
});
