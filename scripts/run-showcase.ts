import { join, resolve } from "path";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

export interface ShowcaseServiceConfig {
  name: string;
  port: number;
  dir: string;
  entrypoint: string;
  seedScript: string;
  role: string;
}

export const SHOWCASE_SERVICES: ShowcaseServiceConfig[] = [
  {
    name: "ams",
    port: 3000,
    dir: "services/ams",
    entrypoint: "services/ams/src/index.ts",
    seedScript: "services/ams/src/seed.ts",
    role: "Agency Management System + Executive Operations & Governance Workbench (GET /)",
  },
  {
    name: "rater",
    port: 3001,
    dir: "services/rater",
    entrypoint: "services/rater/src/index.ts",
    seedScript: "services/rater/src/seed.ts",
    role: "Comparative Multi-Carrier Rater + 1st-Line E&O Firewall",
  },
  {
    name: "crm",
    port: 3002,
    dir: "services/crm",
    entrypoint: "services/crm/src/index.ts",
    seedScript: "services/crm/src/seed.ts",
    role: "Agency CRM, Lead Scoring & Retention Campaigns",
  },
  {
    name: "ecm",
    port: 3003,
    dir: "services/ecm",
    entrypoint: "services/ecm/src/index.ts",
    seedScript: "services/ecm/src/seed.ts",
    role: "Enterprise Content Management + Real ACORD 25 PDF Generator",
  },
  {
    name: "comm",
    port: 3004,
    dir: "services/comm",
    entrypoint: "services/comm/src/index.ts",
    seedScript: "services/comm/src/seed.ts",
    role: "Omnichannel Communications Hub (REST + MCP JSON-RPC 2.0)",
  },
  {
    name: "carrier-summit",
    port: 3005,
    dir: "services/carrier-summit",
    entrypoint: "services/carrier-summit/src/index.ts",
    seedScript: "services/carrier-summit/src/seed.ts",
    role: "Summit Fire & Casualty — Commercial Agent Web Portal",
  },
  {
    name: "carrier-coastal",
    port: 3006,
    dir: "services/carrier-coastal",
    entrypoint: "services/carrier-coastal/src/index.ts",
    seedScript: "services/carrier-coastal/src/seed.ts",
    role: "Coastal Star Auto — Personal Auto Agent Web Portal",
  },
  {
    name: "claims",
    port: 3007,
    dir: "services/claims",
    entrypoint: "services/claims/src/index.ts",
    seedScript: "services/claims/src/seed.ts",
    role: "Claims FNOL, Adjuster Assignment & SIU Fraud Triage",
  },
];

const rootDir = resolve(import.meta.dir, "..");

const REQUIRED_PORTAL_UI_FILES = [
  "services/carrier-summit/public/index.html",
  "services/carrier-coastal/public/index.html",
];

