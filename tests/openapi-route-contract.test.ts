import { describe, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { parse as parseYaml, parseAllDocuments, stringify as stringifyYaml } from "yaml";
import { generateDevToken } from "../packages/shared/src/index";

const ROOT_DIR = resolve(import.meta.dir, "..");
const SPECS_DIR = join(ROOT_DIR, "specs");
const SERVICES_DIR = join(ROOT_DIR, "services");

const OPENAPI_SPEC_SERVICES: Record<string, string> = {
  "ams.yaml": "ams",
  "rater.yaml": "rater",
  "crm.yaml": "crm",
  "ecm.yaml": "ecm",
  "comm.yaml": "comm",
  "carrier-summit.yaml": "carrier-summit",
  "carrier-coastal.yaml": "carrier-coastal",
  "claims.yaml": "claims",
};

const REST_TOOL_SPEC_FILES = ["ams.yaml", "rater.yaml", "crm.yaml", "ecm.yaml", "claims.yaml"] as const;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function collectRefs(node: unknown, refs: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRefs(item, refs);
    }
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$ref" && typeof value === "string") {
        refs.push(value);
      } else {
        collectRefs(value, refs);
      }
    }
  }
  return refs;
}

function resolveJsonPointer(doc: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  const parts = ref
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = doc;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function normalizePathTemplate(pathStr: string): string {
  const cleaned = pathStr.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  return cleaned
    .replace(/\{[^}]+\}/g, ":param")
    .replace(/:[A-Za-z0-9_]+/g, ":param");
}

interface ExtractedServiceRoutes {
  v1Routes: Map<string, string>;
  appRoutes: Map<string, string>;
  allRoutes: Set<string>;
}

export function extractRoutesFromHonoApp(honoApp: {
  routes: ReadonlyArray<{ method: string; path: string }>;
}): ExtractedServiceRoutes {
  const v1Routes = new Map<string, string>();
  const appRoutes = new Map<string, string>();
  const allowedMethods = new Set<string>(HTTP_METHODS.map((m) => m.toUpperCase()));

  for (const route of honoApp.routes) {
    const method = route.method.toUpperCase();
    if (!allowedMethods.has(method)) continue;
    if (route.path.includes("*")) continue;
    if (route.path === "/sim" || route.path.startsWith("/sim/")) continue;

    if (route.path === "/v1" || route.path.startsWith("/v1/")) {
      const relPath = route.path.slice(3) || "/";
      const normKey = `${method} ${normalizePathTemplate(relPath)}`;
      v1Routes.set(normKey, `${method} ${relPath}`);
    } else {
      const normKey = `${method} ${normalizePathTemplate(route.path)}`;
      appRoutes.set(normKey, `${method} ${route.path}`);
    }
  }

  const allRoutes = new Set<string>([...v1Routes.keys(), ...appRoutes.keys()]);
  return { v1Routes, appRoutes, allRoutes };
}

interface HonoServiceApp {
  routes: ReadonlyArray<{ method: string; path: string }>;
  request(input: RequestInfo | URL, requestInit?: RequestInit): Response | Promise<Response>;
}

