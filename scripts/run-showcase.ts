import { resolve } from "path";
import { existsSync } from "fs";

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
  return {
    ready: missingFiles.length === 0,
    checkedServices: SHOWCASE_SERVICES.length,
    missingFiles,
  };
}

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has("--check") || args.has("--dry-run");
  const seedMode = process.env.SEED_MODE || "realistic";

  const readiness = verifyShowcaseReadiness();
  if (!readiness.ready) {
    console.error("Missing showcase service files:", readiness.missingFiles);
    process.exit(1);
  }

  console.log("================================================================================");
  console.log("  EVERGREEN INSURANCE PARTNERS — EXECUTIVE OPERATIONS & GOVERNANCE SHOWCASE");
  console.log("================================================================================");
  for (const svc of SHOWCASE_SERVICES) {
    console.log(
      `  [http://localhost:${svc.port}] ${svc.name.padEnd(16)} — ${svc.role}`,
    );
  }
  console.log("--------------------------------------------------------------------------------");
  console.log("  Executive Workbench:  http://localhost:3000/");
  console.log("  Summit Portal UI:     http://localhost:3005/");
  console.log("  Coastal Portal UI:    http://localhost:3006/");
  console.log("  Executive Scorecard:  docs/executive-scorecard.html");
  console.log("================================================================================");

  if (checkOnly) {
    console.log(
      `Showcase preflight check passed (${readiness.checkedServices}/8 services verified).`,
    );
    process.exit(0);
  }

  // Seed all 8 services with realistic data if requested
  const jwtSecret = process.env.JWT_SECRET ?? "dev-secret";
  if (!args.has("--no-seed")) {
    console.log(`Seeding all 8 services (SEED_MODE=${seedMode})...`);
    for (const svc of SHOWCASE_SERVICES) {
      const proc = Bun.spawnSync([process.execPath, "run", resolve(rootDir, svc.seedScript)], {
        cwd: resolve(rootDir, svc.dir),
        env: { ...process.env, SEED_MODE: seedMode, JWT_SECRET: jwtSecret },
      });
      if (proc.exitCode !== 0) {
        console.error(
          `Seed for ${svc.name} failed with exit code ${proc.exitCode}:\n${proc.stderr.toString()}`,
        );
        process.exit(1);
      }
    }
  }

  // Launch all 8 services
  const children = SHOWCASE_SERVICES.map((svc) =>
    Bun.spawn([process.execPath, "run", resolve(rootDir, svc.entrypoint)], {
      cwd: resolve(rootDir, svc.dir),
      env: {
        ...process.env,
        PORT: String(svc.port),
        SEED_MODE: seedMode,
        JWT_SECRET: jwtSecret,
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
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await Promise.all(children.map((c) => c.exited));
}
