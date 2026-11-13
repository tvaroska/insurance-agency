/**
 * Pure 32-table DB state-contract evaluator for deterministic multi-turn scenarios.
 *
 * Evaluates a pre/post `StateDiffResult` directly against a declarative closed-world
 * contract (`must_insert`, `must_update`, `must_delete`, `allowed_extras`, and
 * `strict_no_unexpected_writes`), with zero OTLP trace regexes and zero LLM judge calls.
 */

import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { parse as parseYaml } from "yaml";
import type { GymSnapshot, RowUpdateDiff, StateDiffResult } from "../types";
import {
  diffSnapshots,
  extractRowKey,
  isEnvironmentGeneratedRow,
} from "./state-diff";
import { defaultBaseUrls, scorerHeaders } from "./output";

export const CANONICAL_SERVICE_TABLES: Record<string, readonly string[]> = {
  ams: [
    "clients",
    "policies",
    "coverages",
    "endorsements",
    "commissions",
    "tasks",
    "escalations",
    "escalation_events",
  ],
  rater: ["quote_requests", "carrier_quotes", "carriers"],
  crm: ["leads", "campaigns", "campaign_enrollments", "retention_risks"],
  ecm: ["documents", "envelopes", "marketing_assets"],
  comm: ["messages", "webhooks", "webhook_deliveries"],
  "carrier-summit": [
    "quotes",
    "policies",
    "policy_documents",
    "underwriting_conditions",
  ],
  "carrier-coastal": ["quotes", "policies", "id_cards"],
  claims: ["adjusters", "claims", "claim_documents", "claim_timeline"],
};

export const SERVICE_URL_KEY_MAP: Record<string, string> = {
  ams: "ams",
  rater: "rater",
  crm: "crm",
  ecm: "ecm",
  comm: "comm",
  "carrier-summit": "summit-fire",
  "summit-fire": "summit-fire",
  "carrier-coastal": "coastal-star",
  "coastal-star": "coastal-star",
  claims: "claims",
};

export type StartStateBase = "empty" | "clean" | "realistic";

export interface FieldMatcherObject {
  equals?: unknown;
  oneOf?: unknown[];
  contains?: string;
  containsAll?: string[];
  regex?: string;
  caseSensitive?: boolean;
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
  present?: boolean;
  jsonMatch?: Record<string, FieldMatcher>;
  anyOf?: FieldMatcher[];
}

export type FieldMatcher =
  | string
  | number
  | boolean
  | null
  | FieldMatcherObject;

export interface InsertExpectation {
  label?: string;
  service: string;
  table: string;
  where: Record<string, FieldMatcher>;
}

export interface UpdateExpectation {
  label?: string;
  service: string;
  table: string;
  key?: string;
  before_where?: Record<string, FieldMatcher>;
  after: Record<string, FieldMatcher>;
  unchanged_fields?: string[];
  only_changed_fields?: string[];
}

export interface DeleteExpectation {
  label?: string;
  service: string;
  table: string;
  key?: string;
  where?: Record<string, FieldMatcher>;
}

export interface AllowedExtraRule {
  service: string;
  table: string;
  op?: "insert" | "update" | "delete" | "any";
  where?: Record<string, FieldMatcher>;
  max_count?: number;
  reason?: string;
}

export interface StateContract {
  must_insert?: InsertExpectation[];
  must_update?: UpdateExpectation[];
  must_delete?: DeleteExpectation[];
  allowed_extras?: AllowedExtraRule[];
  strict_no_unexpected_writes?: boolean;
}

export interface StateScenarioTurn {
  role: "client";
  message: string;
}

export interface StateScenarioDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  services: string[];
  start_state: {
    base: StartStateBase;
    tables?: Record<string, Record<string, Record<string, unknown>[]>>;
  };
  turns: StateScenarioTurn[];
  expected_diff: StateContract;
}

export interface MatchedMutation {
  label: string;
  service: string;
  table: string;
  op: "insert" | "update" | "delete";
  key: string;
}