export function verifyShowcaseReadiness(): {
  ready: boolean;
  checkedServices: number;
  missingFiles: string[];
} {
  const missingFiles: string[] = [];
  for (const svc of SHOWCASE_SERVICES) {
    const ep = resolve(rootDir, svc.entrypoint);
    const seed = resolve(rootDir, svc.seedScript);
    if (!existsSync(ep)) missingFiles.push(svc.entrypoint);
    if (!existsSync(seed)) missingFiles.push(svc.seedScript);
  }
  for (const portalFile of REQUIRED_PORTAL_UI_FILES) {
    if (!existsSync(resolve(rootDir, portalFile))) {
      missingFiles.push(portalFile);
    }
  }
  return {
    ready: missingFiles.length === 0,
    checkedServices: SHOWCASE_SERVICES.length,
    missingFiles,
  };
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }
  const eqPrefix = `${flag}=`;
  const match = argv.find((a) => a.startsWith(eqPrefix));
  return match ? match.slice(eqPrefix.length) : undefined;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const checkOnly = args.has("--check") || args.has("--dry-run");
  const seedMode = process.env.SEED_MODE || "realistic";
  const modalityMode = args.has("--strict")
    ? "strict"
    : process.env.MODALITY_MODE || "permissive";

  const basePortRaw = readFlagValue(argv, "--base-port") ?? process.env.EVERGREEN_BASE_PORT;
  const basePort = basePortRaw ? parseInt(basePortRaw, 10) : 3000;
  if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65500) {
    console.error(`Invalid --base-port value: ${basePortRaw}`);
    process.exit(1);
  }

  const dataDirArg = readFlagValue(argv, "--data-dir") ?? process.env.EVERGREEN_DATA_DIR;
  const inPlaceDb = args.has("--in-place-db");

  const readiness = verifyShowcaseReadiness();
  if (!readiness.ready) {
    console.error("Missing showcase service files:", readiness.missingFiles);
    process.exit(1);
  }

  const runtimeServices = SHOWCASE_SERVICES.map((svc, idx) => ({
    ...svc,
    port: basePort + idx,
  }));

  console.log("================================================================================");
  console.log("  EVERGREEN INSURANCE PARTNERS — EXECUTIVE OPERATIONS & GOVERNANCE SHOWCASE");
  console.log("================================================================================");
  for (const svc of runtimeServices) {
    console.log(
      `  [http://localhost:${svc.port}] ${svc.name.padEnd(16)} — ${svc.role}`,
    );
  }
  console.log("--------------------------------------------------------------------------------");
  console.log(`  Executive Workbench:  http://localhost:${basePort}/`);
  console.log(`  Summit Portal UI:     http://localhost:${basePort + 5}/`);
  console.log(`  Coastal Portal UI:    http://localhost:${basePort + 6}/`);
  console.log("  Executive Scorecard:  docs/executive-scorecard.html");
  console.log("================================================================================");

  if (checkOnly) {
    console.log(
      `Showcase preflight check passed (${readiness.checkedServices}/8 services + 2 portal UIs verified).`,
    );
    process.exit(0);
  }

  let ephemeralDataDir: string | null = null;
  let effectiveDataDir: string | undefined;
  if (dataDirArg) {
    effectiveDataDir = resolve(dataDirArg);
    mkdirSync(effectiveDataDir, { recursive: true });
  } else if (!inPlaceDb) {
    ephemeralDataDir = mkdtempSync(join(tmpdir(), "evergreen-showcase-"));
    effectiveDataDir = ephemeralDataDir;
  }

  const jwtSecret = process.env.JWT_SECRET ?? "dev-secret";
  const sharedStackEnv: Record<string, string | undefined> = {
    ...process.env,
    SEED_MODE: seedMode,
    MODALITY_MODE: modalityMode,
    JWT_SECRET: jwtSecret,
    EVERGREEN_BASE_PORT: String(basePort),
    ...(effectiveDataDir ? { EVERGREEN_DATA_DIR: effectiveDataDir } : {}),
    AMS_BASE_URL: `http://localhost:${basePort}`,
    AMS_URL: `http://localhost:${basePort}`,
    RATER_BASE_URL: `http://localhost:${basePort + 1}`,
    CRM_BASE_URL: `http://localhost:${basePort + 2}`,
    ECM_BASE_URL: `http://localhost:${basePort + 3}`,
    ECM_URL: `http://localhost:${basePort + 3}`,
    COMM_BASE_URL: `http://localhost:${basePort + 4}`,
    SUMMIT_BASE_URL: `http://localhost:${basePort + 5}`,
    COASTAL_BASE_URL: `http://localhost:${basePort + 6}`,
    CLAIMS_BASE_URL: `http://localhost:${basePort + 7}`,
    CLAIMS_URL: `http://localhost:${basePort + 7}`,
  };

  if (!args.has("--no-seed")) {
    console.log(
      `Seeding all 8 services (SEED_MODE=${seedMode}${effectiveDataDir ? `, EVERGREEN_DATA_DIR=${effectiveDataDir}` : ""})...`,
    );
    for (const svc of runtimeServices) {
      const proc = Bun.spawnSync([process.execPath, "run", resolve(rootDir, svc.seedScript)], {
        cwd: resolve(rootDir, svc.dir),
        env: sharedStackEnv,
      });
      if (proc.exitCode !== 0) {
        console.error(
          `Seed for ${svc.name} failed with exit code ${proc.exitCode}:\n${proc.stderr.toString()}`,
        );
        if (ephemeralDataDir) {
          rmSync(ephemeralDataDir, { recursive: true, force: true });
        }
        process.exit(1);
      }
    }
  }

  // Launch all 8 services
  const children = runtimeServices.map((svc) =>
    Bun.spawn([process.execPath, "run", resolve(rootDir, svc.entrypoint)], {
      cwd: resolve(rootDir, svc.dir),
      env: {
        ...sharedStackEnv,
        PORT: String(svc.port),
      },
      stdout: "inherit",
      stderr: "inherit",
    }),
  );

  const shutdown = () => {
    console.log("\nShutting down Evergreen Showcase services...");
    for (const child of children) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
    if (ephemeralDataDir) {
      try {
        rmSync(ephemeralDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await Promise.all(children.map((c) => c.exited));
}
