import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse, parseAllDocuments } from "yaml";

const ROOT = join(import.meta.dir, "..");
const K8S_DIR = join(ROOT, "k8s");

const SERVICES = [
  { name: "ams", port: 3000, db: "ams", secretKey: "DATABASE_URL_AMS" },
  { name: "rater", port: 3001, db: "rater", secretKey: "DATABASE_URL_RATER" },
  { name: "crm", port: 3002, db: "crm", secretKey: "DATABASE_URL_CRM" },
  { name: "ecm", port: 3003, db: "ecm", secretKey: "DATABASE_URL_ECM" },
  { name: "comm", port: 3004, db: "comm", secretKey: "DATABASE_URL_COMM" },
  {
    name: "carrier-summit",
    port: 3005,
    db: "carrier_summit",
    secretKey: "DATABASE_URL_CARRIER_SUMMIT",
  },
  {
    name: "carrier-coastal",
    port: 3006,
    db: "carrier_coastal",
    secretKey: "DATABASE_URL_CARRIER_COASTAL",
  },
  { name: "claims", port: 3007, db: "claims", secretKey: "DATABASE_URL_CLAIMS" },
] as const;

describe("S2-K8S-1: CloudNativePG PostgreSQL Cluster (k8s/postgres.yaml)", () => {
  const pgPath = join(K8S_DIR, "postgres.yaml");

  test("postgres.yaml exists and is valid YAML", () => {
    expect(existsSync(pgPath)).toBe(true);
    const doc = parse(readFileSync(pgPath, "utf-8"));
    expect(doc.apiVersion).toBe("postgresql.cnpg.io/v1");
    expect(doc.kind).toBe("Cluster");
    expect(doc.metadata.name).toBe("evergreen-pg");
  });

  test("configures 1 instance, 2Gi storage, owner evergreen, and all 8 databases", () => {
    const doc = parse(readFileSync(pgPath, "utf-8"));
    expect(doc.spec.instances).toBe(1);
    expect(doc.spec.storage.size).toBe("2Gi");
    expect(doc.spec.bootstrap.initdb.database).toBe("ams");
    expect(doc.spec.bootstrap.initdb.owner).toBe("evergreen");

    const postInitSql: string[] =
      doc.spec.bootstrap.initdb.postInitApplicationSQL;
    expect(Array.isArray(postInitSql)).toBe(true);
    const joinedSql = postInitSql.join("\n");
    for (const svc of SERVICES) {
      if (svc.db !== "ams") {
        expect(joinedSql).toContain(`CREATE DATABASE ${svc.db}`);
      }
      expect(joinedSql).toContain(
        `GRANT ALL PRIVILEGES ON DATABASE ${svc.db} TO evergreen`,
      );
    }
  });
});