export interface MissingExpectation {
  label: string;
  service: string;
  table: string;
  op: "insert" | "update" | "delete";
  detail: string;
}

export interface UnexpectedWrite {
  service: string;
  table: string;
  op: "insert" | "update" | "delete";
  key: string;
  changedFields?: string[];
  row: Record<string, unknown>;
  reason: string;
}

export interface AllowedExtraUsage {
  service: string;
  table: string;
  op: "insert" | "update" | "delete";
  key: string;
  reason?: string;
}

export const SYSTEM_AUDIT_TABLES = new Set([
  "ams.escalation_events",
  "claims.claim_timeline",
]);

export interface StateContractResult {
  passed: boolean;
  score: 0 | 1;
  matchedInserts: MatchedMutation[];
  missingInserts: MissingExpectation[];
  matchedUpdates: MatchedMutation[];
  missingUpdates: MissingExpectation[];
  matchedDeletes: MatchedMutation[];
  missingDeletes: MissingExpectation[];
  unexpectedWrites: UnexpectedWrite[];
  allowedExtrasUsed: AllowedExtraUsage[];
  extraGovernanceWrites: number;
  systemAuditWrites: number;
  diffSummary: StateDiffResult["summary"];
  summary: string;
}

// ── Service name normalization ──────────────────────────────────────

function canonicalServiceName(service: string): string {
  if (service === "summit-fire") return "carrier-summit";
  if (service === "coastal-star") return "carrier-coastal";
  return service;
}

function diffServiceKey(diff: StateDiffResult, service: string): string {
  if (diff.services[service]) return service;
  const mapped = SERVICE_URL_KEY_MAP[service];
  if (mapped && diff.services[mapped]) return mapped;
  const canonical = canonicalServiceName(service);
  if (diff.services[canonical]) return canonical;
  return service;
}

// ── Field matching ──────────────────────────────────────────────────

const MATCHER_KEYS = new Set([
  "equals",
  "oneOf",
  "contains",
  "containsAll",
  "regex",
  "caseSensitive",
  "gte",
  "lte",
  "gt",
  "lt",
  "present",
  "jsonMatch",
  "anyOf",
]);

function isMatcherObject(matcher: FieldMatcher): matcher is FieldMatcherObject {
  if (matcher === null || typeof matcher !== "object" || Array.isArray(matcher)) {
    return false;
  }
  const keys = Object.keys(matcher);
  return keys.length > 0 && keys.every((k) => MATCHER_KEYS.has(k));
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return null;
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || expected === null || actual === undefined || expected === undefined) {
    return false;
  }
  if (typeof actual === "object" && typeof expected === "object") {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  return false;
}

