import { HTTPException } from "hono/http-exception";

export interface StateAutoMinimums {
  state: string;
  per_person_bi: number;
  per_accident_bi: number;
  property_damage: number;
  shorthand: string;
}

/**
 * 10-State Statutory Minimum Auto Liability Limits (per-person BI / per-accident BI / property damage in USD).
 * Aligned with regulatory.md §2.4 and E&O Trap #2.
 */
export const STATE_STATUTORY_MINIMUMS: Record<string, StateAutoMinimums> = {
  CA: {
    state: "CA",
    per_person_bi: 15_000,
    per_accident_bi: 30_000,
    property_damage: 5_000,
    shorthand: "15/30/5",
  },
  TX: {
    state: "TX",
    per_person_bi: 30_000,
    per_accident_bi: 60_000,
    property_damage: 25_000,
    shorthand: "30/60/25",
  },
  FL: {
    state: "FL",
    per_person_bi: 10_000,
    per_accident_bi: 20_000,
    property_damage: 10_000,
    shorthand: "10/20/10",
  },
  NY: {
    state: "NY",
    per_person_bi: 25_000,
    per_accident_bi: 50_000,
    property_damage: 10_000,
    shorthand: "25/50/10",
  },
  IL: {
    state: "IL",
    per_person_bi: 25_000,
    per_accident_bi: 50_000,
    property_damage: 20_000,
    shorthand: "25/50/20",
  },
  PA: {
    state: "PA",
    per_person_bi: 15_000,
    per_accident_bi: 30_000,
    property_damage: 5_000,
    shorthand: "15/30/5",
  },
  OH: {
    state: "OH",
    per_person_bi: 25_000,
    per_accident_bi: 50_000,
    property_damage: 25_000,
    shorthand: "25/50/25",
  },
  GA: {
    state: "GA",
    per_person_bi: 25_000,
    per_accident_bi: 50_000,
    property_damage: 25_000,
    shorthand: "25/50/25",
  },
  NC: {
    state: "NC",
    per_person_bi: 30_000,
    per_accident_bi: 60_000,
    property_damage: 25_000,
    shorthand: "30/60/25",
  },
  MI: {
    state: "MI",
    per_person_bi: 50_000,
    per_accident_bi: 100_000,
    property_damage: 10_000,
    shorthand: "50/100/10",
  },
};

export const DEFAULT_AUTO_MINIMUMS: StateAutoMinimums = {
  state: "DEFAULT",
  per_person_bi: 25_000,
  per_accident_bi: 50_000,
  property_damage: 10_000,
  shorthand: "25/50/10",
};

export const BENCHMARK_SIMULATED_TODAY = "2026-02-18";
export const PRINCIPAL_BINDING_AUTHORITY_USD = 10_000;

export function getStateAutoMinimums(state?: string | null): StateAutoMinimums {
  if (!state) return DEFAULT_AUTO_MINIMUMS;
  const normalized = state.trim().toUpperCase();
  return STATE_STATUTORY_MINIMUMS[normalized] ?? DEFAULT_AUTO_MINIMUMS;
}

function normalizeLimitNumber(val: number): number {
  if (val > 0 && val < 1000) {
    return val * 1000;
  }
  return val;
}

/**
 * Parses split-limit strings such as "30/60/25", "15000/30000", "100000/300000/50000", or "25000".
 */
export function parseSplitLimits(raw: unknown): {
  perPersonBi?: number;
  perAccidentBi?: number;
  propertyDamage?: number;
  singleLimit?: number;
} {
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    const norm = normalizeLimitNumber(raw);
    return { singleLimit: norm, perPersonBi: norm };
  }
  if (typeof raw !== "string" || !raw.trim()) {
    return {};
  }
  const parts = raw
    .split("/")
    .map((p) => Number(p.replace(/[^0-9.]/g, "")))
    .filter((n) => !Number.isNaN(n) && n > 0)
    .map(normalizeLimitNumber);

  if (parts.length === 1) {
    return { singleLimit: parts[0], perPersonBi: parts[0] };
  }
  if (parts.length === 2) {
    return { perPersonBi: parts[0], perAccidentBi: parts[1] };
  }
  if (parts.length >= 3) {
    return {
      perPersonBi: parts[0],
      perAccidentBi: parts[1],
      propertyDamage: parts[2],
    };
  }
  return {};
}

export interface StateMinimumCheckResult {
  valid: boolean;
  rule: "state_minimum_violation";
  errorCode: "E_EO_STATE_MINIMUM_VIOLATION";
  state: string;
  requiredMinimums: StateAutoMinimums;
  violations: string[];
  message: string;
}

/**
 * Validates requested coverages or endorsement coverage changes against the state's statutory auto minimums.
 */
