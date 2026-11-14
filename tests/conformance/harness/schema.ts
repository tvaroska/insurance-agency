// Validator for the JSON Schema subset used by the OpenAPI 3.0 files in specs/.
// Supported: $ref (local), type, nullable, enum, format (date, date-time, uuid,
// email, uri), properties, required, additionalProperties, items, allOf, oneOf,
// anyOf, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf,
// minLength, maxLength, pattern, minItems, maxItems, uniqueItems,
// minProperties, maxProperties. Other keywords are ignored.

export interface SchemaIssue {
  /** JSON pointer into the validated value, "" for the root. */
  path: string;
  message: string;
}

type Schema = Record<string, any>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function checkFormat(format: string, value: string): string | null {
  switch (format) {
    case "date": {
      const m = DATE.exec(value);
      return m && isRealDate(+m[1], +m[2], +m[3]) ? null : "is not a YYYY-MM-DD date";
    }
    case "date-time": {
      const m = DATE_TIME.exec(value);
      return m && isRealDate(+m[1], +m[2], +m[3]) && +m[4] < 24 && +m[5] < 60 && +m[6] < 61
        ? null
        : "is not an RFC 3339 date-time";
    }
    case "uuid":
      return UUID.test(value) ? null : "is not a UUID";
    case "email":
      return EMAIL.test(value) ? null : "is not an email address";
    case "uri":
      try {
        new URL(value);
        return null;
      } catch {
        return "is not an absolute URI";
      }
    default:
      return null;
  }
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return typeOf(value) === "object";
    default:
      return typeOf(value) === type;
  }
}

export function resolvePointer(root: unknown, ref: string): any {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local references are supported, got '${ref}'.`);
  }
  let node: any = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    node = node?.[key];
    if (node === undefined) throw new Error(`Reference '${ref}' does not resolve.`);
  }
  return node;
}

/**
 * Follows `$ref` chains. Keywords written next to a `$ref` (the specs use
 * `nullable: true` this way) are kept and override the referenced schema.
 */
export function deref(schema: Schema, root: unknown): Schema {
  let current = schema;
  for (let hops = 0; current && typeof current.$ref === "string"; hops++) {
    if (hops > 50) throw new Error(`Reference cycle at '${current.$ref}'.`);
    const { $ref, ...siblings } = current;
    current = { ...resolvePointer(root, $ref), ...siblings };
  }
  return current;
}

function allowsNull(schema: Schema, root: unknown): boolean {
  const s = deref(schema, root);
  if (s.nullable === true) return true;
  if (Array.isArray(s.enum) && s.enum.includes(null)) return true;
  for (const key of ["oneOf", "anyOf"]) {
    if (Array.isArray(s[key]) && s[key].some((sub: Schema) => allowsNull(sub, root))) return true;
  }
  return false;
}

export function validateSchema(
  schemaIn: Schema,
  value: unknown,
  root: unknown = schemaIn,
  path = "",
): SchemaIssue[] {
  const schema = deref(schemaIn, root);
  const issues: SchemaIssue[] = [];
  const fail = (message: string) => issues.push({ path, message });

  if (value === null) {
    if (allowsNull(schema, root)) return issues;
    if (schema.type || schema.properties || schema.items || schema.allOf || schema.oneOf || schema.anyOf) {
      fail("is null but the schema is not nullable");
    }
    return issues;
  }

  if (typeof schema.type === "string" && !matchesType(schema.type, value)) {
    fail(`is ${typeOf(value)}, expected ${schema.type}`);
    return issues;
  }

  if (Array.isArray(schema.enum)) {
    const wanted = JSON.stringify(value);
    if (!schema.enum.some((option: unknown) => JSON.stringify(option) === wanted)) {
      fail(`is ${wanted}, expected one of ${JSON.stringify(schema.enum)}`);
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) issues.push(...validateSchema(sub, value, root, path));
  }
  if (Array.isArray(schema.anyOf)) {
    const results = schema.anyOf.map((sub: Schema) => validateSchema(sub, value, root, path));
    if (!results.some((r: SchemaIssue[]) => r.length === 0)) {
      fail(`matches none of the anyOf branches (${results.map((r: SchemaIssue[]) => r[0]?.message).join("; ")})`);
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const results = schema.oneOf.map((sub: Schema) => validateSchema(sub, value, root, path));
    const passing = results.filter((r: SchemaIssue[]) => r.length === 0).length;
    if (passing !== 1) {
      fail(
        passing === 0
          ? `matches none of the oneOf branches (${results.map((r: SchemaIssue[]) => r[0]?.message).join("; ")})`
          : `matches ${passing} oneOf branches, expected exactly 1`,
      );
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number") {
      if (schema.exclusiveMinimum === true ? value <= schema.minimum : value < schema.minimum) {
        fail(`is ${value}, below minimum ${schema.minimum}`);
      }
    }
    if (typeof schema.maximum === "number") {
      if (schema.exclusiveMaximum === true ? value >= schema.maximum : value > schema.maximum) {
        fail(`is ${value}, above maximum ${schema.maximum}`);
      }
    }
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
      const ratio = value / schema.multipleOf;
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) fail(`is not a multiple of ${schema.multipleOf}`);
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      fail(`is shorter than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      fail(`is longer than maxLength ${schema.maxLength}`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      fail(`does not match pattern ${schema.pattern}`);
    }
    if (typeof schema.format === "string") {
      const problem = checkFormat(schema.format, value);
      if (problem) fail(`${JSON.stringify(value)} ${problem}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      fail(`has ${value.length} items, fewer than minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      fail(`has ${value.length} items, more than maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) fail("has duplicate items");
    }
    if (schema.items && typeof schema.items === "object") {
      value.forEach((item, i) => issues.push(...validateSchema(schema.items, item, root, `${path}/${i}`)));
    }
  }

  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in obj)) fail(`is missing required property '${key}'`);
      }
    }
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) {
      fail(`has fewer than ${schema.minProperties} properties`);
    }
    if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) {
      fail(`has more than ${schema.maxProperties} properties`);
    }
    const props: Record<string, Schema> = schema.properties ?? {};
    for (const key of keys) {
      const childPath = `${path}/${key}`;
      if (props[key]) {
        issues.push(...validateSchema(props[key], obj[key], root, childPath));
      } else if (schema.additionalProperties === false) {
        issues.push({ path: childPath, message: "is not allowed (additionalProperties: false)" });
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        issues.push(...validateSchema(schema.additionalProperties, obj[key], root, childPath));
      }
    }
  }

  return issues;
}
