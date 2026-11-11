import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { parse as parseYaml, parseAllDocuments, stringify as stringifyYaml } from "yaml";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ExtractedServiceRoutes {
  /** Routes mounted under `api` (`/v1` or `/v1/<portal>`), normalized relative to `/v1` */
  v1Routes: Map<string, string>;
  /** Routes mounted directly on `app` (`/health`, `/auth/dev-token`, `/workbench/*`, etc.) */
  appRoutes: Map<string, string>;
  /** All combined routes (`v1Routes` + `appRoutes`) */
  allRoutes: Set<string>;
  /** Any `.ts` file in `src/routes/` that was never mounted in `src/index.ts` */
  unmountedRouteFiles: string[];
}

function extractServiceRoutes(serviceName: string): ExtractedServiceRoutes {
  const srcDir = join(SERVICES_DIR, serviceName, "src");
  const indexPath = join(srcDir, "index.ts");
  const indexContent = readFileSync(indexPath, "utf-8");

  // Map imported router variable names to their route file paths
  const importMap = new Map<string, string>();
  const importRegex = /import\s+\{\s*([^}]+)\s*\}\s+from\s+["']\.\/routes\/([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(indexContent)) !== null) {
    const importedNames = match[1].split(",").map((s) => s.trim());
    const routeFile = match[2].endsWith(".ts") ? match[2] : `${match[2]}.ts`;
    for (const name of importedNames) {
      const localName = name.split(/\s+as\s+/).pop()!.trim();
      importMap.set(localName, join(srcDir, "routes", routeFile));
    }
  }

  // Determine the relative prefix under /v1 where `api` is mounted (e.g., "" for /v1, "/summit" for /v1/summit)
  const apiMountMatch = /\bapp\.route\(\s*["']([^"']+)["']\s*,\s*api\s*\)/.exec(indexContent);
  const apiBasePrefix = apiMountMatch
    ? apiMountMatch[1].replace(/^\/v1\b/, "")
    : "";

  const mounts: Array<{ target: "api" | "app"; prefix: string; filePath: string }> = [];
  const mountedFiles = new Set<string>();
  const routeMountRegex = /\b(api|app)\.route\(\s*["']([^"']+)["']\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  while ((match = routeMountRegex.exec(indexContent)) !== null) {
    const target = match[1] as "api" | "app";
    const rawPrefix = match[2];
    const routerVar = match[3];
    const filePath = importMap.get(routerVar);
    if (filePath) {
      mountedFiles.add(filePath);
      const prefix = target === "api" ? `${apiBasePrefix}${rawPrefix}` : rawPrefix;
      mounts.push({ target, prefix, filePath });
    }
  }

  const routesDir = join(srcDir, "routes");
  const unmountedRouteFiles = existsSync(routesDir)
    ? readdirSync(routesDir)
        .filter((f) => f.endsWith(".ts") && !mountedFiles.has(join(routesDir, f)))
        .sort()
    : [];

  const v1Routes = new Map<string, string>();
  const appRoutes = new Map<string, string>();

  // Collect direct routes registered on `app` in index.ts (e.g., /health, /auth/dev-token)
  const directMethodRegex = /\bapp\.(get|post|put|patch|delete)\(\s*["']([^"'*]+)["']/g;
  while ((match = directMethodRegex.exec(indexContent)) !== null) {
    const method = match[1].toUpperCase();
    const rawPath = match[2];
    appRoutes.set(`${method} ${normalizePathTemplate(rawPath)}`, `${method} ${rawPath} (index.ts)`);
  }

  for (const { target, prefix, filePath } of mounts) {
    const routeSource = readFileSync(filePath, "utf-8");
    // Only match Hono router instances (`new Hono...`), never `formData.get(...)` or `c.get(...)`
    const routerVars = Array.from(
      routeSource.matchAll(/\bconst\s+([A-Za-z0-9_]+)\s*=\s*new\s+Hono\b/g),
      (m) => m[1],
    );
    if (routerVars.length === 0) continue;

    const routerPattern = routerVars.map(escapeRegExp).join("|");
    const methodRegex = new RegExp(
      `\\b(?:${routerPattern})\\.(get|post|put|patch|delete)\\(\\s*["']([^"']+)["']`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = methodRegex.exec(routeSource)) !== null) {
      const method = m[1].toUpperCase();
      const subPath = m[2];
      const fullPath =
        subPath === "/"
          ? prefix
          : `${prefix === "/" ? "" : prefix}${subPath.startsWith("/") ? subPath : `/${subPath}`}`;
      const normKey = `${method} ${normalizePathTemplate(fullPath)}`;
      const desc = `${method} ${fullPath}`;
      if (target === "api") {
        v1Routes.set(normKey, desc);
      } else {
        appRoutes.set(normKey, desc);
      }
    }
  }

  const allRoutes = new Set<string>([...v1Routes.keys(), ...appRoutes.keys()]);
  return { v1Routes, appRoutes, allRoutes, unmountedRouteFiles };
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

  test("discovers all 8 OpenAPI 3.0 specification files and zero unmounted route modules", () => {
    expect(specFiles).toEqual(Object.keys(OPENAPI_SPEC_SERVICES).sort());

    const unmounted: string[] = [];
    for (const serviceName of Object.values(OPENAPI_SPEC_SERVICES)) {
      const { unmountedRouteFiles } = extractServiceRoutes(serviceName);
      for (const f of unmountedRouteFiles) {
        unmounted.push(`${serviceName}: ${f}`);
      }
    }
    expect(unmounted).toEqual([]);
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

  test("(b1) spec -> code parity: every path and operation in specs/*.yaml has a matching route handler in services/*/src/", () => {
    const missingInCode: string[] = [];

    for (const [specFile, serviceName] of Object.entries(OPENAPI_SPEC_SERVICES)) {
      const raw = readFileSync(join(SPECS_DIR, specFile), "utf-8");
      const doc = parseYaml(raw) as {
        paths?: Record<string, Record<string, unknown>>;
      };
      const { allRoutes } = extractServiceRoutes(serviceName);

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

  test("(b2) code -> spec parity: every /v1/* route handler in services/*/src/ is documented in specs/*.yaml", () => {
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

      const { v1Routes } = extractServiceRoutes(serviceName);
      for (const [routeKey, routeDesc] of v1Routes.entries()) {
        if (!specRouteKeys.has(routeKey)) {
          undocumentedInSpec.push(`${serviceName} -> ${specFile}: /v1${routeDesc.slice(routeDesc.indexOf(" ") + 1)} (${routeDesc.split(" ")[0]})`);
        }
      }
    }

    expect(undocumentedInSpec).toEqual([]);
  });

  test("(c) key quotes, envelopes, COI PDF, client detail, and FNOL endpoints are documented and wired", () => {
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

    const { v1Routes: ecmV1Routes } = extractServiceRoutes("ecm");
    expect(ecmV1Routes.has("GET /envelopes")).toBe(true);
    expect(ecmV1Routes.has("GET /documents/coi/:param/pdf")).toBe(true);
    expect(ecmV1Routes.has("GET /coi/:param/pdf")).toBe(true);

    const envelopesSource = readFileSync(
      join(SERVICES_DIR, "ecm", "src", "routes", "envelopes.ts"),
      "utf-8",
    );
    expect(envelopesSource).toContain('requireScopes("ecm:envelopes:read")');
    expect(envelopesSource).toContain("formatEnvelope");
  });
});

function resolveAstGrepBin(): string | null {
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
    if (!astGrep) return;

    const liveScan = spawnSync(astGrep, ["scan", "--rule", rulesPath], {
      cwd: ROOT_DIR,
      encoding: "utf-8",
    });
    expect(liveScan.status).toBe(0);

    const docs = parseAllDocuments(readFileSync(rulesPath, "utf-8"))
      .map((d) => d.toJSON() as Record<string, any>)
      .filter(Boolean);

    const scratchRoot = mkdtempSync(join(tmpdir(), "evergreen-ast-guard-"));
    try {
      docs.forEach((doc, idx) => {
        const caseDir = join(scratchRoot, `case_${idx}_${doc.id}`);
        const singleRulePath = join(caseDir, "_rule.yaml");
        const targetFile = join(caseDir, doc.metadata.test_path);
        mkdirSync(dirname(targetFile), { recursive: true });
        writeFileSync(singleRulePath, stringifyYaml(doc), "utf-8");

        for (const badCode of doc.metadata.invalid_examples as string[]) {
          writeFileSync(targetFile, `${badCode}\n`, "utf-8");
          const badRes = spawnSync(astGrep, ["scan", "--rule", singleRulePath, "."], {
            cwd: caseDir,
            encoding: "utf-8",
          });
          expect(badRes.status).toBe(1);
          expect(`${badRes.stdout}${badRes.stderr}`).toContain(doc.id);
        }

        for (const goodCode of doc.metadata.valid_examples as string[]) {
          writeFileSync(targetFile, `${goodCode}\n`, "utf-8");
          const goodRes = spawnSync(astGrep, ["scan", "--rule", singleRulePath, "."], {
            cwd: caseDir,
            encoding: "utf-8",
          });
          expect(goodRes.status).toBe(0);
        }
      });
    } finally {
      rmSync(scratchRoot, { recursive: true, force: true });
    }
  });
});
