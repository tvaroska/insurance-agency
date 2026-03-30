/**
 * Builds operationId → HTTP operation mapping from OpenAPI specs.
 * Used as fallback when GenAI traces don't include _http metadata.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import type { ToolMapping } from "./types";
import { PORT_SERVICE_MAP } from "./types";

const SPECS_DIR = join(import.meta.dir, "..", "specs");

interface OpenApiSpec {
  servers?: { url: string }[];
  paths?: Record<string, Record<string, { operationId?: string }>>;
}

function serviceFromUrl(url: string): string {
  try {
    const port = parseInt(new URL(url).port, 10);
    return PORT_SERVICE_MAP[port] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function loadToolMapping(specsDir = SPECS_DIR): ToolMapping {
  const mapping: ToolMapping = {};
  const files = readdirSync(specsDir).filter((f) => f.endsWith(".yaml"));

  for (const file of files) {
    const raw = readFileSync(join(specsDir, file), "utf-8");
    const spec: OpenApiSpec = parse(raw);
    const baseUrl = spec.servers?.[0]?.url ?? "http://localhost:3000";
    const service = serviceFromUrl(baseUrl);

    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (!op?.operationId) continue;
        mapping[op.operationId] = {
          method: method.toUpperCase(),
          path,
          service,
          baseUrl,
        };
      }
    }
  }

  return mapping;
}
