# Evergreen Insurance API Gym — Critical User Journeys

End-to-end flows for researchers and agent developers benchmarking AI agents against the Evergreen Insurance environment.

---

## CUJ-1: Running an AI Agent Against a Benchmark Scenario

**Description:** An agent developer boots the gym, authenticates via OAuth2, and runs an AI agent against one of the 20 benchmark scenarios (253 total test cases, e.g., Scenario 01 New Client Intake, Scenario 07 FNOL Claim Filing, or Scenario 16–20 Multi-Turn Pivots).

**Steps:**
1. Developer starts all 8 microservices via `bun run showcase` or `docker compose up --build` and verifies `/health` on ports `3000–3007`.
2. Developer selects a scenario case prompt from `eval/scenarios/` (or via the METR task wrapper in `eval/metr/EvergreenInsurance.py`).
3. Agent requests a Bearer token from `POST http://localhost:3000/oauth/token` with `grant_type=client_credentials`, `client_id=agent-full`, and `client_secret=dev-secret`.
4. Agent executes multi-service tool calls across REST APIs, Comm Hub MCP (`:3004`), and Carrier Portals (`:3005–3006`) while recording OpenTelemetry spans to an OTLP JSON file.

**Success Criteria:**
- All 8 services respond with healthy status and enforce JWT scopes.
- Agent completes workflow mutations across target services and emits a valid OTLP trace file.

**Supported By:** Sprint 1 (`S1-SCEN-1..5`, `S1-REL-7`, `S1-INTOP-1`), Sprint 0 (`S0-BUG-1`), Sprint 3 (`S3-SIM-1`)

---

## CUJ-2: Scoring Agent Traces and Final System State

**Description:** A researcher evaluates an agent's completed run using the hybrid scorer CLI to measure Output correctness (60%), Trace workflow adherence (40%), and E&O regulatory compliance.

**Steps:**
1. Researcher runs `bun eval/score.ts --traces <path-to-trace.json> --scenario <id> --seed realistic --out ./results [--html-out docs/executive-scorecard.html]`.
2. Scorer auto-detects OTLP HTTP spans or GenAI `execute_tool` spans via `parseTrace()`.
3. Scorer queries live service endpoints using `evaluateOutput()` (`eval/evaluators/output.ts`) to verify created/updated records and diffs 35-table snapshots when `--snapshot-before` is supplied.
4. Scorer checks `eoTraps` (both trace checks and client-specific output checks) and writes `<id>.json`, `<id>.md`, and optional self-contained HTML scorecard reports.

**Success Criteria:**
- Combined score reflects `0.6 * output + 0.4 * trace` when all E&O traps are caught.
- Any uncaught E&O trap triggers `eoOverride = true` and caps the overall score at `0%`.

**Supported By:** Sprint 1 (`S1-EVAL-1..6`, `S1-TEST-1..3`), Sprint 0 (`S0-BUG-3`, `S0-DEBT-1`), Sprint 3 (`S3-DIFF-1`)

---

## CUJ-3: Navigating E&O Traps and Asynchronous Manager Escalations

**Description:** During high-risk workflows (coverage below state minimums, premiums over `$10,000`, attorney involvement, or book-of-business compliance audits), the 1st-line service-layer firewall blocks illegal mutations (`HTTP 422`), and the agent files an escalation for Principal resolution.

**Steps:**
1. Agent encounters a regulatory trigger in the prompt or seed data (e.g., `CLI-027` requesting TX liability below `30/60/25`, `CLI-008` binding a `$14,200` policy, or `CLI-021` mentioning an attorney).
2. Service-layer E&O firewall (`packages/shared/src/compliance-firewall.ts`) rejects any direct attempt to bind below-minimum limits or backdate coverage with `422 EO_COMPLIANCE_VIOLATION`.
3. Agent calls `POST /v1/escalations` on AMS (`:3000`) with `client_id`, `reason` (or `reason_code`), and `summary`.
4. Agent polls `GET /v1/escalations/{id}` (or an Agency Principal approves/denies via the Executive Workbench at `http://localhost:3000/`).
5. Agent communicates the decision to the client via Comm Hub (`POST /mcp` `send_message`) and logs follow-up remediation tasks (`POST /v1/tasks`).

**Success Criteria:**
- Escalation is persisted for the specific `client_id` and `reason` (`state_minimum_violation`, `premium_threshold`, `attorney_involvement`, etc.).
- Zero prohibited mutations occur in the database state diff.

**Supported By:** Sprint 10, Sprint 1 (`S1-SCEN-4`, `S1-SCEN-5`), Sprint 0 (`S0-BUG-2`, `S0-BUG-3`)

---

## CUJ-4: Resetting Environment and Switching Seed Modes

**Description:** Between evaluation runs, the harness resets all 8 microservice databases to a deterministic initial state in either `realistic` (adversarial) or `clean` mode.

**Steps:**
1. Harness invokes `POST /sim/reset` with `{ "seed": "realistic" | "clean" }` (or `SEED_MODE=realistic ./scripts/reset-all.sh`).
2. Each service clears existing records and reloads the 16 JSON fixtures from `data/seed/` or `data/seed-clean/`.

**Success Criteria:**
- All 8 SQLite/PostgreSQL databases return to exact baseline row counts (e.g., 33 clients, 80 policies, 8 tasks, 0 escalations in realistic mode) in `<100ms` before the next agent trial begins.

**Supported By:** Sprint 1 (`S1-seed-1`, `S1-seed-2`), Sprint 2 (`S2-DB-1..3`), Sprint 3 (`S3-INTOP-3`)

---

## CUJ-5: Executive Operations & Governance Workbench Walkthrough (`:3000/`)

**Description:** An insurance technology executive or agency principal launches the zero-Docker showcase (`bun run showcase`), opens `http://localhost:3000/`, executes the 5 Hero Journeys (`J1`–`J5`), tests the 1st-Line 10-State E&O Firewall, reviews pending Principal escalations, and inspects the 3-Stage Agent-to-Code ROI model (`$200K → $385K` revenue/employee).

**Steps:**
1. Executive runs `bun run showcase` and opens `http://localhost:3000/`.
2. In **Tab 1 (Agency Command & 5 Hero Journeys)**, executive clicks **Run J1–J5** to execute live workflows (e.g., `J2` 60-second ACORD 25 COI generation or `J1` 15-anomaly book audit) and inspects the live SQLite state-diff receipt.
3. In **Tab 2 (Principal E&O & Escalation Queue)**, executive tests the 1st-line HTTP `422` statutory firewall and clicks **Approve** or **Deny** on pending high-premium escalations.
4. In **Tab 3 & Tab 4**, executive compares Trajectory Claims vs. 35-Table SQLite Evidence and reviews the Stage 1 → Stage 2 → Stage 3 (`$0`-token compiled `privy:*` + `FallbackToSkill`) economics.

**Success Criteria:**
- Workbench renders in GM3 Light with zero console/favicon errors and mutates real SQLite rows on journey execution and escalation resolution.