export function matchFieldValue(actual: unknown, matcher: FieldMatcher): boolean {
  if (!isMatcherObject(matcher)) {
    return valuesEqual(actual, matcher);
  }

  if (matcher.anyOf !== undefined) {
    if (!matcher.anyOf.some((sub) => matchFieldValue(actual, sub))) {
      return false;
    }
  }

  if (matcher.equals !== undefined) {
    if (!valuesEqual(actual, matcher.equals)) return false;
  }

  if (matcher.oneOf !== undefined) {
    if (!matcher.oneOf.some((v) => valuesEqual(actual, v))) return false;
  }

  if (matcher.present !== undefined) {
    const isPresent =
      actual !== null &&
      actual !== undefined &&
      !(typeof actual === "string" && actual.trim() === "");
    if (isPresent !== matcher.present) return false;
  }

  if (matcher.contains !== undefined) {
    const text = toStringValue(actual);
    if (text === null) return false;
    const hay = matcher.caseSensitive ? text : text.toLowerCase();
    const needle = matcher.caseSensitive
      ? matcher.contains
      : matcher.contains.toLowerCase();
    if (!hay.includes(needle)) return false;
  }

  if (matcher.containsAll !== undefined) {
    const text = toStringValue(actual);
    if (text === null) return false;
    const hay = matcher.caseSensitive ? text : text.toLowerCase();
    for (const part of matcher.containsAll) {
      const needle = matcher.caseSensitive ? part : part.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
  }

  if (matcher.regex !== undefined) {
    const text = toStringValue(actual);
    if (text === null) return false;
    const re = new RegExp(matcher.regex, matcher.caseSensitive ? "" : "i");
    if (!re.test(text)) return false;
  }

  if (
    matcher.gte !== undefined ||
    matcher.lte !== undefined ||
    matcher.gt !== undefined ||
    matcher.lt !== undefined
  ) {
    const num = typeof actual === "number" ? actual : Number(actual);
    if (typeof actual === "boolean" || actual === null || actual === undefined || Number.isNaN(num)) {
      return false;
    }
    if (matcher.gte !== undefined && num < matcher.gte) return false;
    if (matcher.lte !== undefined && num > matcher.lte) return false;
    if (matcher.gt !== undefined && num <= matcher.gt) return false;
    if (matcher.lt !== undefined && num >= matcher.lt) return false;
  }

  if (matcher.jsonMatch !== undefined) {
    let parsed: unknown = actual;
    if (typeof actual === "string") {
      try {
        parsed = JSON.parse(actual);
      } catch {
        return false;
      }
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    if (!matchRow(parsed as Record<string, unknown>, matcher.jsonMatch)) {
      return false;
    }
  }

  return true;
}

export function matchRow(
  row: Record<string, unknown>,
  where: Record<string, FieldMatcher>,
): boolean {
  for (const [field, matcher] of Object.entries(where)) {
    if (!matchFieldValue(row[field], matcher)) {
      return false;
    }
  }
  return true;
}

// ── Exact 1-to-1 bipartite matching (Kuhn's algorithm) ──────────────

function matchOneToOne(adjacency: number[][]): Map<number, number> {
  const rowToExpectation = new Map<number, number>();

  function tryAugment(expIdx: number, visitedRows: Set<number>): boolean {
    for (const rowIdx of adjacency[expIdx]) {
      if (visitedRows.has(rowIdx)) continue;
      visitedRows.add(rowIdx);
      const currentExp = rowToExpectation.get(rowIdx);
      if (currentExp === undefined || tryAugment(currentExp, visitedRows)) {
        rowToExpectation.set(rowIdx, expIdx);
        return true;
      }
    }
    return false;
  }

  for (let expIdx = 0; expIdx < adjacency.length; expIdx++) {
    tryAugment(expIdx, new Set<number>());
  }

  const expToRow = new Map<number, number>();
  for (const [rowIdx, expIdx] of rowToExpectation.entries()) {
    expToRow.set(expIdx, rowIdx);
  }
  return expToRow;
}

// ── Contract evaluation ─────────────────────────────────────────────

const IGNORED_UPDATE_FIELDS = new Set(["updated_at"]);

function matchesUpdateExpectation(
  update: RowUpdateDiff,
  exp: UpdateExpectation,
): boolean {
  if (exp.key !== undefined && update.key !== exp.key) {
    return false;
  }
  if (exp.before_where && !matchRow(update.before, exp.before_where)) {
    return false;
  }
  if (!matchRow(update.after, exp.after)) {
    return false;
  }
  if (exp.unchanged_fields) {
    for (const field of exp.unchanged_fields) {
      if (update.changedFields.includes(field)) {
        return false;
      }
    }
  }
  if (exp.only_changed_fields) {
    const allowed = new Set([...exp.only_changed_fields, ...IGNORED_UPDATE_FIELDS]);
    for (const changed of update.changedFields) {
      if (!allowed.has(changed)) {
        return false;
      }
    }
  }
  return true;
}

export function evaluateStateContract(
  diff: StateDiffResult,
  contract: StateContract,
): StateContractResult {
  const mustInsert = contract.must_insert ?? [];
  const mustUpdate = contract.must_update ?? [];
  const mustDelete = contract.must_delete ?? [];
  const allowedExtras = contract.allowed_extras ?? [];
  const strict = contract.strict_no_unexpected_writes ?? true;

  const matchedInserts: MatchedMutation[] = [];
  const missingInserts: MissingExpectation[] = [];
  const matchedUpdates: MatchedMutation[] = [];
  const missingUpdates: MissingExpectation[] = [];
  const matchedDeletes: MatchedMutation[] = [];
  const missingDeletes: MissingExpectation[] = [];

  const consumedInserts = new Set<string>();
  const consumedUpdates = new Set<string>();
  const consumedDeletes = new Set<string>();

  // 1. Evaluate must_insert grouped by (diffService, table) with exact 1-to-1 matching
  const insertGroups = new Map<string, Array<{ exp: InsertExpectation; idx: number }>>();
  mustInsert.forEach((exp, idx) => {
    const svcKey = diffServiceKey(diff, exp.service);
    const groupKey = `${svcKey}::${exp.table}`;
    const list = insertGroups.get(groupKey) ?? [];
    list.push({ exp, idx });
    insertGroups.set(groupKey, list);
  });

  for (const [groupKey, group] of insertGroups.entries()) {
    const [svcKey, table] = groupKey.split("::");
    const rows = (diff.services[svcKey]?.[table]?.inserted ?? []).filter(
      (r) => !isEnvironmentGeneratedRow(r, table),
    );
    const adjacency = group.map(({ exp }) => {
      const candidates: number[] = [];
      rows.forEach((row, rowIdx) => {
        if (matchRow(row, exp.where)) candidates.push(rowIdx);
      });
      return candidates;
    });
    const assignment = matchOneToOne(adjacency);
    group.forEach(({ exp }, localIdx) => {
      const label = exp.label ?? `${exp.service}.${exp.table} insert`;
      const matchedRowIdx = assignment.get(localIdx);
      if (matchedRowIdx !== undefined) {
        const row = rows[matchedRowIdx];
        const key = extractRowKey(row, table);
        consumedInserts.add(`${svcKey}::${table}::${matchedRowIdx}`);
        matchedInserts.push({
          label,
          service: exp.service,
          table: exp.table,
          op: "insert",
          key,
        });
      } else {
        missingInserts.push({
          label,
          service: exp.service,
          table: exp.table,
          op: "insert",
          detail: `No unmatched inserted row in ${exp.service}.${exp.table} matched ${JSON.stringify(exp.where)} (saw ${rows.length} inserted row(s))`,
        });
      }
    });
  }

  // 2. Evaluate must_update grouped by (diffService, table) with exact 1-to-1 matching
  const updateGroups = new Map<string, Array<{ exp: UpdateExpectation; idx: number }>>();
  mustUpdate.forEach((exp, idx) => {
    const svcKey = diffServiceKey(diff, exp.service);
    const groupKey = `${svcKey}::${exp.table}`;
    const list = updateGroups.get(groupKey) ?? [];
    list.push({ exp, idx });
    updateGroups.set(groupKey, list);
  });

  for (const [groupKey, group] of updateGroups.entries()) {
    const [svcKey, table] = groupKey.split("::");
    const rows = diff.services[svcKey]?.[table]?.updated ?? [];
    const adjacency = group.map(({ exp }) => {
      const candidates: number[] = [];
      rows.forEach((upd, rowIdx) => {
        if (matchesUpdateExpectation(upd, exp)) candidates.push(rowIdx);
      });
      return candidates;
    });
    const assignment = matchOneToOne(adjacency);
    group.forEach(({ exp }, localIdx) => {
      const label = exp.label ?? `${exp.service}.${exp.table} update${exp.key ? ` (${exp.key})` : ""}`;
      const matchedRowIdx = assignment.get(localIdx);
      if (matchedRowIdx !== undefined) {
        const upd = rows[matchedRowIdx];
        consumedUpdates.add(`${svcKey}::${table}::${matchedRowIdx}`);
        matchedUpdates.push({
          label,
          service: exp.service,
          table: exp.table,
          op: "update",
          key: upd.key,
        });
      } else {
        missingUpdates.push({
          label,
          service: exp.service,
          table: exp.table,
          op: "update",
          detail: `No unmatched updated row in ${exp.service}.${exp.table} matched key=${exp.key ?? "*"} after=${JSON.stringify(exp.after)} (saw ${rows.length} updated row(s))`,
        });
      }
    });
  }

  // 3. Evaluate must_delete grouped by (diffService, table) with exact 1-to-1 matching
  const deleteGroups = new Map<string, Array<{ exp: DeleteExpectation; idx: number }>>();
  mustDelete.forEach((exp, idx) => {
    const svcKey = diffServiceKey(diff, exp.service);
    const groupKey = `${svcKey}::${exp.table}`;
    const list = deleteGroups.get(groupKey) ?? [];
    list.push({ exp, idx });
    deleteGroups.set(groupKey, list);
  });

  for (const [groupKey, group] of deleteGroups.entries()) {
    const [svcKey, table] = groupKey.split("::");
    const rows = diff.services[svcKey]?.[table]?.deleted ?? [];
    const adjacency = group.map(({ exp }) => {
      const candidates: number[] = [];
      rows.forEach((row, rowIdx) => {
        if (exp.key !== undefined && extractRowKey(row, table) !== exp.key) return;
        if (exp.where && !matchRow(row, exp.where)) return;
        candidates.push(rowIdx);
      });
      return candidates;
    });
    const assignment = matchOneToOne(adjacency);
    group.forEach(({ exp }, localIdx) => {
      const label = exp.label ?? `${exp.service}.${exp.table} delete`;
      const matchedRowIdx = assignment.get(localIdx);
      if (matchedRowIdx !== undefined) {
        const key = extractRowKey(rows[matchedRowIdx], table);
        consumedDeletes.add(`${svcKey}::${table}::${matchedRowIdx}`);
        matchedDeletes.push({
          label,
          service: exp.service,
          table: exp.table,
          op: "delete",
          key,
        });
      } else {
        missingDeletes.push({
          label,
          service: exp.service,
          table: exp.table,
          op: "delete",
          detail: `No unmatched deleted row in ${exp.service}.${exp.table} matched key=${exp.key ?? "*"} where=${JSON.stringify(exp.where ?? {})}`,
        });
      }
    });
  }

  // 4. Closed-world unexpected write check across all 32 tables
  const unexpectedWrites: UnexpectedWrite[] = [];
  const allowedExtrasUsed: AllowedExtraUsage[] = [];
  const extraRuleCounts = new Map<number, number>();

  function tryAllowExtra(
    svcKey: string,
    table: string,
    op: "insert" | "update" | "delete",
    row: Record<string, unknown>,
    key: string,
  ): boolean {
    const normSvc = canonicalServiceName(svcKey);
    for (let i = 0; i < allowedExtras.length; i++) {
      const rule = allowedExtras[i];
      if (canonicalServiceName(rule.service) !== normSvc) continue;
      if (rule.table !== table) continue;
      if (rule.op && rule.op !== "any" && rule.op !== op) continue;
      if (rule.where && !matchRow(row, rule.where)) continue;
      const used = extraRuleCounts.get(i) ?? 0;
      if (rule.max_count !== undefined && used >= rule.max_count) continue;
      extraRuleCounts.set(i, used + 1);
      allowedExtrasUsed.push({
        service: svcKey,
        table,
        op,
        key,
        reason: rule.reason,
      });
      return true;
    }
    return false;
  }

  if (strict) {
    for (const [svcKey, serviceDiff] of Object.entries(diff.services)) {
      for (const [table, tableDiff] of Object.entries(serviceDiff)) {
        const nonEnvInserts = tableDiff.inserted.filter(
          (r) => !isEnvironmentGeneratedRow(r, table),
        );
        nonEnvInserts.forEach((row, rowIdx) => {
          if (consumedInserts.has(`${svcKey}::${table}::${rowIdx}`)) return;
          const key = extractRowKey(row, table);
          if (tryAllowExtra(svcKey, table, "insert", row, key)) return;
          unexpectedWrites.push({
            service: svcKey,
            table,
            op: "insert",
            key,
            row,
            reason: `Unexpected insert in ${svcKey}.${table} (${key})`,
          });
        });

        tableDiff.updated.forEach((upd, rowIdx) => {
          if (consumedUpdates.has(`${svcKey}::${table}::${rowIdx}`)) return;
          if (tryAllowExtra(svcKey, table, "update", upd.after, upd.key)) return;
          unexpectedWrites.push({
            service: svcKey,
            table,
            op: "update",
            key: upd.key,
            changedFields: upd.changedFields,
            row: upd.after,
            reason: `Unexpected update in ${svcKey}.${table} (${upd.key}, fields: ${upd.changedFields.join(", ")})`,
          });
        });

        tableDiff.deleted.forEach((row, rowIdx) => {
          if (consumedDeletes.has(`${svcKey}::${table}::${rowIdx}`)) return;
          const key = extractRowKey(row, table);
          if (tryAllowExtra(svcKey, table, "delete", row, key)) return;
          unexpectedWrites.push({
            service: svcKey,
            table,
            op: "delete",
            key,
            row,
            reason: `Unexpected delete in ${svcKey}.${table} (${key})`,
          });
        });
      }
    }
  }

  const passed =
    missingInserts.length === 0 &&
    missingUpdates.length === 0 &&
    missingDeletes.length === 0 &&
    unexpectedWrites.length === 0;

  const systemAuditWrites = allowedExtrasUsed.filter((item) =>
    SYSTEM_AUDIT_TABLES.has(`${canonicalServiceName(item.service)}.${item.table}`),
  ).length;
  const extraGovernanceWrites = allowedExtrasUsed.length - systemAuditWrites;

  const summaryParts = [
    passed ? "PASS" : "FAIL",
    `inserts ${matchedInserts.length}/${mustInsert.length}`,
    `updates ${matchedUpdates.length}/${mustUpdate.length}`,
    `deletes ${matchedDeletes.length}/${mustDelete.length}`,
    `unexpected ${unexpectedWrites.length}`,
  ];
  if (extraGovernanceWrites > 0) {
    summaryParts.push(`extra_gov ${extraGovernanceWrites}`);
  }
  if (systemAuditWrites > 0) {
    summaryParts.push(`audit ${systemAuditWrites}`);
  }

  return {
    passed,
    score: passed ? 1 : 0,
    matchedInserts,
    missingInserts,
    matchedUpdates,
    missingUpdates,
    matchedDeletes,
    missingDeletes,
    unexpectedWrites,
    allowedExtrasUsed,
    extraGovernanceWrites,
    systemAuditWrites,
    diffSummary: diff.summary,
    summary: summaryParts.join(" | "),
  };
}

export function evaluateSnapshotsAgainstContract(
  before: GymSnapshot,
  after: GymSnapshot,
  contract: StateContract,
): StateContractResult {
  const diff = diffSnapshots(before, after);
  return evaluateStateContract(diff, contract);
}

// ── Scenario YAML loader & validator ────────────────────────────────

function assertKnownServiceTable(service: string, table: string, context: string): void {
  const canonical = canonicalServiceName(service);
  const tables = CANONICAL_SERVICE_TABLES[canonical];
  if (!tables) {
    throw new Error(`${context}: unknown service '${service}'`);
  }
  if (!tables.includes(table)) {
    throw new Error(
      `${context}: unknown table '${table}' on service '${service}' (known: ${tables.join(", ")})`,
    );
  }
}

export function validateStateScenario(
  raw: unknown,
  sourcePath = "<memory>",
): StateScenarioDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${sourcePath}: scenario must be a YAML/JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  for (const req of ["id", "slug", "name", "description", "difficulty", "services", "start_state", "turns", "expected_diff"]) {
    if (obj[req] === undefined || obj[req] === null) {
      throw new Error(`${sourcePath}: missing required field '${req}'`);
    }
  }

  const def = obj as unknown as StateScenarioDefinition;
  if (!["empty", "clean", "realistic"].includes(def.start_state.base)) {
    throw new Error(`${sourcePath}: invalid start_state.base '${def.start_state.base}'`);
  }
  if (!Array.isArray(def.turns) || def.turns.length < 2) {
    throw new Error(`${sourcePath}: deterministic multi-turn scenario requires at least 2 turns`);
  }

  for (const [svc, svcTables] of Object.entries(def.start_state.tables ?? {})) {
    for (const table of Object.keys(svcTables ?? {})) {
      assertKnownServiceTable(svc, table, `${sourcePath} start_state`);
    }
  }

  for (const item of def.expected_diff.must_insert ?? []) {
    assertKnownServiceTable(item.service, item.table, `${sourcePath} expected_diff.must_insert`);
  }
  for (const item of def.expected_diff.must_update ?? []) {
    assertKnownServiceTable(item.service, item.table, `${sourcePath} expected_diff.must_update`);
  }
  for (const item of def.expected_diff.must_delete ?? []) {
    assertKnownServiceTable(item.service, item.table, `${sourcePath} expected_diff.must_delete`);
  }
  for (const item of def.expected_diff.allowed_extras ?? []) {
    assertKnownServiceTable(item.service, item.table, `${sourcePath} expected_diff.allowed_extras`);
  }

  return def;
}

export function loadStateScenarioFile(filePath: string): StateScenarioDefinition {
  const raw = parseYaml(readFileSync(filePath, "utf-8"));
  return validateStateScenario(raw, filePath);
}

export function loadStateScenarios(
  dir = resolve(import.meta.dir, "../deterministic"),
): StateScenarioDefinition[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"))
    .sort();
  return files.map((f) => loadStateScenarioFile(join(dir, f)));
}

// ── Seeding helper across all 8 services ────────────────────────────

export async function seedStateScenario(
  scenario: StateScenarioDefinition,
  serviceUrls?: Record<string, string>,
): Promise<void> {
  const urls = serviceUrls ?? defaultBaseUrls();
  const base = scenario.start_state.base;
  const rawTablesByService = scenario.start_state.tables ?? {};

  // Map canonical service names ("carrier-summit") to defaultBaseUrls keys ("summit-fire")
  const tablesByUrlKey: Record<string, Record<string, Record<string, unknown>[]>> = {};
  for (const [svc, tables] of Object.entries(rawTablesByService)) {
    const urlKey = SERVICE_URL_KEY_MAP[svc] ?? svc;
    tablesByUrlKey[urlKey] = { ...(tablesByUrlKey[urlKey] ?? {}), ...tables };
  }

  await Promise.all(
    Object.entries(urls).map(async ([urlKey, baseUrl]) => {
      const tables = tablesByUrlKey[urlKey] ?? {};
      const res = await fetch(`${baseUrl}/sim/seed`, {
        method: "POST",
        headers: scorerHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ base, tables }),
      });
      if (!res.ok) {
        throw new Error(
          `${urlKey}: POST /sim/seed failed (${res.status}): ${await res.text()}`,
        );
      }
    }),
  );
}

export function formatStateContractReport(
  scenarioId: string,
  result: StateContractResult,
): string {
  const lines = [`[${result.passed ? "PASS" : "FAIL"}] ${scenarioId}: ${result.summary}`];
  for (const m of result.missingInserts) {
    lines.push(`  - MISSING INSERT (${m.label}): ${m.detail}`);
  }
  for (const m of result.missingUpdates) {
    lines.push(`  - MISSING UPDATE (${m.label}): ${m.detail}`);
  }
  for (const m of result.missingDeletes) {
    lines.push(`  - MISSING DELETE (${m.label}): ${m.detail}`);
  }
  for (const u of result.unexpectedWrites) {
    lines.push(`  - UNEXPECTED WRITE (${u.op}): ${u.reason}`);
  }
  return lines.join("\n");
}
