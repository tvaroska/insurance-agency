import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { deref, validateSchema } from "./schema";
import type { HttpResult } from "./service";
import { REPO_ROOT } from "./paths";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

export interface OperationRef {
  operationId: string;
  /** Upper-case HTTP method. */
  method: string;
  /** Path template as served, including the server base path (for example `/v1/claims/{claim_id}`). */
  path: string;
  /** Scopes listed under the operation's `security` entry. */
  scopes: string[];
  /** Documented response status keys, for example `["200", "400", "404"]`. */
  statuses: string[];
}

export interface CheckOptions {
  /**
   * Accept a status the operation does not document. The body is then not
   * schema-checked. Use it only for a gap that the service spec lists.
   */
  allowUndocumentedStatus?: boolean;
  /**
   * Issues to tolerate, matched against `"<json pointer>: <message>"`. Use it
   * only for a gap that the service spec lists.
   */
  allow?: (string | RegExp)[];
  /** Check against this operation instead of the one matched from the request method and path. */
  operationId?: string;
}

export interface CheckResult {
  operationId: string;
  status: number;
  /** False when the documented response has no JSON schema to check against. */
  schemaChecked: boolean;
  issues: string[];
}

interface Operation extends OperationRef {
  segments: string[];
  responses: Record<string, any>;
}

export class Contract {
  readonly service: string;
  readonly document: any;
  private readonly ops: Operation[] = [];
  private readonly checked = new Set<string>();

