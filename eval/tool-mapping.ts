/**
 * Builds operationId -> HTTP operation mapping from OpenAPI specs.
 * Used as fallback when GenAI traces don't include _http metadata.
 *
 * Every operation is registered under its service-qualified key
 * (`<service>:<operationId>`). Unambiguous short `operationId`s are also
 * registered directly; colliding `operationId`s across services are never
 * silently overwritten last-wins.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import type { ToolMapping } from "./types";
import { PORT_SERVICE_MAP } from "./types";

const SPECS_DIR = join(import.meta.dir, "..", "specs");
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export type ToolMappingEntry = ToolMapping[string];

interface OpenApiPathItem {
  servers?: { url: string }[];
  [method: string]: unknown;
}

interface OpenApiSpec {
  servers?: { url: string }[];
  paths?: Record<string, OpenApiPathItem>;
}

function serviceFromUrl(url: string): string {
  try {
    const port = parseInt(new URL(url).port, 10);
    return PORT_SERVICE_MAP[port] ?? "unknown";
  } catch {
    return "unknown";
  }
}

function collectSpecOperations(specsDir: string): Map<string, ToolMappingEntry[]> {
  const byOpId = new Map<string, ToolMappingEntry[]>();
  const files = readdirSync(specsDir)
    .filter(
      (f) =>
        f.endsWith(".yaml") &&
        !f.endsWith(".rules.yaml") &&
        !f.endsWith(".behavior.yaml"),
    )
    .sort();

  for (const file of files) {
    const raw = readFileSync(join(specsDir, file), "utf-8");
    const spec: OpenApiSpec = parse(raw);
    const specBaseUrl = spec.servers?.[0]?.url ?? "http://localhost:3000";

    for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
      if (!pathItem || typeof pathItem !== "object") continue;
      const pathBaseUrl =
        Array.isArray(pathItem.servers) && typeof pathItem.servers[0]?.url === "string"
          ? pathItem.servers[0].url
          : specBaseUrl;
      const service = serviceFromUrl(pathBaseUrl);

      for (const [method, opVal] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method.toLowerCase())) continue;
        const op = opVal as { operationId?: string } | null | undefined;
        if (!op?.operationId) continue;

        const list = byOpId.get(op.operationId) ?? [];
        list.push({
          method: method.toUpperCase(),
          path,
          service,
          baseUrl: pathBaseUrl,
        });
        byOpId.set(op.operationId, list);
      }
    }
  }

  return byOpId;
}

export function findToolMappingCollisions(
  specsDir = SPECS_DIR,
): Record<string, ToolMappingEntry[]> {
  const byOpId = collectSpecOperations(specsDir);
  const collisions: Record<string, ToolMappingEntry[]> = {};
  for (const [operationId, entries] of byOpId.entries()) {
    if (entries.length > 1) {
      collisions[operationId] = entries;
    }
  }
  return collisions;
}

export function loadToolMapping(specsDir = SPECS_DIR): ToolMapping {
  const byOpId = collectSpecOperations(specsDir);
  const mapping: ToolMapping = {};

  for (const [operationId, entries] of byOpId.entries()) {
    for (const entry of entries) {
      mapping[`${entry.service}:${operationId}`] = entry;
    }
    if (entries.length === 1) {
      mapping[operationId] = entries[0];
    }
  }

  return mapping;
}
