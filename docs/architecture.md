# Evergreen Insurance API Gym — Architecture

**Stack:** Bun, TypeScript, Hono, Prisma 7 (SQLite / PostgreSQL), TypeScript MCP SDK, React + Vite (Carrier Portals), OpenTelemetry (OTLP JSON), Docker Compose, Kubernetes

---

## System Overview

Evergreen Insurance API Gym is a decoupled, multi-service benchmark environment simulating a mid-sized independent insurance brokerage (`Evergreen Insurance Partners`). Rather than embedding an agent inside the repository, the gym exposes standardized service interfaces, regulatory rules, and seed datasets so external AI agents and harnesses (Google ADK, Claude Code, OpenHands, Inspect AI, METR, Harbor) can operate against realistic business systems and be graded deterministically.

---

## Components

### 1. Shared Foundation (`packages/shared`)
- **Responsibility:** Cross-service OAuth 2.0 / JWT authentication and scope enforcement, correlation ID propagation, structured error responses (`ValidationError`, `NotFoundError`, `ForbiddenError`, `ConflictError`), Cursor-based pagination, PII masking utilities, and SQLite/Prisma helper functions.
- **Location:** `packages/shared/src/`
- **Dependencies:** `hono`, `jose`

### 2. Core Agency Microservices (`services/*`)
Each microservice runs as an independent Bun + Hono HTTP server with its own isolated database schema (`prisma/schema.prisma`) and seed loader (`src/seed.ts`):

| Service | Port | Modality | Responsibility & Location |
|---------|------|----------|---------------------------|
| **AMS** (`services/ams`) | 3000 | REST | Agency Management System: clients, policies, endorsements, commissions, tasks, escalations, and the automated Manager Persona rule engine (`services/ams/src/manager/rules.ts`). |
| **Rater** (`services/rater`) | 3001 | REST | Multi-carrier comparative rating engine, carrier appetite checks, quote request/polling, and policy binding with E&O guardrails. |
| **CRM** (`services/crm`) | 3002 | REST | Lead scoring, retention risk analytics, and marketing campaign enrollment. |
| **ECM** (`services/ecm`) | 3003 | REST | Enterprise Content Management: document upload/audit, e-signature envelopes, marketing assets, and dynamic ACORD PDF generation (`pdf-lib`). |
| **Comm Hub** (`services/comm`) | 3004 | MCP + REST | Communications hub exposing inbox messages, call transcripts, and webhook subscriptions via Model Context Protocol (MCP over stdio/SSE) and REST endpoints. |
| **Summit Fire** (`services/carrier-summit`) | 3005 | Web UI + REST | Mock carrier portal with React + Vite frontend and underwriting REST API. |
| **Coastal Star** (`services/carrier-coastal`) | 3006 | Web UI + REST | Mock carrier portal specializing in coastal/high-risk property and auto with moratorium rules. |
| **Claims** (`services/claims`) | 3007 | REST | First Notice of Loss (FNOL) intake, adjuster assignment, and claim timeline tracking. |

### 3. Evaluation & Scoring Engine (`eval/`)
- **Responsibility:** Evaluates agent runs across 15 scenarios (218 cases across `scripted`, `explicit`, `natural`, `vague`, and `adversarial` prompt difficulty tiers) using a hybrid rubric:
  - **Output Evaluator (60% weight):** Queries live REST APIs (`eval/evaluators/output.ts`) to verify final system state (records created, status transitions, escalations filed).
  - **Trace Evaluator (40% weight):** Parses OTLP HTTP client spans (`eval/evaluators/trace.ts`) and GenAI semantic convention tool spans (`eval/evaluators/trace-genai.ts`) to verify workflow sequences, presence/absence constraints, and API call efficiency.
  - **E&O Trap Gate (Hard Override):** Any uncaught Errors & Omissions regulatory violation (missing escalation or missing client-specific escalation state) overrides the scenario score to `0%`.
- **Location:** `eval/`

### 4. Benchmark Interoperability Adapters (`eval/metr/`, `eval/harbor/`)
- **Responsibility:** Exposes the 15 scenarios and 203+ task variants in standard external benchmark formats, including the METR Task Standard (`eval/metr/EvergreenInsurance.py`) and Harbor / Terminal-Bench (`S2-INTOP-1`).

---

## Data Flow

1. **Seed Initialization:** Each service loads either `data/seed/` (`SEED_MODE=realistic`, containing planted compliance defects, duplicates, and E&O traps) or `data/seed-clean/` (`SEED_MODE=clean`) into its local database via `bun run seed`.
2. **Authentication:** The agent authenticates against `POST /oauth/token` (`client_id=agent-full`, `client_secret=dev-secret`) to obtain a signed Bearer JWT containing service scopes.
3. **Multi-Modal Execution:** The agent interacts with the 8 services over REST (`:3000–3003`, `:3007`), MCP (`:3004`), and Carrier Web Portals (`:3005–3006`) while emitting OpenTelemetry spans.
4. **Manager Persona Loop:** When an agent submits an E&O escalation (`POST /v1/escalations`) on AMS, the deterministic Manager Persona engine (`services/ams/src/manager/rules.ts`) evaluates the escalation context and transitions its status (`approved`, `denied`, `needs_info`) on subsequent `GET /v1/escalations/:id` polls.
5. **Post-Run Scoring:** `bun eval/score.ts` ingests the recorded OTLP trace and queries the live service APIs to emit JSON and Markdown evaluation reports.

---

## Tech Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime & HTTP Framework | Bun + Hono | Fast startup, native TypeScript execution, lightweight footprint across 8 concurrent containers. |
| ORM & Database | Prisma 7 (SQLite local / PostgreSQL K8s) | Single schema definition per service supporting zero-config local SQLite files in Docker Compose and PostgreSQL in Kubernetes. |
| Trace Format | OpenTelemetry OTLP JSON + GenAI Semconv | Framework-agnostic evaluation supporting both raw HTTP spans and `gen_ai.operation.name = "execute_tool"` spans across ADK, LangChain, PydanticAI, and CrewAI. |
| Scoring Weights | 60% Output / 40% Trace + Hard E&O Gate | Prioritizes achieving the right business state while still verifying compliance workflow steps, with zero tolerance for regulatory E&O failures. |

---

## Constraints

- **Database Isolation:** Services never share database tables directly; cross-service workflows must traverse HTTP/MCP interfaces.
- **PII Compliance:** Logs, traces, and error payloads must mask SSNs, driver's license numbers, dates of birth, emails, and phone numbers per `regulatory.md`.
- **Strict Scope Enforcement:** Every endpoint validates JWT scopes via `requireScopes()` middleware.