  constructor(service: string, document: any) {
    this.service = service;
    this.document = document;
    const parseBasePath = (url: string): string => {
      try {
        return new URL(url).pathname.replace(/\/+$/, "");
      } catch {
        return url.startsWith("/") ? url.replace(/\/+$/, "") : "";
      }
    };
    const defaultBasePath = parseBasePath(document.servers?.[0]?.url ?? "");
    const topSecurity = document.security;
    for (const [specPath, rawItem] of Object.entries<any>(document.paths ?? {})) {
      const item = deref(rawItem, document);
      const itemBasePath = item.servers?.[0]?.url
        ? parseBasePath(item.servers[0].url)
        : defaultBasePath;
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const opBasePath = op.servers?.[0]?.url
          ? parseBasePath(op.servers[0].url)
          : itemBasePath;
        const path = `${opBasePath}${specPath}`;
        const security: Record<string, string[]>[] = op.security ?? topSecurity ?? [];
        const scopes = [...new Set(security.flatMap((entry) => Object.values(entry).flat()))];
        this.ops.push({
          operationId: op.operationId ?? `${method.toUpperCase()} ${path}`,
          method: method.toUpperCase(),
          path,
          scopes,
          statuses: Object.keys(op.responses ?? {}),
          segments: path.split("/").filter(Boolean),
          responses: op.responses ?? {},
        });
      }
    }
  }

  /** Every operation in the OpenAPI file. */
  operations(): OperationRef[] {
    return this.ops.map(({ segments: _s, responses: _r, ...ref }) => ref);
  }

  operation(operationId: string): OperationRef {
    const op = this.ops.find((o) => o.operationId === operationId);
    if (!op) throw new Error(`specs/${this.service}.yaml has no operation '${operationId}'.`);
    const { segments: _s, responses: _r, ...ref } = op;
    return ref;
  }

  /** Finds the operation that serves `method path`. A literal segment wins over a `{parameter}`. */
  match(method: string, path: string): OperationRef | undefined {
    const op = this.find(method, path);
    if (!op) return undefined;
    const { segments: _s, responses: _r, ...ref } = op;
    return ref;
  }

  private find(method: string, path: string): Operation | undefined {
    const wanted = path.split("?")[0].split("/").filter(Boolean);
    let best: Operation | undefined;
    let bestLiterals = -1;
    for (const op of this.ops) {
      if (op.method !== method.toUpperCase() || op.segments.length !== wanted.length) continue;
      let literals = 0;
      let ok = true;
      for (let i = 0; i < wanted.length; i++) {
        const seg = op.segments[i];
        if (seg.startsWith("{") && seg.endsWith("}")) continue;
        if (seg !== wanted[i]) {
          ok = false;
          break;
        }
        literals++;
      }
      if (ok && literals > bestLiterals) {
        best = op;
        bestLiterals = literals;
      }
    }
    return best;
  }

  /** Like `check`, but returns the issues instead of throwing. */
  inspect(res: HttpResult, opts: CheckOptions = {}): CheckResult {
    const { method, path } = res.request;
    const op = opts.operationId
      ? this.ops.find((o) => o.operationId === opts.operationId)
      : this.find(method, path);
    if (!op) {
      const what = opts.operationId ? `operation '${opts.operationId}'` : `operation for ${method} ${path}`;
      return {
        operationId: "",
        status: res.status,
        schemaChecked: false,
        issues: [`specs/${this.service}.yaml has no ${what}`],
      };
    }
    this.checked.add(op.operationId);
    const result: CheckResult = { operationId: op.operationId, status: res.status, schemaChecked: false, issues: [] };

    const status = String(res.status);
    const rawResponse = op.responses[status] ?? op.responses[`${status[0]}XX`] ?? op.responses.default;
    if (!rawResponse) {
      if (!opts.allowUndocumentedStatus) {
        result.issues.push(
          `status ${status} is not documented for ${op.operationId} (documented: ${op.statuses.join(", ") || "none"})`,
        );
      }
      return result;
    }
    const response = deref(rawResponse, this.document);
    const content: Record<string, any> | undefined = response.content;
    if (!content || Object.keys(content).length === 0) return result;

    const actualType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const mediaKey = Object.keys(content).find((key) => {
      const k = key.toLowerCase();
      return k === actualType || k === "*/*" || (k.endsWith("/*") && actualType.startsWith(k.slice(0, -1)));
    });
    if (!mediaKey) {
      result.issues.push(
        `content type '${actualType}' is not documented for ${op.operationId} ${status} (documented: ${Object.keys(content).join(", ")})`,
      );
      return result;
    }
    const schema = content[mediaKey]?.schema;
    if (!schema || !mediaKey.toLowerCase().includes("json")) return result;

    result.schemaChecked = true;
    for (const issue of validateSchema(schema, res.body, this.document)) {
      const line = `${issue.path || "/"}: ${issue.message}`;
      const tolerated = (opts.allow ?? []).some((rule) =>
        typeof rule === "string" ? line.includes(rule) : rule.test(line),
      );
      if (!tolerated) result.issues.push(line);
    }
    return result;
  }

  /**
   * Validates a response against the matching operation in the OpenAPI file:
   * the status must be documented and a JSON body must satisfy the documented
   * schema. Throws with every issue listed.
   */
  check(res: HttpResult, opts: CheckOptions = {}): CheckResult {
    const result = this.inspect(res, opts);
    if (result.issues.length > 0) {
      const head = `${res.request.method} ${res.request.path} -> ${res.status} does not conform to specs/${this.service}.yaml`;
      throw new Error(`${head}\n  - ${result.issues.join("\n  - ")}\n  body: ${preview(res.body)}`);
    }
    return result;
  }

  /** Issues found when validating `value` against `#/components/schemas/<name>`. */
  inspectSchema(name: string, value: unknown): string[] {
    const schema = this.document.components?.schemas?.[name];
    if (!schema) return [`specs/${this.service}.yaml has no component schema '${name}'`];
    return validateSchema(schema, value, this.document).map((issue) => `${issue.path || "/"}: ${issue.message}`);
  }

  /** Validates `value` against a named component schema and throws with every issue listed. */
  checkSchema(name: string, value: unknown): void {
    const issues = this.inspectSchema(name, value);
    if (issues.length > 0) {
      throw new Error(
        `value does not conform to ${name} in specs/${this.service}.yaml\n  - ${issues.join("\n  - ")}\n  value: ${preview(value)}`,
      );
    }
  }

  /** Operation ids that no `check` or `inspect` call on this contract object has seen yet. */
  unchecked(): string[] {
    return this.ops.map((o) => o.operationId).filter((id) => !this.checked.has(id));
  }
}

function preview(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text && text.length > 600 ? `${text.slice(0, 600)}...` : String(text);
}

/**
 * Loads specs/<service>.yaml. Each call returns a fresh object, so the
 * `unchecked()` bookkeeping is scoped to the test file that loaded it.
 */
export function loadContract(service: string): Contract {
  const text = readFileSync(join(REPO_ROOT, "specs", `${service}.yaml`), "utf8");
  return new Contract(service, parse(text));
}
