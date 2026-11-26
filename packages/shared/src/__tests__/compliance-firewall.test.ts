import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AUTO_MINIMUMS,
  STATE_STATUTORY_MINIMUMS,
  validateStateMinimums,
  validateBackdating,
  validateBindingAuthority,
} from "../compliance-firewall";
import { isValidCalendarDate } from "../validation";

describe("Service-Layer E&O & 10-State Statutory Compliance Firewall", () => {
  test("defines statutory auto liability minimums for all 10 benchmark states", () => {
    const expectedStates = ["CA", "TX", "FL", "NY", "IL", "PA", "OH", "GA", "NC", "MI"];
    for (const st of expectedStates) {
      expect(STATE_STATUTORY_MINIMUMS[st]).toBeDefined();
    }
    expect(STATE_STATUTORY_MINIMUMS.TX.shorthand).toBe("30/60/25");
    expect(STATE_STATUTORY_MINIMUMS.CA.shorthand).toBe("30/60/15");
    expect(STATE_STATUTORY_MINIMUMS.NC.shorthand).toBe("50/100/50");
    expect(STATE_STATUTORY_MINIMUMS.MI.shorthand).toBe("50/100/10");
  });

  test("validateStateMinimums catches TX 15/30/10 and MI 25/50/10 violations while allowing compliant limits", () => {
    const txFail = validateStateMinimums("TX", [
      { type: "bodily_injury", limit: "15/30/10" },
    ]);
    expect(txFail.valid).toBe(false);
    expect(txFail.errorCode).toBe("E_EO_STATE_MINIMUM_VIOLATION");

    const txPass = validateStateMinimums("TX", [
      { type: "bodily_injury", limit: "30/60/25" },
    ]);
    expect(txPass.valid).toBe(true);

    const caPass = validateStateMinimums("CA", [
      { type: "bodily_injury", limit: "30/60/15" },
    ]);
    expect(caPass.valid).toBe(true);

    const miFail = validateStateMinimums("MI", [
      { coverage_type: "bodily_injury", per_person_limit: 25000, per_accident_limit: 50000 },
    ]);
    expect(miFail.valid).toBe(false);
  });

  test("validateStateMinimums rejects the pre-2025 CA and NC floors that are now illegal", () => {
    const caOldFloor = validateStateMinimums("CA", [
      { type: "bodily_injury", limit: "15/30/5" },
    ]);
    expect(caOldFloor.valid).toBe(false);
    expect(caOldFloor.errorCode).toBe("E_EO_STATE_MINIMUM_VIOLATION");

    const ncOldFloor = validateStateMinimums("NC", [
      { type: "bodily_injury", limit: "30/60/25" },
    ]);
    expect(ncOldFloor.valid).toBe(false);

    const ncPass = validateStateMinimums("NC", [
      { type: "bodily_injury", limit: "50/100/50" },
    ]);
    expect(ncPass.valid).toBe(true);
  });

  test("validateBackdating rejects retroactive effective dates prior to reference date", () => {
    const backdated = validateBackdating("2026-10-05", "2026-10-14");
    expect(backdated.valid).toBe(false);
    expect(backdated.errorCode).toBe("E_EO_BACKDATING_PROHIBITED");

    const prospective = validateBackdating("2026-11-01", "2026-10-14");
    expect(prospective.valid).toBe(true);
  });

  test("validateBindingAuthority flags annual premiums above $10,000", () => {
    expect(validateBindingAuthority(9500).valid).toBe(true);
    expect(validateBindingAuthority(10000).valid).toBe(true);
    const over = validateBindingAuthority(14800);
    expect(over.valid).toBe(false);
    expect(over.errorCode).toBe("E_EO_PREMIUM_THRESHOLD_EXCEEDED");
  });

  test("state minimum survives re-spelling and string limits", () => {
    // Re-spelled coverage types and numeric strings must be caught
    expect(
      validateStateMinimums("TX", [
        { type: "bodily_injury_liability", limit: "15/30/10" },
      ]).valid,
    ).toBe(false);
    expect(
      validateStateMinimums("CA", [
        { coverage_type: "auto-liability", per_person_limit: "15000", per_accident_limit: "30000" },
      ]).valid,
    ).toBe(false);
    expect(
      validateStateMinimums("TX", [
        { type: "property_damage_liability", limit: "15000" },
      ]).valid,
    ).toBe(false);

    // Nested endorsement changes shapes must be caught recursively
    expect(
      validateStateMinimums("TX", {
        auto: { new_limits: { bodily_injury: "15/30/10" } },
      }).valid,
    ).toBe(false);
    expect(
      validateStateMinimums("NC", {
        endorsement_payload: {
          bodily_injury: { per_person_limit: "30000", per_accident_limit: "60000" },
        },
      }).valid,
    ).toBe(false);

    // Million/thousand suffixes parse accurately ("1M/1M/1M" is $1,000,000, not $1,000)
    expect(
      validateStateMinimums("NC", [
        { type: "bodily_injury_liability", limit: "1M/1M/1M" },
      ]).valid,
    ).toBe(true);
    expect(
      validateStateMinimums("MI", [
        { type: "bodily_injury", limit: "50k/100k/25k" },
      ]).valid,
    ).toBe(true);
    // Zero-limit, nested limits object, new_limit alias, and bi_pd bypasses
    expect(validateStateMinimums("CA", [{ type: "bodily_injury", limit: "0/0/0" }]).valid).toBe(false);
    expect(validateStateMinimums("CA", [{ type: "bodily_injury", limit: "30/60/0" }]).valid).toBe(false);
    expect(validateStateMinimums("CA", [{ type: "bodily_injury", limit: "0/60/60" }]).valid).toBe(false);
    expect(validateStateMinimums("CA", [{ type: "property_damage", limit: "0" }]).valid).toBe(false);
    expect(
      validateStateMinimums("CA", [
        { type: "bodily_injury", limits: { per_person: 10000, per_accident: 20000 } },
      ]).valid,
    ).toBe(false);
    expect(
      validateStateMinimums("CA", { limits: { bodily_injury: "10/20/5" } }).valid,
    ).toBe(false);
    expect(
      validateStateMinimums("CA", { coverage: "bodily_injury", new_limit: "10/20/5" }).valid,
    ).toBe(false);
    expect(validateStateMinimums("CA", [{ type: "bi_pd", limit: "10/20/5" }]).valid).toBe(false);
    expect(
      validateStateMinimums("CA", [{ type: "bodily_injury", per_person_limit: 0 }]).valid,
    ).toBe(false);
  });

  test("every state minimum and boundary", () => {
    // Independent ground-truth 2026-10-14 statutory auto minimums (never read from STATE_STATUTORY_MINIMUMS)
    const expectedMatrix: Array<[string, number, number, number]> = [
      ["CA", 30_000, 60_000, 15_000],
      ["TX", 30_000, 60_000, 25_000],
      ["FL", 10_000, 20_000, 10_000],
      ["NY", 25_000, 50_000, 10_000],
      ["IL", 25_000, 50_000, 20_000],
      ["PA", 15_000, 30_000, 5_000],
      ["OH", 25_000, 50_000, 25_000],
      ["GA", 25_000, 50_000, 25_000],
      ["NC", 50_000, 100_000, 50_000],
      ["MI", 50_000, 100_000, 10_000],
      ["WA", 25_000, 50_000, 10_000], // DEFAULT_AUTO_MINIMUMS
    ];
    for (const [st, biPer, biAcc, pd] of expectedMatrix) {
      // Exact floor passes
      expect(
        validateStateMinimums(st, [
          {
            type: "bodily_injury",
            limit: `${biPer}/${biAcc}/${pd}`,
          },
        ]).valid,
      ).toBe(true);

      // $1 below each component fails
      expect(
        validateStateMinimums(st, [
          {
            type: "bodily_injury",
            limit: `${biPer - 1}/${biAcc}/${pd}`,
          },
        ]).valid,
      ).toBe(false);
      expect(
        validateStateMinimums(st, [
          {
            type: "bodily_injury",
            limit: `${biPer}/${biAcc - 1}/${pd}`,
          },
        ]).valid,
      ).toBe(false);
      expect(
        validateStateMinimums(st, [
          {
            type: "bodily_injury",
            limit: `${biPer}/${biAcc}/${pd - 1}`,
          },
        ]).valid,
      ).toBe(false);
    }

    // Backdating exact boundary + invalid calendar dates
    expect(validateBackdating("2026-10-14", "2026-10-14").valid).toBe(true);
    expect(validateBackdating("2026-10-13", "2026-10-14").valid).toBe(false);
    expect(validateBackdating("2026-13-45", "2026-10-14").valid).toBe(false);
    expect(validateBackdating("2026-02-29", "2026-01-01").valid).toBe(false);
    expect(isValidCalendarDate("2028-02-29")).toBe(true);
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
    expect(isValidCalendarDate("2026-13-45")).toBe(false);
  });
});