describe("S2-K8S-2: ConfigMap, Secret, and 8 Service Manifests", () => {
  test("k8s/configmap.yaml defines evergreen-config with SEED_MODE, MODALITY_MODE, and service URLs", () => {
    const cmPath = join(K8S_DIR, "configmap.yaml");
    expect(existsSync(cmPath)).toBe(true);
    const cm = parse(readFileSync(cmPath, "utf-8"));
    expect(cm.apiVersion).toBe("v1");
    expect(cm.kind).toBe("ConfigMap");
    expect(cm.metadata.name).toBe("evergreen-config");
    expect(cm.data.SEED_MODE).toBe("realistic");
    expect(cm.data.MODALITY_MODE).toBe("permissive");
    expect(cm.data.AMS_BASE_URL).toBe("http://ams:3000");
    expect(cm.data.AMS_URL).toBe("http://ams:3000");
    expect(cm.data.CLAIMS_URL).toBe("http://claims:3007");
  });

  test("k8s/secret.yaml defines evergreen-secrets with JWT_SECRET and per-service DATABASE_URLs", () => {
    const secPath = join(K8S_DIR, "secret.yaml");
    expect(existsSync(secPath)).toBe(true);
    const sec = parse(readFileSync(secPath, "utf-8"));
    expect(sec.apiVersion).toBe("v1");
    expect(sec.kind).toBe("Secret");
    expect(sec.metadata.name).toBe("evergreen-secrets");
    expect(sec.stringData.JWT_SECRET).toBeDefined();
    for (const svc of SERVICES) {
      expect(sec.stringData[svc.secretKey]).toContain(
        `evergreen-pg-rw:5432/${svc.db}`,
      );
    }
  });

  for (const svc of SERVICES) {
    test(`k8s/services/${svc.name}.yaml defines Deployment and ClusterIP Service on port ${svc.port}`, () => {
      const svcPath = join(K8S_DIR, "services", `${svc.name}.yaml`);
      expect(existsSync(svcPath)).toBe(true);
      const docs = parseAllDocuments(readFileSync(svcPath, "utf-8")).map((d) =>
        d.toJSON(),
      );
      expect(docs.length).toBe(2);

      const deployment = docs.find((d) => d.kind === "Deployment");
      const service = docs.find((d) => d.kind === "Service");
      expect(deployment).toBeDefined();
      expect(service).toBeDefined();

      expect(deployment.metadata.name).toBe(svc.name);
      const container = deployment.spec.template.spec.containers[0];
      expect(container.name).toBe(svc.name);
      expect(container.image).toBe(`evergreen/${svc.name}:latest`);
      expect(container.ports[0].containerPort).toBe(svc.port);
      expect(container.livenessProbe.httpGet.path).toBe("/health");
      expect(container.livenessProbe.httpGet.port).toBe(svc.port);
      expect(container.readinessProbe.httpGet.path).toBe("/health");
      expect(container.readinessProbe.httpGet.port).toBe(svc.port);

      const dbEnv = container.env.find((e: any) => e.name === "DATABASE_URL");
      expect(dbEnv.valueFrom.secretKeyRef.name).toBe("evergreen-secrets");
      expect(dbEnv.valueFrom.secretKeyRef.key).toBe(svc.secretKey);

      expect(service.metadata.name).toBe(svc.name);
      expect(service.spec.type).toBe("ClusterIP");
      expect(service.spec.ports[0].port).toBe(svc.port);
      expect(service.spec.ports[0].targetPort).toBe(svc.port);
    });
  }
});

describe("S2-K8S-3: Seed Job (k8s/seed-job.yaml)", () => {
  test("seed-job.yaml defines batch/v1 Job with wait-for-pg initContainer and 8 seed containers", () => {
    const jobPath = join(K8S_DIR, "seed-job.yaml");
    expect(existsSync(jobPath)).toBe(true);
    const job = parse(readFileSync(jobPath, "utf-8"));
    expect(job.apiVersion).toBe("batch/v1");
    expect(job.kind).toBe("Job");
    expect(job.metadata.name).toBe("evergreen-seed-job");

    const podSpec = job.spec.template.spec;
    expect(podSpec.initContainers.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(podSpec.initContainers[0])).toContain(
      "evergreen-pg-rw",
    );

    expect(podSpec.containers.length).toBe(8);
    for (const svc of SERVICES) {
      const c = podSpec.containers.find(
        (cnt: any) => cnt.name === `seed-${svc.name}`,
      );
      expect(c).toBeDefined();
      expect(c.image).toBe(`evergreen/${svc.name}:latest`);
    }
  });
});

