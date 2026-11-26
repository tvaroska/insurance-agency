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

function findPycacheDirs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".venv") continue;
    if (!entry.isDirectory()) continue;
    const fullPath = join(dir, entry.name);
    if (entry.name === "__pycache__") {
      acc.push(relative(ROOT, fullPath));
      continue;
    }
    findPycacheDirs(fullPath, acc);
  }
  return acc;
}

interface CriticalTableRow {
  pathColumn: string;
  whyColumn: string;
  pinningColumn: string;
}

function parseCriticalTable(markdown: string): CriticalTableRow[] {
  const lines = markdown.split("\n").map((l) => l.trim());
  const rows: CriticalTableRow[] = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split(/(?<!\\)\|/)
      .map((c) => c.replace(/\\\|/g, "|").trim());
    if (cells.length < 3) continue;
    if (cells[0] === "Path / Invariant" || cells[0].startsWith(":---") || cells[0].startsWith("---")) continue;
    rows.push({ pathColumn: cells[0], whyColumn: cells[1], pinningColumn: cells[2] });
  }
  return rows;
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
    expect(existsSync(join(ROOT, "tests", "e2e"))).toBe(false);
    expect(findPycacheDirs(ROOT)).toEqual([]);

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
    const markdown = readFileSync(join(ROOT, "CRITICAL.md"), "utf-8");
    const rows = parseCriticalTable(markdown);
    expect(rows.length).toBeGreaterThanOrEqual(5);

    const extracted = new Set<string>();
    const linkRe = /\[[^\]]+\]\(([^)\s]+)\)/g;
    const codePathRe = /`((?:specs|data|eval|packages|services|tests|docs|scripts)\/[^`\s*?|]+|regulatory\.md)`/g;
    for (const row of rows) {
      for (const m of row.pathColumn.matchAll(linkRe)) {
        const target = m[1].split("#", 1)[0];
        if (!target || target.startsWith("http://") || target.startsWith("https://")) continue;
        extracted.add(target.replace(/\/+$/, ""));
      }
      for (const m of row.pathColumn.matchAll(codePathRe)) {
        extracted.add(m[1].replace(/\/+$/, ""));
      }
    }

    expect(extracted.size).toBeGreaterThanOrEqual(8);
    const missing = [...extracted].filter((relPath) => !existsSync(join(ROOT, relPath)));
    expect(missing).toEqual([]);
  });

  test("every pinning test named in CRITICAL.md exists", () => {
    const markdown = readFileSync(join(ROOT, "CRITICAL.md"), "utf-8");
    const rows = parseCriticalTable(markdown);
    expect(rows.length).toBeGreaterThanOrEqual(5);

    const missing: string[] = [];
    const globs: string[] = [];
    let totalPinned = 0;

    for (const row of rows) {
      const entries = [...row.pinningColumn.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
      expect(entries.length, `CRITICAL.md row has no pinning tests: ${row.pathColumn}`).toBeGreaterThan(0);
      for (const entry of entries) {
        totalPinned++;
        if (/[*?[\]]/.test(entry)) {
          globs.push(entry);
          continue;
        }
        if (!existsSync(join(ROOT, entry))) {
          missing.push(entry);
        }
      }
    }

    expect(totalPinned).toBeGreaterThanOrEqual(10);
    expect(globs).toEqual([]);
    expect(missing).toEqual([]);
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

  test("secret-scanning hygiene: .github/secret_scanning.yml exists and tracked files avoid 24+ char whsec_ literals", () => {
    expect(existsSync(join(ROOT, ".github", "secret_scanning.yml"))).toBe(true);

    const stripeWebhookLike = new RegExp(`\\b${"whsec"}_[A-Za-z0-9+/=_]{24,}\\b`);
    const jsonFiles: string[] = [];
    for (const sub of ["data", "specs", "tests", "services", "packages", "docs"]) {
      const base = join(ROOT, sub);
      if (!existsSync(base)) continue;
      const walkJson = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (SKIP_DIRS.has(entry.name) || entry.name === ".venv" || entry.name === "artifacts") continue;
          const p = join(dir, entry.name);
          if (entry.isDirectory()) walkJson(p);
          else if (entry.isFile() && entry.name.endsWith(".json")) jsonFiles.push(p);
        }
      };
      walkJson(base);
    }

    const hits: string[] = [];
    for (const filePath of [...repoFiles, ...jsonFiles]) {
      const rel = relative(ROOT, filePath);
      if (rel === "tests/repo-hygiene.test.ts") continue;
      const content = readFileSync(filePath, "utf-8");
      const m = stripeWebhookLike.exec(content);
      if (m) {
        hits.push(`${rel}: contains secret-scanner-triggering literal "${m[0]}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("each planted trap fact is present in data/seed and absent from data/seed-clean", () => {
    const loadSeedJson = (dir: "seed" | "seed-clean", file: string): Record<string, any>[] =>
      JSON.parse(readFileSync(join(ROOT, "data", dir, file), "utf-8"));

    interface PlantedTrapEntry {
      id: string;
      file: string;
      pkField: string;
      pkValue: string;
      field: string;
      expectedSubstring?: string;
      expectedValue?: unknown;
    }

    const TRAP_MANIFEST: PlantedTrapEntry[] = [
      {
        id: "TRAP-MSG-040-ATTORNEY-ADEQUACY",
        file: "communications.json",
        pkField: "message_id",
        pkValue: "MSG-040",
        field: "body",
        expectedSubstring: "demand letter for $750,000",
      },
      {
        id: "TRAP-MSG-041-SUIT-OSHA",
        file: "communications.json",
        pkField: "message_id",
        pkValue: "MSG-041",
        field: "transcript",
        expectedSubstring: "threatening to sue us",
      },
      {
        id: "TRAP-MSG-042-ATTORNEY-COMPLETED-OPS",
        file: "communications.json",
        pkField: "message_id",
        pkValue: "MSG-042",
        field: "body",
        expectedSubstring: "demand letter from an attorney",
      },
      {
        id: "TRAP-MSG-043-KIM-5M-GL",
        file: "communications.json",
        pkField: "message_id",
        pkValue: "MSG-043",
        field: "transcript",
        expectedSubstring: "require $5 million in general liability",
      },
      {
        id: "TRAP-CLM-12-SIU-FRAUD",
        file: "claims.json",
        pkField: "claim_id",
        pkValue: "CLM-2026-000012",
        field: "notes",
        expectedSubstring: "SIU review recommended",
      },
      {
        id: "TRAP-CLM-13-LAPSED-POLICY",
        file: "claims.json",
        pkField: "claim_id",
        pkValue: "CLM-2026-000013",
        field: "notes",
        expectedSubstring: "POL-PA-2025-005100 expired 2025-12-15",
      },
      {
        id: "TRAP-CLM-14-MOLD-EXCLUSION",
        file: "claims.json",
        pkField: "claim_id",
        pkValue: "CLM-2026-000014",
        field: "notes",
        expectedSubstring: "fungi and mold remediation exclusion",
      },
      {
        id: "TRAP-DOC-011-UNSIGNED-APP",
        file: "documents.json",
        pkField: "document_id",
        pkValue: "DOC-011",
        field: "status",
        expectedValue: "pending_signature",
      },
      {
        id: "TRAP-DOC-033-EXPIRED-DL",
        file: "documents.json",
        pkField: "document_id",
        pkValue: "DOC-033",
        field: "status",
        expectedValue: "expired",
      },
      {
        id: "TRAP-DOC-053-PENDING-COI",
        file: "documents.json",
        pkField: "document_id",
        pkValue: "DOC-053",
        field: "audit_flag",
        expectedValue: "missing_coi",
      },
      {
        id: "TRAP-DOC-066-UNSIGNED-UM-FORM",
        file: "documents.json",
        pkField: "document_id",
        pkValue: "DOC-066",
        field: "status",
        expectedValue: "pending_signature",
      },
      {
        id: "TRAP-CLI-030-DUPLICATE-CHEN",
        file: "clients.json",
        pkField: "id",
        pkValue: "CLI-030",
        field: "email",
        expectedValue: "s.chen@gmail.com",
      },
      {
        id: "TRAP-CLI-031-DUPLICATE-HAWKINS",
        file: "clients.json",
        pkField: "id",
        pkValue: "CLI-031",
        field: "email",
        expectedValue: "derek.hawkins@gmail.com",
      },
    ];

    for (const entry of TRAP_MANIFEST) {
      const seedRows = loadSeedJson("seed", entry.file);
      const cleanRows = loadSeedJson("seed-clean", entry.file);
      const seedRow = seedRows.find((r) => r[entry.pkField] === entry.pkValue);
      expect(seedRow, `${entry.id} missing in data/seed/${entry.file}`).toBeDefined();

      const cleanRow = cleanRows.find((r) => r[entry.pkField] === entry.pkValue);
      if (entry.expectedSubstring !== undefined) {
        expect(String(seedRow![entry.field] ?? "")).toContain(entry.expectedSubstring);
        expect(String(cleanRow?.[entry.field] ?? "")).not.toContain(entry.expectedSubstring);
      } else {
        expect(seedRow![entry.field]).toEqual(entry.expectedValue);
        expect(cleanRow?.[entry.field]).not.toEqual(entry.expectedValue);
      }
    }

    // E-13: seed data must never self-label traps with "E&O TRIGGER"
    for (const dir of ["seed", "seed-clean"] as const) {
      for (const file of readdirSync(join(ROOT, "data", dir)).filter((f) => f.endsWith(".json"))) {
        const raw = readFileSync(join(ROOT, "data", dir, file), "utf-8");
        expect(raw.toUpperCase()).not.toContain("E&O TRIGGER");
      }
    }
  });

  test("eval/metr/tasks.json prompts stay in sync with eval/scenarios/*.ts", async () => {
    const { scenarios } = await import("../eval/scenarios/index");
    const tasks = JSON.parse(readFileSync(join(ROOT, "eval", "metr", "tasks.json"), "utf-8")) as Record<
      string,
      { prompt: string; case_id: string }
    >;
    let expectedCount = 0;
    for (const [id, scenario] of Object.entries(scenarios)) {
      for (const [seed, variant] of Object.entries(scenario.variants)) {
        for (const testCase of variant.cases) {
          expectedCount++;
          const taskId = `${id}-${seed}-${testCase.difficulty}`;
          expect(tasks[taskId], `Missing ${taskId} in eval/metr/tasks.json`).toBeDefined();
          expect(tasks[taskId]!.prompt, `Stale prompt for ${taskId} in eval/metr/tasks.json`).toBe(
            testCase.prompt,
          );
          expect(tasks[taskId]!.case_id).toBe(testCase.id);
        }
      }
    }
    expect(Object.keys(tasks).length).toBe(expectedCount);
  });
});