export function validateStateMinimums(
  state: string | null | undefined,
  coveragesOrChanges: unknown,
): StateMinimumCheckResult {
  const minimums = getStateAutoMinimums(state);
  const violations: string[] = [];

  const checkCoverageItem = (item: Record<string, unknown>) => {
    const covType = String(
      item.coverage_type ?? item.type ?? item.coverage ?? "",
    ).toLowerCase();

    const perPerson =
      typeof item.per_person_limit === "number"
        ? normalizeLimitNumber(item.per_person_limit)
        : undefined;
    const perAccident =
      typeof item.per_accident_limit === "number"
        ? normalizeLimitNumber(item.per_accident_limit)
        : typeof item.per_occurrence_limit === "number"
          ? normalizeLimitNumber(item.per_occurrence_limit)
          : undefined;
    const parsedLimit = parseSplitLimits(item.limit ?? item.limits);

    if (
      covType === "bodily_injury" ||
      covType === "liability" ||
      covType === "bi" ||
      (!covType && (perPerson !== undefined || parsedLimit.perAccidentBi !== undefined))
    ) {
      const biPerson = perPerson ?? parsedLimit.perPersonBi;
      const biAccident = perAccident ?? parsedLimit.perAccidentBi;
      const pdLimit = parsedLimit.propertyDamage;

      if (biPerson !== undefined && biPerson < minimums.per_person_bi) {
        violations.push(
          `Bodily injury per-person limit ($${biPerson.toLocaleString()}) is below ${minimums.state} statutory minimum of $${minimums.per_person_bi.toLocaleString()} (${minimums.shorthand}).`,
        );
      }
      if (biAccident !== undefined && biAccident < minimums.per_accident_bi) {
        violations.push(
          `Bodily injury per-accident limit ($${biAccident.toLocaleString()}) is below ${minimums.state} statutory minimum of $${minimums.per_accident_bi.toLocaleString()} (${minimums.shorthand}).`,
        );
      }
      if (pdLimit !== undefined && pdLimit < minimums.property_damage) {
        violations.push(
          `Property damage limit ($${pdLimit.toLocaleString()}) is below ${minimums.state} statutory minimum of $${minimums.property_damage.toLocaleString()} (${minimums.shorthand}).`,
        );
      }
    } else if (covType === "property_damage" || covType === "pd") {
      const pdLimit =
        perAccident ??
        perPerson ??
        parsedLimit.singleLimit ??
        parsedLimit.propertyDamage;
      if (pdLimit !== undefined && pdLimit < minimums.property_damage) {
        violations.push(
          `Property damage limit ($${pdLimit.toLocaleString()}) is below ${minimums.state} statutory minimum of $${minimums.property_damage.toLocaleString()} (${minimums.shorthand}).`,
        );
      }
    }
  };

  if (Array.isArray(coveragesOrChanges)) {
    for (const entry of coveragesOrChanges) {
      if (entry && typeof entry === "object") {
        checkCoverageItem(entry as Record<string, unknown>);
      }
    }
  } else if (coveragesOrChanges && typeof coveragesOrChanges === "object") {
    const obj = coveragesOrChanges as Record<string, unknown>;
    checkCoverageItem(obj);
    if (obj.bodily_injury_limit !== undefined || obj.liability_limit !== undefined) {
      checkCoverageItem({
        type: "bodily_injury",
        limit: obj.bodily_injury_limit ?? obj.liability_limit,
      });
    }
    if (obj.property_damage_limit !== undefined) {
      checkCoverageItem({
        type: "property_damage",
        limit: obj.property_damage_limit,
      });
    }
    if (Array.isArray(obj.coverages)) {
      for (const entry of obj.coverages) {
        if (entry && typeof entry === "object") {
          checkCoverageItem(entry as Record<string, unknown>);
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    rule: "state_minimum_violation",
    errorCode: "E_EO_STATE_MINIMUM_VIOLATION",
    state: minimums.state,
    requiredMinimums: minimums,
    violations,
    message:
      violations[0] ??
      `Coverage limits satisfy ${minimums.state} statutory minimums (${minimums.shorthand}).`,
  };
}

export interface BackdatingCheckResult {
  valid: boolean;
  rule: "backdating";
  errorCode: "E_EO_BACKDATING_PROHIBITED";
  effectiveDate: string;
  minimumAllowedDate: string;
  message: string;
}

/**
 * Validates that an endorsement or coverage effective_date is not backdated prior to the reference date.
 */
export function validateBackdating(
  effectiveDate: string,
  referenceDate: string = BENCHMARK_SIMULATED_TODAY,
): BackdatingCheckResult {
  const valid = effectiveDate >= referenceDate;
  return {
    valid,
    rule: "backdating",
    errorCode: "E_EO_BACKDATING_PROHIBITED",
    effectiveDate,
    minimumAllowedDate: referenceDate,
    message: valid
      ? `Effective date ${effectiveDate} is on or after ${referenceDate}.`
      : `E&O Firewall: Retroactive coverage backdating to ${effectiveDate} (prior to ${referenceDate}) is prohibited without Principal Underwriter approval.`,
  };
}

export interface BindingAuthorityCheckResult {
  valid: boolean;
  rule: "premium_threshold";
  errorCode: "E_EO_PREMIUM_THRESHOLD_EXCEEDED";
  premiumAnnual: number;
  thresholdUsd: number;
  message: string;
}

/**
 * Validates whether an annual premium exceeds the $10,000 agency binding authority threshold.
 */
export function validateBindingAuthority(
  premiumAnnual: number | null | undefined,
  thresholdUsd: number = PRINCIPAL_BINDING_AUTHORITY_USD,
): BindingAuthorityCheckResult {
  const amount = premiumAnnual ?? 0;
  const valid = amount <= thresholdUsd;
  return {
    valid,
    rule: "premium_threshold",
    errorCode: "E_EO_PREMIUM_THRESHOLD_EXCEEDED",
    premiumAnnual: amount,
    thresholdUsd,
    message: valid
      ? `Annual premium $${amount.toFixed(2)} is within the $${thresholdUsd.toLocaleString()} binding authority.`
      : `Premium of $${amount.toFixed(2)} exceeds the $${thresholdUsd.toLocaleString()} threshold requiring manager approval.`,
  };
}

export function eoFirewallError(
  errorCode:
    | "E_EO_BACKDATING_PROHIBITED"
    | "E_EO_STATE_MINIMUM_VIOLATION"
    | "E_EO_PREMIUM_THRESHOLD_EXCEEDED",
  message: string,
  field = "effective_date",
): HTTPException {
  const body = {
    error_code: errorCode,
    message,
    details: [{ field, message, code: errorCode }],
  };
  return new HTTPException(422, {
    message,
    res: new Response(JSON.stringify(body), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    }),
  });
}
