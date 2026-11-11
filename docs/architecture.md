# Evergreen Insurance API Gym — Architecture

**Stack:** Bun, TypeScript, Hono, Prisma 7 (`@prisma/adapter-libsql` isolated per-service SQLite), TypeScript MCP SDK, React + Vite (Carrier Portals), OpenTelemetry (OTLP JSON), Docker Compose

---

## System Overview

Evergreen Insurance API Gym is a decoupled, multi-service benchmark environment simulating a mid-sized independent insurance brokerage (`Evergreen Insurance Partners`). Rather than coupling evaluation to a single vendor agent, the gym exposes standardized service interfaces, service-layer statutory guardrails, deterministic seed datasets, and a `< 100ms` simulation control plane so external AI agents and harnesses (UK AISI Inspect AI, Harbor / Terminal-Bench, METR, OpenEnv / `verifiers`, and Princeton HAL) operate against realistic business systems under `MODALITY_MODE=strict` and are graded deterministically.

---

## Components

### 1. Shared Foundation (`packages/shared`)
- **Responsibility:** Cross-service OAuth 2.0 / JWT authentication and scope enforcement (`jwtAuth`, `requireScopes`), strict modality guards (`strictModalityGuard`, portal bootstrap cookies `evergreen_portal_boot_*`, `/auth/portal-session`), scorer/internal header verification (`EVERGREEN_SCORER_SECRET`), 1st-line statutory E&O compliance firewall (`compliance-firewall.ts`), service-side OTLP request logging (`request-log.ts`), `/sim/*` control plane (`snapshot`, in-process `reset`, `trace`, `time-travel`, `chaos`), cursor pagination, and PII masking utilities.
- **Location:** `packages/shared/src/`
- **Dependencies:** `hono`, `jose`

### 2. Core Agency Microservices (`services/*`)
Each microservice runs as an independent Bun + Hono HTTP server with its own isolated SQLite schema (`prisma/schema.prisma`, totaling **32 tables across all 8 services**), `EVERGREEN_DATA_DIR`-scoped database path (`src/prisma.ts`), and in-process `seedDatabase()` loader (`src/seed.ts`):

| Service | Port | Modality (`strict`) | Responsibility & Location |
|---------|------|---------------------|---------------------------|
| **AMS** (`services/ams`) | 3000 | REST (+ Workbench UI at `/`) | Agency Management System: clients, policies, coverages, endorsements, commissions, tasks, escalations, the automated Manager Persona rule engine (`services/ams/src/manager/rules.ts`), and the Executive Operations Workbench (`services/ams/src/routes/workbench.ts`). |
| **Rater** (`services/rater`) | 3001 | REST | Multi-carrier comparative rating engine, carrier appetite checks, quote request/polling, and policy binding with HTTP `422` statutory E&O guardrails. |
| **CRM** (`services/crm`) | 3002 | REST | Lead scoring, retention risk analytics, and marketing campaign enrollment. |
| **ECM** (`services/ecm`) | 3003 | REST | Enterprise Content Management: document upload/audit, e-signature envelopes, marketing assets, and binary ACORD PDF generation (`pdf-lib`), including ACORD 25 Certificates of Insurance (`/v1/documents/coi/:document_id/pdf`). |
| **Comm Hub** (`services/comm`) | 3004 | MCP (`/mcp` + JWT) | Communications hub exposing inbox messages, call transcripts, and HMAC-signed webhook subscriptions via Model Context Protocol (Streamable HTTP `/mcp` + stdio), plus the scripted multi-turn customer simulator (`services/comm/src/simulator/`). Direct `/v1/*` REST routes are blocked for agents under `MODALITY_MODE=strict`. |
| **Summit Fire** (`services/carrier-summit`) | 3005 | Web UI + Portal Session | Legacy commercial carrier portal with React + Vite frontend (`public/`), portal bootstrap cookie, and underwriting API gated by `X-Portal-Session` under `MODALITY_MODE=strict`. |
| **Coastal Star** (`services/carrier-coastal`) | 3006 | Web UI + Portal Session | Legacy personal auto/property carrier portal with React + Vite frontend (`public/`), MVR checks, and moratorium rules gated by `X-Portal-Session` under `MODALITY_MODE=strict`. |
| **Claims** (`services/claims`) | 3007 | REST | First Notice of Loss (FNOL) intake, forward-only status state machine (`specs/claims.behavior.yaml`), adjuster capacity checks, reserves, and claim timeline tracking. |

