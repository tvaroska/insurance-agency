import { HTTPException } from "hono/http-exception";
import { isValidCalendarDate } from "./validation";

export interface StateAutoMinimums {
  state: string;
  per_person_bi: number;
  per_accident_bi: number;
  property_damage: number;
  shorthand: string;
}

/**
 * 10-State Statutory Minimum Auto Liability Limits (per-person BI / per-accident BI / property damage in USD).
 * Values are the minimums in force on BENCHMARK_SIMULATED_TODAY (2026-10-14). California rose from 15/30/5 to
 * 30/60/15 on 2025-01-01 (SB 1107) and North Carolina from 30/60/25 to 50/100/50 on 2025-07-01.
 * Mirrored in regulatory.md (State Minimum Auto Liability Limits) and enforced for E&O Trap #2.
 */
export const STATE_STATUTORY_MINIMUMS: Record<string, StateAutoMinimums> = {
  CA: {
    state: "CA",
    per_person_bi: 30_000,
    per_accident_bi: 60_000,
    property_damage: 15_000,
    shorthand: "30/60/15",
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
    per_person_bi: 50_000,
    per_accident_bi: 100_000,
    property_damage: 50_000,
    shorthand: "50/100/50",
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

export const ESCALATION_REASONS = [
  "premium_threshold",
  "state_minimum_violation",
  "coverage_adequacy",
  "surplus_lines",
  "principal_review",
  "backdating",
  "attorney_involvement",
  "claims_specialist",
  "claim_specialist",
] as const;

export const BENCHMARK_SIMULATED_TODAY = "2026-10-14";
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

function parseSingleLimitPart(rawPart: string): number | undefined {
  const trimmed = rawPart.trim();
  if (!trimmed) return undefined;
  const suffixMatch = trimmed.match(/(million|mil|m|thousand|k)\s*$/i);
  const suffix = suffixMatch?.[1]?.toLowerCase();
  const numericText = (suffixMatch ? trimmed.slice(0, suffixMatch.index) : trimmed).replace(
    /[^0-9.-]/g,
    "",
  );
  if (!numericText) return undefined;
  const num = Number(numericText);
  if (Number.isNaN(num) || num < 0) return undefined;
  if (suffix === "m" || suffix === "mil" || suffix === "million") {
    return num * 1_000_000;
  }
  if (suffix === "k" || suffix === "thousand") {
    return num * 1_000;
  }
  return normalizeLimitNumber(num);
}

function parseScalarLimit(raw: unknown): number | undefined {
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    return raw >= 0 ? normalizeLimitNumber(raw) : undefined;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes("/")) return undefined;
    return parseSingleLimitPart(trimmed);
  }
  return undefined;
}

/**
 * Parses split-limit strings such as "30/60/25", "15000/30000", "1M/1M/1M", or "25000".
 * Per AMS-R86 / RTR-R43, positive amounts under 1,000 are interpreted as thousands of dollars.
 */
export function parseSplitLimits(raw: unknown): {
  perPersonBi?: number;
  perAccidentBi?: number;
  propertyDamage?: number;
  singleLimit?: number;
} {
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    if (raw < 0) return {};
    const norm = normalizeLimitNumber(raw);
    return { singleLimit: norm, perPersonBi: norm };
  }
  if (typeof raw !== "string" || !raw.trim()) {
    return {};
  }
  const parts = raw
    .split("/")
    .map(parseSingleLimitPart)
    .filter((n): n is number => n !== undefined && n >= 0);

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

const BODILY_INJURY_KINDS = new Set([
  "bodily_injury",
  "bodily_injury_liability",
  "bi",
  "bi_liability",
  "bi_pd",
  "bi_and_pd",
  "liability",
  "auto_liability",
  "bodily_injury_and_property_damage",
  "bipd",
  "split_limit",
  "split_limits",
  "combined_single_limit",
  "csl",
]);

const PROPERTY_DAMAGE_KINDS = new Set([
  "property_damage",
  "property_damage_liability",
  "pd",
  "pd_liability",
  "auto_property_damage",
]);

const BI_SHORTCUT_KEYS = new Set([
  "bodily_injury_limit",
  "bodily_injury_limits",
  "bodily_injury",
  "bodily_injury_liability",
  "bi_limit",
  "bi_limits",
  "bi",
  "liability_limit",
  "liability_limits",
  "auto_liability",
  "auto_liability_limit",
]);

const PD_SHORTCUT_KEYS = new Set([
  "property_damage_limit",
  "property_damage_limits",
  "property_damage",
  "property_damage_liability",
  "pd_limit",
  "pd_limits",
  "pd",
]);

