import { describe, expect, test } from "bun:test";
import {
  STATE_STATUTORY_MINIMUMS,
  validateStateMinimums,
  validateBackdating,
  validateBindingAuthority,
} from "../compliance-firewall";

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
    const backdated = validateBackdating("2026-02-10", "2026-02-18");
    expect(backdated.valid).toBe(false);
    expect(backdated.errorCode).toBe("E_EO_BACKDATING_PROHIBITED");

    const prospective = validateBackdating("2026-03-01", "2026-02-18");
    expect(prospective.valid).toBe(true);
  });

  test("validateBindingAuthority flags annual premiums above $10,000", () => {
    expect(validateBindingAuthority(9500).valid).toBe(true);
    expect(validateBindingAuthority(10000).valid).toBe(true);
    const over = validateBindingAuthority(14800);
    expect(over.valid).toBe(false);
    expect(over.errorCode).toBe("E_EO_PREMIUM_THRESHOLD_EXCEEDED");
  });
});