describe("OpenAPI Specs & Bidirectional Service Route Contract Suite", () => {
  const specFiles = readdirSync(SPECS_DIR)
    .filter(
      (f) =>
        f.endsWith(".yaml") &&
        !f.endsWith(".behavior.yaml") &&
        !f.endsWith(".rules.yaml"),
    )
    .sort();

  const serviceApps = new Map<string, HonoServiceApp>();
  const extractedByService = new Map<string, ExtractedServiceRoutes>();

  beforeAll(async () => {
    if (!process.env.EVERGREEN_DATA_DIR) {
      const tempDataDir = mkdtempSync(join(tmpdir(), "evergreen-route-contract-"));
      process.env.EVERGREEN_DATA_DIR = tempDataDir;
      process.once("exit", () => {
        try {
          rmSync(tempDataDir, { recursive: true, force: true });
        } catch {
          // Ignore exit cleanup errors.
        }
      });
    }

    for (const serviceName of Object.values(OPENAPI_SPEC_SERVICES)) {
      const mod = await import(join(SERVICES_DIR, serviceName, "src", "index.ts"));
      serviceApps.set(serviceName, mod.app);
      extractedByService.set(serviceName, extractRoutesFromHonoApp(mod.app));
    }
  });

  test("discovers all 8 OpenAPI 3.0 specification files and loads every Hono service app", () => {
    expect(specFiles).toEqual(Object.keys(OPENAPI_SPEC_SERVICES).sort());
    expect(extractedByService.size).toBe(8);
    for (const [svc, routes] of extractedByService.entries()) {
      expect(routes.allRoutes.has("GET /health")).toBe(true);
      expect(routes.v1Routes.size, `${svc} should expose /v1 routes`).toBeGreaterThan(0);
    }
  });

  test("extractRoutesFromHonoApp derives routes from app.routes regardless of helper splits or file renames", async () => {
    type MiniRouter = {
      routes: ReadonlyArray<{ method: string; path: string }>;
      get(path: string, handler: (c: { json(body: unknown): unknown }) => unknown): unknown;
      post(path: string, handler: (c: { json(body: unknown): unknown }) => unknown): unknown;
      route(path: string, subApp: unknown): unknown;
    };
    const { Hono } = (await import(Bun.resolveSync("hono", join(ROOT_DIR, "packages", "shared")))) as {
      Hono: new () => MiniRouter;
    };
    const app = new Hono();
    const renamedSubRouter = new Hono();
    const registerViaHelper = (r: MiniRouter) => r.post("/items/:item_id/approve", (c) => c.json({ ok: true }));
    registerViaHelper(renamedSubRouter);
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.route("/v1/catalog", renamedSubRouter);
    app.get("/sim/snapshot", (c) => c.json({ tables: {} }));

    const extracted = extractRoutesFromHonoApp(app);
    expect(extracted.v1Routes.has("POST /catalog/items/:param/approve")).toBe(true);
    expect(extracted.appRoutes.has("GET /health")).toBe(true);
    expect(extracted.allRoutes.has("GET /sim/snapshot")).toBe(false);
  });

  test("(a) zero dangling internal $refs across all 8 OpenAPI specs and unique REST operationIds", () => {
    const dangling: string[] = [];

    for (const file of specFiles) {
      const raw = readFileSync(join(SPECS_DIR, file), "utf-8");
      const doc = parseYaml(raw) as Record<string, unknown>;
      const refs = collectRefs(doc);

      for (const ref of refs) {
        if (ref.startsWith("#/")) {
          const target = resolveJsonPointer(doc, ref);
          if (target === undefined) {
            dangling.push(`${file}: ${ref}`);
          }
        }
      }
    }
    expect(dangling).toEqual([]);

    const seenOpIds = new Map<string, string>();
    const duplicateOpIds: string[] = [];
    const missingOpIds: string[] = [];
    for (const file of REST_TOOL_SPEC_FILES) {
      const doc = parseYaml(readFileSync(join(SPECS_DIR, file), "utf-8")) as {
        paths?: Record<string, Record<string, { operationId?: string }>>;
      };
      for (const [specPath, pathItem] of Object.entries(doc.paths ?? {})) {
        for (const method of HTTP_METHODS) {
          if (pathItem && method in pathItem) {
            const opId = pathItem[method]?.operationId;
            if (!opId) {
              missingOpIds.push(`${file}: ${method.toUpperCase()} ${specPath}`);
            } else if (seenOpIds.has(opId)) {
              duplicateOpIds.push(`${opId} (${seenOpIds.get(opId)} vs ${file})`);
            } else {
              seenOpIds.set(opId, `${file} ${method.toUpperCase()} ${specPath}`);
            }
          }
        }
      }
    }
    expect(missingOpIds).toEqual([]);
    expect(duplicateOpIds).toEqual([]);
  });

  test("(b1) spec -> code parity: every path and operation in specs/*.yaml has a matching route handler on Hono app.routes", () => {
    const missingInCode: string[] = [];

    for (const [specFile, serviceName] of Object.entries(OPENAPI_SPEC_SERVICES)) {
      const raw = readFileSync(join(SPECS_DIR, specFile), "utf-8");
      const doc = parseYaml(raw) as {
        paths?: Record<string, Record<string, unknown>>;
      };
      const { allRoutes } = extractedByService.get(serviceName)!;

      for (const [specPath, pathItem] of Object.entries(doc.paths ?? {})) {
        for (const method of HTTP_METHODS) {
          if (pathItem && method in pathItem) {
            const key = `${method.toUpperCase()} ${normalizePathTemplate(specPath)}`;
            if (!allRoutes.has(key)) {
              missingInCode.push(`${specFile} (${serviceName}): ${method.toUpperCase()} ${specPath}`);
            }
          }
        }
      }
    }

    expect(missingInCode).toEqual([]);
  });

  test("(b2) code -> spec parity: every /v1/* route handler on Hono app.routes is documented in specs/*.yaml", () => {
    const undocumentedInSpec: string[] = [];

    for (const [specFile, serviceName] of Object.entries(OPENAPI_SPEC_SERVICES)) {
      const raw = readFileSync(join(SPECS_DIR, specFile), "utf-8");
      const doc = parseYaml(raw) as {
        paths?: Record<string, Record<string, unknown>>;
      };
      const specRouteKeys = new Set<string>();
      for (const [specPath, pathItem] of Object.entries(doc.paths ?? {})) {
        for (const method of HTTP_METHODS) {
          if (pathItem && method in pathItem) {
            specRouteKeys.add(`${method.toUpperCase()} ${normalizePathTemplate(specPath)}`);
          }
        }
      }

      const { v1Routes } = extractedByService.get(serviceName)!;
      for (const [routeKey, routeDesc] of v1Routes.entries()) {
        if (!specRouteKeys.has(routeKey)) {
          undocumentedInSpec.push(
            `${serviceName} -> ${specFile}: /v1${routeDesc.slice(routeDesc.indexOf(" ") + 1)} (${routeDesc.split(" ")[0]})`,
          );
        }
      }
    }

    expect(undocumentedInSpec).toEqual([]);
  });

  test("(c) key quotes, envelopes, COI PDF, client detail, and FNOL endpoints are documented and enforce scope contracts", async () => {
    const amsSpec = parseYaml(readFileSync(join(SPECS_DIR, "ams.yaml"), "utf-8")) as {
      paths?: Record<string, Record<string, any>>;
    };
    expect(amsSpec.paths?.["/clients/{id}"]?.get?.operationId).toBe("getClient");

    const raterSpec = parseYaml(readFileSync(join(SPECS_DIR, "rater.yaml"), "utf-8")) as {
      paths?: Record<string, Record<string, any>>;
    };
    expect(raterSpec.paths?.["/quotes"]?.get?.operationId).toBe("listQuotes");

    const ecmSpec = parseYaml(readFileSync(join(SPECS_DIR, "ecm.yaml"), "utf-8")) as {
      paths?: Record<string, Record<string, any>>;
    };
    expect(ecmSpec.paths?.["/envelopes"]?.get?.operationId).toBe("listEnvelopes");
    expect(ecmSpec.paths?.["/documents/coi/generate"]?.post?.operationId).toBe("generateCoi");
    expect(ecmSpec.paths?.["/documents/coi"]?.post?.operationId).toBe("issueDocumentCoi");
    expect(ecmSpec.paths?.["/documents/coi/{document_id}/pdf"]?.get?.operationId).toBe("getCoiPdf");
    expect(ecmSpec.paths?.["/coi/generate"]?.post?.operationId).toBe("generateCoiDirect");
    expect(ecmSpec.paths?.["/coi"]?.post?.operationId).toBe("createCoi");
    expect(ecmSpec.paths?.["/coi/{document_id}/pdf"]?.get?.operationId).toBe("downloadCoiPdf");

    const claimsSpec = parseYaml(readFileSync(join(SPECS_DIR, "claims.yaml"), "utf-8")) as {
      paths?: Record<string, Record<string, any>>;
    };
    expect(claimsSpec.paths?.["/claims/fnol"]?.post?.operationId).toBe("fileFnol");
    expect(claimsSpec.paths?.["/claims"]?.post?.operationId).toBe("fileClaim");

    const { v1Routes: ecmV1Routes } = extractedByService.get("ecm")!;
    expect(ecmV1Routes.has("GET /envelopes")).toBe(true);
    expect(ecmV1Routes.has("GET /documents/coi/:param/pdf")).toBe(true);
    expect(ecmV1Routes.has("GET /coi/:param/pdf")).toBe(true);

    // Verify ecm:envelopes:read scope enforcement via the Hono app directly rather than source-string grep
    const ecmApp = serviceApps.get("ecm")!;
    const noScopeToken = await generateDevToken({ sub: "scope-probe", scopes: ["ecm:documents:read"] });
    const deniedRes = await ecmApp.request("http://localhost:3003/v1/envelopes", {
      headers: { Authorization: `Bearer ${noScopeToken}` },
    });
    expect(deniedRes.status).toBe(403);
  });
});

