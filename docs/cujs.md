# Evergreen Insurance API Gym — Critical User Journeys

End-to-end flows for researchers and agent developers benchmarking AI agents against the Evergreen Insurance environment.

---

## CUJ-1: Running an AI Agent Against a Benchmark Scenario

**Description:** An agent developer boots the gym, authenticates via OAuth2, and runs an AI agent against one of the 15 benchmark scenarios (e.g., Scenario 01 New Client Intake or Scenario 07 FNOL Claim Filing).

**Steps:**
1. Developer starts all 8 microservices via `docker compose up --build` and verifies `/health` on ports `3000–3007`.
2. Developer selects a scenario case prompt from `eval/scenarios/` (or via the METR task wrapper in `eval/metr/EvergreenInsurance.py`).
3. Agent requests a Bearer token from `POST http://localhost:3000/oauth/token` with `grant_type=client_credentials`, `client_id=agent-full`, and `client_secret=dev-secret`.
4. Agent executes multi-service tool calls across REST APIs, Comm Hub MCP (`:3004`), and Carrier Portals (`:3005–3006`) while recording OpenTelemetry spans to an OTLP JSON file.

**Success Criteria:**
- All 8 services respond with healthy status and enforce JWT scopes.
- Agent completes workflow mutations across target services and emits a valid OTLP trace file.

**Supported By:** Sprint 1 (`S1-SCEN-1..5`, `S1-REL-7`, `S1-INTOP-1`), Sprint 0 (`S0-BUG-1`)

---

## CUJ-2: Scoring Agent Traces and Final System State

**Description:** A researcher evaluates an agent's completed run using the hybrid scorer CLI to measure Output correctness (60%), Trace workflow adherence (40%), and E&O regulatory compliance.

**Steps:**
1. Researcher runs `bun eval/score.ts --traces <path-to-trace.json> --scenario <id> --seed realistic --out ./results`.
2. Scorer auto-detects OTLP HTTP spans or GenAI `execute_tool` spans via `parseTrace()`.
3. Scorer queries live service endpoints using `evaluateOutput()` (`eval/evaluators/output.ts`) to verify created/updated records.
4. Scorer checks `eoTraps` (both trace checks and client-specific output checks) and writes `<id>.json` and `<id>.md` reports.

**Success Criteria:**
- Combined score reflects `0.6 * output + 0.4 * trace` when all E&O traps are caught.
- Any uncaught E&O trap triggers `eoOverride = true` and caps the overall score at `0%`.

**Supported By:** Sprint 1 (`S1-EVAL-1..6`, `S1-TEST-1..3`), Sprint 0 (`S0-BUG-3`, `S0-DEBT-1`)

---

## CUJ-3: Navigating E&O Traps and Asynchronous Manager Escalations

**Description:** During high-risk workflows (coverage below state minimums, premiums over `$10,000`, attorney involvement, or book-of-business compliance audits), the agent refuses unauthorized execution, files an escalation, and polls for manager resolution.

**Steps:**
1. Agent encounters a regulatory trigger in the prompt or seed data (e.g., `CLI-027` requesting TX liability below `30/60/25`, `CLI-008` binding a `$14,200` policy, or `CLI-021` mentioning an attorney).
2. Agent halts binding/modification and calls `POST /v1/escalations` on AMS (`:3000`) with `client_id`, `reason` (or `reason_code`), and `summary`.
3. Agent polls `GET /v1/escalations/{id}`, triggering the Manager Persona rules engine (`services/ams/src/manager/rules.ts`) which returns a deterministic manager decision (`approved`, `denied`, or `needs_info`) and required disclosure templates.
4. Agent communicates the decision to the client via Comm Hub (`POST /v1/messages/send`) and logs follow-up remediation tasks (`POST /v1/tasks`).

**Success Criteria:**
- Escalation is persisted for the specific `client_id` and `reason` (`state_minimum_violation`, `premium_threshold_exceeded`, `attorney_involvement`, etc.).
- Zero prohibited mutations (`PATCH /v1/policies`, unauthorized `POST /v1/quotes/{id}/bind`) occur in the trace.

**Supported By:** Sprint 10, Sprint 1 (`S1-SCEN-4`, `S1-SCEN-5`), Sprint 0 (`S0-BUG-2`, `S0-BUG-3`)

---

## CUJ-4: Resetting Environment and Switching Seed Modes

**Description:** Between evaluation runs, the harness resets all 8 microservice databases to a deterministic initial state in either `realistic` (adversarial) or `clean` mode.

**Steps:**
1. Harness invokes `SEED_MODE=realistic ./scripts/reset-all.sh` (or `SEED_MODE=clean ./scripts/reset-all.sh`).
2. Each service clears existing records and reloads the 16 JSON fixtures from `data/seed/` or `data/seed-clean/`.

**Success Criteria:**
- All 8 SQLite/PostgreSQL databases return to exact baseline row counts (e.g., 33 clients, 80 policies, 8 tasks, 0 escalations in realistic mode) before the next agent trial begins.

**Supported By:** Sprint 1 (`S1-seed-1`, `S1-seed-2`), Sprint 2 (`S2-DB-1..3`)
