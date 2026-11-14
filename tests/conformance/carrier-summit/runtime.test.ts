import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../harness";

// These tests start the service the way the repository's scripts do, through
// the package manifest, so they run their own child processes.
const SERVICE = "carrier-summit";
const DB_FILE = "carrier-summit.db";
const DEFAULT_PORT = 3005;
const PACKAGE_DIR = join(import.meta.dir, "..", "..", "..", "services", SERVICE);

const children: { kill(): void }[] = [];
const scratch: string[] = [];
afterAll(() => {
  for (const child of children) child.kill();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `conformance-${SERVICE}-runtime-`));
  scratch.push(dir);
  return dir;
}

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

function baseEnv(extra: Record<string, string>): Record<string, string> {
  return { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_PROXY: "127.0.0.1,localhost", ...extra };
}

async function launch(env: Record<string, string>): Promise<string> {
  // The probed port can be taken before the child binds it, so a start that
  // exits or stays silent is retried on another port.
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const port = freePort();
    const child = Bun.spawn([process.execPath, "run", "start"], {
      cwd: PACKAGE_DIR,
      env: baseEnv({ PORT: String(port), ...env }),
      stdout: "ignore",
      stderr: "pipe",
    });
    children.push(child);
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100 && child.exitCode === null; i++) {
      try {
        const res = await fetch(`${url}/health`);
        if (res.status === 200 && ((await res.json()) as any).service === SERVICE) return url;
      } catch {
        // not listening yet
      }
      await Bun.sleep(50);
    }
    child.kill();
    last = `port ${port}: ${(await new Response(child.stderr).text()).slice(-400)}`;
  }
  throw new Error(`${SERVICE} did not start (${last})`);
}

async function runSeedScript(env: Record<string, string>): Promise<number> {
  const child = Bun.spawn([process.execPath, "run", "seed"], {
    cwd: PACKAGE_DIR,
    env: baseEnv(env),
    stdout: "ignore",
    stderr: "ignore",
  });
  return child.exited;
}

const post = (url: string, path: string, body: unknown = {}) =>
  fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const tables = async (url: string) => ((await (await fetch(`${url}/sim/snapshot`)).json()) as any).tables;

describe("runtime contract", () => {
  test("SMT-R51: the manifest's start script serves the API and the page on the port named by PORT", async () => {
    const url = await launch({ EVERGREEN_DATA_DIR: tempDir() });
    expect(Number(new URL(url).port)).not.toBe(DEFAULT_PORT);
    expect(((await (await fetch(`${url}/health`)).json()) as any).service).toBe(SERVICE);
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root"></div>');
  }, 30_000);

  test("SMT-R52: the database file is <EVERGREEN_DATA_DIR>/carrier-summit.db, created on first use", async () => {
    const dataDir = join(tempDir(), "nested", "data");
    const url = await launch({ EVERGREEN_DATA_DIR: dataDir });
    expect((await post(url, "/sim/reset", { seed_mode: "clean" })).status).toBe(200);
    expect(existsSync(join(dataDir, DB_FILE))).toBe(true);
    expect((await tables(url)).quotes).toHaveLength(14);
  }, 30_000);

  test("SMT-R52: DATABASE_URL takes precedence over EVERGREEN_DATA_DIR", async () => {
    const dataDir = tempDir();
    const dbPath = join(tempDir(), "elsewhere", "custom.db");
    const url = await launch({ EVERGREEN_DATA_DIR: dataDir, DATABASE_URL: `file:${dbPath}` });
    expect((await post(url, "/sim/reset")).status).toBe(200);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(join(dataDir, DB_FILE))).toBe(false);
  }, 30_000);

  test("SMT-R53: the seed script rebuilds the tables of the configured database from the set named by SEED_MODE", async () => {
    const dbUrl = `file:${join(tempDir(), "seeded.db")}`;
    const url = await launch({ DATABASE_URL: dbUrl });
    expect((await post(url, "/sim/seed", { base: "empty" })).status).toBe(200);
    const leftover = {
      quote_id: "QT-LEFTOVER", request_id: "QR-0", client_id: "CLI-0", policy_type: "homeowners", coverages: "[]", deductibles: "{}",
      submitted_at: "2026-01-01T00:00:00Z",
    };
    expect((await post(url, "/sim/seed", { base: "empty", tables: { quotes: [leftover] } })).status).toBe(200);
    expect((await tables(url)).quotes).toHaveLength(1);

    for (const mode of ["clean", undefined]) {
      expect(await runSeedScript({ DATABASE_URL: dbUrl, ...(mode ? { SEED_MODE: mode } : {}) })).toBe(0);
      const after = await tables(url);
      expect(after.quotes).toHaveLength(14);
      expect(after.quotes.map((q: any) => q.quote_id)).not.toContain("QT-LEFTOVER");
      expect(after.policies).toHaveLength(17);
      expect(after.policy_documents).toHaveLength(51);
      expect(after.underwriting_conditions).toEqual([]);
    }
  }, 60_000);
});