function resolveAstGrepBin(): string | null {
  const localBin = join(ROOT_DIR, "node_modules", ".bin", "ast-grep");
  if (existsSync(localBin)) return localBin;
  const fromPath = Bun.which("ast-grep");
  if (fromPath) return fromPath;
  const homeBin = join(process.env.HOME ?? "/root", ".local", "bin", "ast-grep");
  return existsSync(homeBin) ? homeBin : null;
}

describe("Declarative AST Structural & Security Contract (specs/ast.rules.yaml)", () => {
  const rulesPath = join(SPECS_DIR, "ast.rules.yaml");

  test("specs/ast.rules.yaml defines >=4 error-severity rules with positive/negative metadata examples", () => {
    expect(existsSync(rulesPath)).toBe(true);
    const docs = parseAllDocuments(readFileSync(rulesPath, "utf-8"))
      .map((d) => d.toJSON() as Record<string, any>)
      .filter(Boolean);
    expect(docs.length).toBeGreaterThanOrEqual(4);

    for (const doc of docs) {
      expect(typeof doc.id).toBe("string");
      expect(doc.language).toBe("TypeScript");
      expect(doc.severity).toBe("error");
      expect(typeof doc.metadata?.test_path).toBe("string");
      expect(Array.isArray(doc.metadata?.invalid_examples)).toBe(true);
      expect(doc.metadata.invalid_examples.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(doc.metadata?.valid_examples)).toBe(true);
      expect(doc.metadata.valid_examples.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("ast-grep passes across repository and flags every invalid_example positive control", () => {
    const astGrep = resolveAstGrepBin();
    if (!astGrep) {
      if (process.env.ALLOW_MISSING_AST_GREP === "1") {
        return;
      }
      throw new Error("ast-grep binary not found (set ALLOW_MISSING_AST_GREP=1 to opt out)");
    }

    const liveScan = spawnSync(astGrep, ["scan", "--rule", rulesPath], {
      cwd: ROOT_DIR,
      encoding: "utf-8",
    });
    expect(liveScan.status).toBe(0);

    const docs = parseAllDocuments(readFileSync(rulesPath, "utf-8"))
      .map((d) => d.toJSON() as Record<string, any>)
      .filter(Boolean);

    const tempRoot = mkdtempSync(join(tmpdir(), "evergreen-ast-rules-"));
    try {
      for (const doc of docs) {
        const relTestPath = doc.metadata.test_path as string;
        const singleRuleYaml = stringifyYaml(doc);
        const singleRuleFile = join(tempRoot, `${doc.id}.yaml`);
        writeFileSync(singleRuleFile, singleRuleYaml, "utf-8");

        const targetFile = join(tempRoot, relTestPath);
        mkdirSync(dirname(targetFile), { recursive: true });

        for (const badCode of doc.metadata.invalid_examples as string[]) {
          writeFileSync(targetFile, `${badCode}\n`, "utf-8");
          const badScan = spawnSync(astGrep, ["scan", "--rule", singleRuleFile, targetFile], {
            cwd: tempRoot,
            encoding: "utf-8",
          });
          expect(badScan.status).not.toBe(0);
        }

        for (const goodCode of doc.metadata.valid_examples as string[]) {
          writeFileSync(targetFile, `${goodCode}\n`, "utf-8");
          const goodScan = spawnSync(astGrep, ["scan", "--rule", singleRuleFile, targetFile], {
            cwd: tempRoot,
            encoding: "utf-8",
          });
          expect(goodScan.status).toBe(0);
        }
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
