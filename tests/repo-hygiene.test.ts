import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dir, "..");
const FORBIDDEN_HOME_PREFIX = ["", "usr", "local", "google", "home", ""].join("/");
const FORBIDDEN_FILE_URI = ["file:", "", ""].join("/");

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "generated",
  ".pytest_cache",
  "__pycache__",
  "dist",
  "build",
]);

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".ts",
  ".py",
  ".yaml",
  ".yml",
  ".html",
  ".svg",
  ".sh",
]);

function walkRepoFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRepoFiles(fullPath, acc);
    } else if (entry.isFile()) {
      const dotIdx = entry.name.lastIndexOf(".");
      const ext = dotIdx >= 0 ? entry.name.slice(dotIdx) : "";
      if (TEXT_EXTENSIONS.has(ext)) {
        acc.push(fullPath);
      }
    }
  }
  return acc;
}

describe("Repository Hygiene & Governance Spine (ADR-005 & ADR-006)", () => {
  const repoFiles = walkRepoFiles(ROOT);

  test("4-file governance spine and CRITICAL.md size cap (< 10,000B) hold", () => {
    for (const spineFile of ["AGENTS.md", "CLAUDE.md", "CRITICAL.md", "DECISIONS.md", "cloudbuild.yaml"]) {
      expect(existsSync(join(ROOT, spineFile))).toBe(true);
    }
    const critStat = statSync(join(ROOT, "CRITICAL.md"));
    expect(critStat.size).toBeLessThanOrEqual(10_000);
    const decisionsStat = statSync(join(ROOT, "DECISIONS.md"));
    expect(decisionsStat.size).toBeLessThanOrEqual(25_000);
    expect(existsSync(join(ROOT, ".github", "workflows"))).toBe(false);
  });

  test("retired PG/K8s manifests, Drizzle schema.ts stubs, and committed caches are absent and .gitignore covers runtime DBs", () => {
    expect(existsSync(join(ROOT, "docker-compose.pg.yaml"))).toBe(false);
    expect(existsSync(join(ROOT, "k8s"))).toBe(false);
    expect(existsSync(join(ROOT, "eval", "metr", "__pycache__"))).toBe(false);

    const servicesDir = join(ROOT, "services");
    const staleSchemaFiles: string[] = [];
    for (const svc of readdirSync(servicesDir)) {
      const schemaTs = join(servicesDir, svc, "src", "schema.ts");
      if (existsSync(schemaTs)) {
        staleSchemaFiles.push(`services/${svc}/src/schema.ts`);
      }
    }
    expect(staleSchemaFiles).toEqual([]);

    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf-8");
    expect(gitignore).toContain("services/*/data/*.db");
    expect(gitignore).toContain("data/seed/*.db");
    expect(gitignore).toContain("eval/harbor/tasks/");
    expect(gitignore).toContain("__pycache__/");
  });

  test("all CRITICAL.md load-bearing paths exist on disk", () => {
    const criticalPaths = [
      "specs",
      "specs/claims.behavior.yaml",
      "data/seed",
      "data/seed-clean",
      "eval/evaluators/rubric.ts",
      "eval/score.ts",
      "regulatory.md",
      "packages/shared",
    ];
    for (const relPath of criticalPaths) {
      expect(existsSync(join(ROOT, relPath))).toBe(true);
    }
  });

  test("ADR-005 portability: zero machine-specific home paths or file:// URIs in tracked files (including .svg)", () => {
    expect(repoFiles.some((f) => f.endsWith(".svg"))).toBe(true);

    const violations: string[] = [];
    for (const filePath of repoFiles) {
      const rel = relative(ROOT, filePath);
      if (rel === "tests/repo-hygiene.test.ts") continue;
      const content = readFileSync(filePath, "utf-8");
      if (content.includes(FORBIDDEN_HOME_PREFIX)) {
        violations.push(`${rel}: contains machine-specific home path`);
      }
      if (content.includes(FORBIDDEN_FILE_URI) && !rel.startsWith("packages/shared/") && !rel.startsWith("tests/")) {
        violations.push(`${rel}: contains ${FORBIDDEN_FILE_URI} URI`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("32-Table state-diff invariant holds across docs & SVGs with zero stale 35-Table or non-existent table claims", () => {
    const servicesDir = join(ROOT, "services");
    let totalPrismaModels = 0;
    for (const svc of readdirSync(servicesDir)) {
      const prismaPath = join(servicesDir, svc, "prisma", "schema.prisma");
      if (existsSync(prismaPath)) {
        const schemaText = readFileSync(prismaPath, "utf-8");
        const models = schemaText.match(/^model\s+\w+\s+\{/gm) ?? [];
        totalPrismaModels += models.length;
      }
    }
    expect(totalPrismaModels).toBe(32);

    const staleClaims: string[] = [];
    for (const filePath of repoFiles) {
      const rel = relative(ROOT, filePath);
      if (rel === "tests/repo-hygiene.test.ts") continue;
      const content = readFileSync(filePath, "utf-8");
      for (const forbidden of [
        "35 Tables",
        "35 tables",
        "35-Table",
        "35-table",
        "35 SQLite",
        "carrier_summit.submissions",
        "claims.claim_notes",
      ]) {
        if (content.includes(forbidden)) {
          staleClaims.push(`${rel}: contains stale "${forbidden}"`);
        }
      }
    }
    expect(staleClaims).toEqual([]);
  });
});