### 3. Evaluation & Scoring Engine (`eval/`)
- **Responsibility:** Evaluates agent runs across 20 scenarios (253 cases across `scripted`, `explicit`, `natural`, `vague`, and `adversarial` prompt difficulty tiers) using a hybrid scorer (`eval/score.ts`):
  - **Output & 32-Table State-Diff Evaluator (60% weight):** Queries live REST APIs (`eval/evaluators/output.ts`) and compares before/after 32-table primary-key snapshots (`eval/evaluators/state-diff.ts`), enforcing per-variant `collateralPolicy` (`allowedClientIds`, `allowedPolicyIds`, `maxTotalMutations`) to penalize unauthorized mutations.
  - **Trace Evaluator (40% weight):** Collects service-side OTLP spans (`eval/collect-trace.ts` via `GET /sim/trace`) or agent-emitted spans (`eval/evaluators/trace.ts`, `eval/evaluators/trace-genai.ts`) to verify workflow sequences, presence/absence constraints, and API call efficiency.
  - **E&O Trap Gate (Hard Override):** Any uncaught Errors & Omissions regulatory violation (`regulatory.md`) caps the scenario score at `0%`.
  - **Calibrated Communication Rubrics (`EVAL-P01..P10`):** Evaluates free-text communication safety (`eval/evaluators/rubric.ts`), reporting deterministic rule checks offline (`judgeModel: "deterministic-rule"`) and supporting optional Vertex AI LLM judging (`--llm-judge`) calibrated against the 120-item dual-expert gold set (`eval/calibration/rubric_gold_120.json`).

### 4. Benchmark Interoperability Adapters (`eval/inspect/`, `eval/harbor/`, `eval/metr/`, `eval/openenv/`, `eval/hal/`)
- **Responsibility:** Exposes the 20 scenarios and 253 task variants across UK AISI Inspect AI (`eval/inspect/evergreen_langchain.py` & `evergreen.py`), Harbor / Terminal-Bench (`eval/harbor/export-harbor.ts`), METR Task Standard v0.5.0 (`eval/metr/EvergreenInsurance.py`), OpenEnv / `verifiers` (`eval/openenv/`), and Princeton HAL (`eval/hal/export-hal.ts`).

---

## Data Flow

1. **Isolated Seed Initialization:** Each service resolves its SQLite file via `EVERGREEN_DATA_DIR` (defaulting to an ephemeral `/tmp` directory in `bun run showcase`, `bun eval/validate-harness.ts`, and integration tests so tracked files stay clean) and loads either `data/seed/` (`SEED_MODE=realistic`) or `data/seed-clean/` (`SEED_MODE=clean`) in `< 100ms` via `POST /sim/reset`.
2. **Authentication & Strict Modality:** Agents obtain an OAuth 2.0 Bearer JWT from `POST /oauth/token` (`client_id=agent-full`, `client_secret=dev-secret`) for REST and `/mcp` calls, and load carrier portal pages (`GET /` on `:3005`/`:3006`) to receive the `evergreen_portal_boot_*` cookie required by `/auth/portal-session`.
3. **Multi-Modal Execution & Service-Side Tracing:** As the agent acts across REST (`:3000–3003`, `:3007`), MCP (`:3004`), and Carrier Web Portals (`:3005–3006`), each service records `/v1/*` and MCP `tools/call` spans in memory (`GET /sim/trace`).
4. **Manager Persona Loop:** When an agent files an E&O escalation (`POST /v1/escalations`) on AMS, the deterministic Manager Persona engine (`services/ams/src/manager/rules.ts`) evaluates the escalation context and resolves status (`approved`, `denied`, `needs_info`) on subsequent `GET /v1/escalations/:id` polls.
5. **Post-Run Scoring:** `bun eval/collect-trace.ts` and `bun eval/score.ts` combine service-side traces with before/after `/sim/snapshot` state diffs (`X-Eval-Scorer: true`, authenticated via `EVERGREEN_SCORER_SECRET` when configured) to emit JSON, Markdown, and HTML reports.

---

## Tech Decisions (`ADR-001`–`ADR-006`)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime & HTTP Framework | Bun + Hono | Sub-second startup, native TypeScript execution, lightweight footprint across 8 concurrent services or parallel evaluation stacks (`--base-port`). |
| ORM & Canonical Topology | Prisma 7 + Isolated Per-Service SQLite (`ADR-006`) | `EVERGREEN_DATA_DIR` SQLite files + `< 100ms` in-process `/sim/reset` + 32-table `/sim/snapshot` state diffing run at `$0` local/CI cost with zero cross-run state pollution, superseding unverified PG/K8s manifests. |
| Trace Collection | Service-Side OTLP JSON (`ADR-005`) + GenAI Semconv | Scores REST, MCP `tools/call`, and browser-driven carrier portal requests identically without requiring agent-side OTel instrumentation. |
| Scoring & Governance | 60% Output/State-Diff + 40% Trace + Hard E&O Gate | Enforces business state accuracy, `collateralPolicy` isolation, workflow compliance, and zero tolerance for uncaught E&O violations. |

---

## Constraints

- **Microservice Boundary Isolation:** Services never share database files or cross-service TypeScript imports (enforced by `specs/ast.rules.yaml` via `ast-grep`).
- **Bidirectional Contract Parity:** Every `/v1/*` Hono route and every `specs/*.yaml` path must match bidirectionally (`tests/openapi-route-contract.test.ts`).
- **PII & Scope Compliance:** Logs, traces, and error payloads mask SSNs, driver's license numbers, dates of birth, emails, and phone numbers per `regulatory.md`, and every endpoint enforces JWT scopes via `requireScopes()`.
