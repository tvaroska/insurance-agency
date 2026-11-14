export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export interface RowChange {
  key: string;
  before: Row;
  after: Row;
  /** Names of the columns whose value differs. */
  fields: string[];
}

export interface TableDiff {
  added: Row[];
  removed: Row[];
  changed: RowChange[];
}

export interface DiffOptions {
  /** Primary-key column per table. Defaults to the first column of the table's rows. */
  keys?: Record<string, string>;
  /** Columns to leave out of the comparison, per table or under "*" for all tables. */
  ignore?: Record<string, string[]>;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function index(rows: Row[], keyColumn: string | undefined): Map<string, Row> {
  const byKey = new Map<string, Row>();
  for (const row of rows) {
    const key = keyColumn !== undefined ? String(row[keyColumn]) : JSON.stringify(row);
    // A non-unique key column would hide rows, so fall back to the whole row.
    byKey.set(byKey.has(key) ? JSON.stringify(row) : key, row);
  }
  return byKey;
}

/**
 * Compares two `tables` objects from GET /sim/snapshot. The result holds only
 * the tables that changed, so `Object.keys(diff)` is the set of tables an
 * action touched and `diff` equal to `{}` means nothing was written.
 */
export function diffTables(before: Tables, after: Tables, opts: DiffOptions = {}): Record<string, TableDiff> {
  const result: Record<string, TableDiff> = {};
  for (const table of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const beforeRows = before[table] ?? [];
    const afterRows = after[table] ?? [];
    const sample = afterRows[0] ?? beforeRows[0];
    const keyColumn = opts.keys?.[table] ?? (sample ? Object.keys(sample)[0] : undefined);
    const ignored = new Set([...(opts.ignore?.["*"] ?? []), ...(opts.ignore?.[table] ?? [])]);
    const b = index(beforeRows, keyColumn);
    const a = index(afterRows, keyColumn);
    const diff: TableDiff = { added: [], removed: [], changed: [] };
    for (const [key, row] of a) {
      const prior = b.get(key);
      if (!prior) {
        diff.added.push(row);
        continue;
      }
      const fields = [...new Set([...Object.keys(prior), ...Object.keys(row)])].filter(
        (field) => !ignored.has(field) && !same(prior[field], row[field]),
      );
      if (fields.length > 0) diff.changed.push({ key, before: prior, after: row, fields });
    }
    for (const [key, row] of b) {
      if (!a.has(key)) diff.removed.push(row);
    }
    if (diff.added.length || diff.removed.length || diff.changed.length) result[table] = diff;
  }
  return result;
}
