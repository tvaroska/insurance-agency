import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import YAML from "yaml";
import { ESCALATION_REASONS } from "../../services/ams/src/routes/escalations";

describe("Escalation reason_code contract across scenarios and specs", () => {
  const validReasons = new Set<string>(ESCALATION_REASONS);

  it("matches specs/ams.yaml EscalationCreate.reason enum", () => {
    const amsSpecPath = join(import.meta.dir, "../../specs/ams.yaml");
    const spec = YAML.parse(readFileSync(amsSpecPath, "utf-8"));
    const createEnum: string[] =
      spec.components.schemas.EscalationCreate.properties.reason.enum;
    const modelEnum: string[] =
      spec.components.schemas.Escalation.properties.reason.enum;
    for (const r of createEnum) {
      expect(validReasons.has(r)).toBe(true);
    }
    for (const r of modelEnum) {
      expect(validReasons.has(r)).toBe(true);
    }
  });

  it("every reason_code / escalation reason literal in eval/scenarios/*.ts is accepted by AMS", () => {
    const scenariosDir = join(import.meta.dir, "../scenarios");
    const files = readdirSync(scenariosDir).filter(
      (f) => f.endsWith(".ts") && /^\d{2}-/.test(f),
    );
    expect(files.length).toBe(20);

    const reasonPattern = /\breason(?:_code)?\s*[:=]\s*['"]([a-z_]+)['"]/g;
    const invalid: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(scenariosDir, file), "utf-8");
      for (const match of text.matchAll(reasonPattern)) {
        const token = match[1];
        if (!validReasons.has(token)) {
          invalid.push(`${file}:${token}`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });
});
