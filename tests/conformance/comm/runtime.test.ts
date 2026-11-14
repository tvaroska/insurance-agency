import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../harness";

// These tests start the service the way the repository's scripts do, through
// the package manifest, so they run their own child processes.
const SERVICE = "comm";
const DB_FILE = "comm.db";
const DEFAULT_PORT = 3004;
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
  test("COMM-R51: the manifest's start script serves HTTP on the port named by PORT", async () => {
    const url = await launch({ EVERGREEN_DATA_DIR: tempDir() });
    expect(Number(new URL(url).port)).not.toBe(DEFAULT_PORT);
    const health = await fetch(`${url}/health`);
    expect(((await health.json()) as any).service).toBe(SERVICE);
  }, 30_000);

  test("COMM-R52: the database file is <EVERGREEN_DATA_DIR>/comm.db, created on first use", async () => {
    const dataDir = join(tempDir(), "nested", "data");
    const url = await launch({ EVERGREEN_DATA_DIR: dataDir });
    expect((await post(url, "/sim/reset", { seed_mode: "clean" })).status).toBe(200);
    expect(existsSync(join(dataDir, DB_FILE))).toBe(true);
    expect((await tables(url)).messages).toHaveLength(42);
  }, 30_000);

  test("COMM-R52: DATABASE_URL takes precedence over EVERGREEN_DATA_DIR", async () => {
    const dataDir = tempDir();
    const dbPath = join(tempDir(), "elsewhere", "custom.db");
    const url = await launch({ EVERGREEN_DATA_DIR: dataDir, DATABASE_URL: `file:${dbPath}` });
    expect((await post(url, "/sim/reset")).status).toBe(200);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(join(dataDir, DB_FILE))).toBe(false);
  }, 30_000);

  test("COMM-R53: the seed script rebuilds the tables of the configured database from the set named by SEED_MODE", async () => {
    const dbUrl = `file:${join(tempDir(), "seeded.db")}`;
    const url = await launch({ DATABASE_URL: dbUrl });
    expect((await post(url, "/sim/seed", { base: "empty" })).status).toBe(200);
    await post(url, "/sim/seed", {
      base: "empty",
      tables: { webhooks: [{ webhook_id: "whk_old", url: "https://hooks.example.com", events: "[]", secret: "whsec_x", created_at: "2026-01-01T00:00:00.000Z" }] },
    });
    expect((await tables(url)).messages).toEqual([]);

    expect(await runSeedScript({ DATABASE_URL: dbUrl, SEED_MODE: "clean" })).toBe(0);
    let after = await tables(url);
    expect(after.messages).toHaveLength(42);
    expect(after.webhooks).toEqual([]);

    for (const mode of [undefined, "demo"]) {
      expect(await runSeedScript({ DATABASE_URL: dbUrl, SEED_MODE: "clean" })).toBe(0);
      expect((await tables(url)).messages).toHaveLength(42);
      expect(await runSeedScript({ DATABASE_URL: dbUrl, ...(mode ? { SEED_MODE: mode } : {}) })).toBe(0);
      after = await tables(url);
      expect(after.messages).toHaveLength(44);
      expect(after.messages.map((m: any) => m.message_id)).toContain("MSG-038");
    }
  }, 60_000);
});
