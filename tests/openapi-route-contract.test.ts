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

function extractServiceRoutes(serviceName: string): Set<string> {
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

  // Find mount prefixes in index.ts: api.route("/prefix", routerVar)
  const mounts: Array<{ prefix: string; filePath: string }> = [];
  const routeMountRegex = /\b(api|app)\.route\(\s*["']([^"']+)["']\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  while ((match = routeMountRegex.exec(indexContent)) !== null) {
    const target = match[1];
    const rawPrefix = match[2];
    const routerVar = match[3];
    const filePath = importMap.get(routerVar);
    if (filePath) {
      const prefix =
        target === "api" ? `${apiBasePrefix}${rawPrefix}` : rawPrefix;
      mounts.push({ prefix, filePath });
    }
  }

  const routes = new Set<string>();

  // Collect direct routes registered on `app` in index.ts (e.g., /health, /auth/dev-token)
  const directMethodRegex = /\bapp\.(get|post|put|patch|delete)\(\s*["']([^"'*]+)["']/g;
  while ((match = directMethodRegex.exec(indexContent)) !== null) {
    routes.add(`${match[1].toUpperCase()} ${normalizePathTemplate(match[2])}`);
  }

  for (const { prefix, filePath } of mounts) {
    const routeSource = readFileSync(filePath, "utf-8");
    const methodRegex = /\.\b(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = methodRegex.exec(routeSource)) !== null) {
      const method = m[1].toUpperCase();
      const subPath = m[2];
      const fullPath =
        subPath === "/"
          ? prefix
          : `${prefix === "/" ? "" : prefix}${subPath.startsWith("/") ? subPath : `/${subPath}`}`;
      routes.add(`${method} ${normalizePathTemplate(fullPath)}`);
    }
  }

  return routes;
}

describe("OpenAPI Specs & Service Route Contract Suite", () => {
  const specFiles = readdirSync(SPECS_DIR)
    .filter(
      (f) =>
        f.endsWith(".yaml") &&
        !f.endsWith(".behavior.yaml") &&
        !f.endsWith(".rules.yaml"),
    )
    .sort();

  test("discovers all 8 OpenAPI 3.0 specification files", () => {
    expect(specFiles).toEqual(Object.keys(OPENAPI_SPEC_SERVICES).sort());
  });

  test("(a) zero dangling internal $refs across all 8 OpenAPI specs", () => {
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
  });

  test("(b) every path and operation declared in specs/*.yaml has a matching route handler in services/*/src/", () => {
    const missingRoutes: string[] = [];

    for (const [specFile, serviceName] of Object.entries(OPENAPI_SPEC_SERVICES)) {
      const raw = readFileSync(join(SPECS_DIR, specFile), "utf-8");
      const doc = parseYaml(raw) as {
        paths?: Record<string, Record<string, unknown>>;
      };
      const serviceRoutes = extractServiceRoutes(serviceName);

      for (const [specPath, pathItem] of Object.entries(doc.paths ?? {})) {
        for (const method of HTTP_METHODS) {
          if (pathItem && method in pathItem) {
            const key = `${method.toUpperCase()} ${normalizePathTemplate(specPath)}`;
            if (!serviceRoutes.has(key)) {
              missingRoutes.push(`${specFile} (${serviceName}): ${method.toUpperCase()} ${specPath}`);
            }
          }
        }
      }
    }

    expect(missingRoutes).toEqual([]);
  });

  test("(c) GET /quotes exists in specs/rater.yaml and GET /envelopes exists in both specs/ecm.yaml and services/ecm/src/routes/envelopes.ts", () => {
    const raterSpec = parseYaml(
      readFileSync(join(SPECS_DIR, "rater.yaml"), "utf-8"),
    ) as { paths?: Record<string, Record<string, any>> };

    expect(raterSpec.paths?.["/quotes"]?.get).toBeDefined();
    expect(raterSpec.paths?.["/quotes"]?.get?.operationId).toBe("listQuotes");
    expect(raterSpec.paths?.["/quotes"]?.get?.summary).toBe("List quotes");

    const ecmSpec = parseYaml(
      readFileSync(join(SPECS_DIR, "ecm.yaml"), "utf-8"),
    ) as { paths?: Record<string, Record<string, any>> };

    expect(ecmSpec.paths?.["/envelopes"]?.get).toBeDefined();
    expect(ecmSpec.paths?.["/envelopes"]?.get?.operationId).toBe("listEnvelopes");

    const ecmRoutes = extractServiceRoutes("ecm");
    expect(ecmRoutes.has("GET /envelopes")).toBe(true);

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