describe("S2-K8S-4: Kustomize Base, Overlays, and README", () => {
  test("base k8s/kustomization.yaml references all manifests", () => {
    const kustPath = join(K8S_DIR, "kustomization.yaml");
    expect(existsSync(kustPath)).toBe(true);
    const kust = parse(readFileSync(kustPath, "utf-8"));
    expect(kust.kind).toBe("Kustomization");
    expect(kust.resources).toContain("postgres.yaml");
    expect(kust.resources).toContain("configmap.yaml");
    expect(kust.resources).toContain("secret.yaml");
    expect(kust.resources).toContain("seed-job.yaml");
    for (const svc of SERVICES) {
      expect(kust.resources).toContain(`services/${svc.name}.yaml`);
    }
  });

  test("clean, realistic, and ingress overlays exist and are valid", () => {
    const cleanPath = join(K8S_DIR, "overlays", "clean", "kustomization.yaml");
    const realisticPath = join(
      K8S_DIR,
      "overlays",
      "realistic",
      "kustomization.yaml",
    );
    const ingressKustPath = join(
      K8S_DIR,
      "overlays",
      "ingress",
      "kustomization.yaml",
    );
    const ingressYamlPath = join(K8S_DIR, "overlays", "ingress", "ingress.yaml");

    expect(existsSync(cleanPath)).toBe(true);
    expect(existsSync(realisticPath)).toBe(true);
    expect(existsSync(ingressKustPath)).toBe(true);
    expect(existsSync(ingressYamlPath)).toBe(true);

    const cleanKust = parse(readFileSync(cleanPath, "utf-8"));
    expect(JSON.stringify(cleanKust)).toContain("clean");

    const realisticKust = parse(readFileSync(realisticPath, "utf-8"));
    expect(JSON.stringify(realisticKust)).toContain("realistic");

    const ingress = parse(readFileSync(ingressYamlPath, "utf-8"));
    expect(ingress.apiVersion).toBe("networking.k8s.io/v1");
    expect(ingress.kind).toBe("Ingress");
    const paths = ingress.spec.rules[0].http.paths;
    expect(paths.length).toBe(8);
  });

  test("k8s/README.md documents CloudNativePG prerequisites and kubectl commands", () => {
    const readmePath = join(K8S_DIR, "README.md");
    expect(existsSync(readmePath)).toBe(true);
    const readme = readFileSync(readmePath, "utf-8");
    expect(readme).toContain("CloudNativePG");
    expect(readme).toContain("kubectl apply -k k8s/overlays/realistic");
  });
});

describe("S2-COMPOSE-1: Docker Compose PG Override & Init SQL", () => {
  test("scripts/init-pg-dbs.sql creates all 8 databases", () => {
    const sqlPath = join(ROOT, "scripts", "init-pg-dbs.sql");
    expect(existsSync(sqlPath)).toBe(true);
    const sql = readFileSync(sqlPath, "utf-8");
    for (const svc of SERVICES) {
      expect(sql).toContain(`CREATE DATABASE ${svc.db}`);
    }
  });

  test("docker-compose.pg.yaml adds postgres service and overrides DATABASE_URL on all 8 services", () => {
    const composePath = join(ROOT, "docker-compose.pg.yaml");
    expect(existsSync(composePath)).toBe(true);
    const compose = parse(readFileSync(composePath, "utf-8"));
    expect(compose.services.postgres).toBeDefined();
    expect(compose.services.postgres.image).toBe("postgres:16-alpine");
    expect(JSON.stringify(compose.services.postgres.volumes)).toContain(
      "init-pg-dbs.sql",
    );

    for (const svc of SERVICES) {
      const s = compose.services[svc.name];
      expect(s).toBeDefined();
      expect(s.environment.DATABASE_URL).toContain(
        `postgres:5432/${svc.db}`,
      );
      expect(s.depends_on.postgres.condition).toBe("service_healthy");
    }
  });
});

describe("Cloud Build CI Pipeline (cloudbuild.yaml)", () => {
  test("cloudbuild.yaml exists, is valid YAML, and includes TEST_DATABASE_URL step", () => {
    const cbPath = join(ROOT, "cloudbuild.yaml");
    expect(existsSync(cbPath)).toBe(true);
    const cb = parse(readFileSync(cbPath, "utf-8"));
    expect(Array.isArray(cb.steps)).toBe(true);
    expect(cb.steps.length).toBeGreaterThanOrEqual(3);
    const cbRaw = readFileSync(cbPath, "utf-8");
    expect(cbRaw).toContain("TEST_DATABASE_URL");
    expect(cbRaw).toContain("tests/k8s-manifests.test.ts");
  });
});