function normalizeCoverageKind(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_")
    .replace(/_+/g, "_");
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

  const checkCoverageItem = (item: Record<string, unknown>, fallbackKind = ""): string => {
    const rawKind = item.coverage_type ?? item.type ?? item.coverage;
    const covType = normalizeCoverageKind(rawKind) || fallbackKind;

    const perPerson = parseScalarLimit(item.per_person_limit ?? item.per_person);
    const perAccident =
      parseScalarLimit(item.per_accident_limit ?? item.per_accident) ??
      parseScalarLimit(item.per_occurrence_limit ?? item.per_occurrence);
    const explicitPd = parseScalarLimit(item.property_damage_limit);
    const rawLimitVal = item.limit ?? item.limits ?? item.new_limit ?? item.new_limits;
    const parsedLimit = parseSplitLimits(rawLimitVal);

    if (
      BODILY_INJURY_KINDS.has(covType) ||
      (!covType && (perPerson !== undefined || parsedLimit.perAccidentBi !== undefined))
    ) {
      const isCombinedSingleLimit =
        covType === "csl" || covType === "combined_single_limit";
      const biPerson = perPerson ?? parsedLimit.perPersonBi;
      const biAccident =
        perAccident ??
        parsedLimit.perAccidentBi ??
        (isCombinedSingleLimit ? parsedLimit.singleLimit : undefined);
      const pdLimit = explicitPd ?? parsedLimit.propertyDamage;

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
    } else if (PROPERTY_DAMAGE_KINDS.has(covType)) {
      const pdLimit =
        explicitPd ??
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
    return covType;
  };

  const visited = new Set<object>();
  const walkNode = (node: unknown, depth: number, inheritedKind = ""): void => {
    if (depth > 8 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const entry of node) {
        walkNode(entry, depth + 1, inheritedKind);
      }
      return;
    }
    if (typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);

    const obj = node as Record<string, unknown>;
    const explicitKind = normalizeCoverageKind(obj.coverage_type ?? obj.type ?? obj.coverage);
    checkCoverageItem(obj, inheritedKind);

    // Do not recurse into explicitly non-liability coverage items (e.g. collision/UM).
    if (
      explicitKind &&
      !BODILY_INJURY_KINDS.has(explicitKind) &&
      !PROPERTY_DAMAGE_KINDS.has(explicitKind)
    ) {
      return;
    }

    for (const [rawKey, val] of Object.entries(obj)) {
      if (val === null || val === undefined) continue;
      if (
        rawKey === "per_person_limit" ||
        rawKey === "per_person" ||
        rawKey === "per_accident_limit" ||
        rawKey === "per_accident" ||
        rawKey === "per_occurrence_limit" ||
        rawKey === "per_occurrence"
      ) {
        continue;
      }
      if (
        rawKey === "limit" ||
        rawKey === "limits" ||
        rawKey === "new_limit" ||
        rawKey === "new_limits"
      ) {
        if (typeof val === "object") {
          walkNode(val, depth + 1, explicitKind || inheritedKind);
        }
        continue;
      }
      const normKey = normalizeCoverageKind(rawKey);
      if (BI_SHORTCUT_KEYS.has(normKey)) {
        if (typeof val === "string" || typeof val === "number") {
          checkCoverageItem({ type: "bodily_injury", limit: val });
        } else {
          walkNode(val, depth + 1, "bodily_injury");
        }
      } else if (PD_SHORTCUT_KEYS.has(normKey)) {
        if (typeof val === "string" || typeof val === "number") {
          checkCoverageItem({ type: "property_damage", limit: val });
        } else {
          walkNode(val, depth + 1, "property_damage");
        }
      } else if (typeof val === "object") {
        walkNode(val, depth + 1, "");
      }
    }
  };

  walkNode(coveragesOrChanges, 0);

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
  const floor = referenceDate && referenceDate.trim() ? referenceDate.trim() : BENCHMARK_SIMULATED_TODAY;
  const calendarOk = isValidCalendarDate(effectiveDate);
  const valid = calendarOk && effectiveDate >= floor;
  return {
    valid,
    rule: "backdating",
    errorCode: "E_EO_BACKDATING_PROHIBITED",
    effectiveDate,
    minimumAllowedDate: floor,
    message: valid
      ? `Effective date ${effectiveDate} is on or after ${floor}.`
      : !calendarOk
        ? `Effective date ${effectiveDate} is not a valid YYYY-MM-DD calendar date.`
        : `E&O Firewall: Retroactive coverage backdating to ${effectiveDate} (prior to ${floor}) is prohibited without Principal Underwriter approval.`,
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
