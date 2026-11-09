# Architectural Decisions (`DECISIONS.md`)

Append-only log of architectural decisions for `insurance-agency` (Evergreen Insurance API Gym).

---

## 2026-10-19 — ADR-001: Multi-Modal 8-Service Brokerage Topology (REST + MCP + Web UI)

- **Context:** Single-modality benchmarks (pure REST APIs or pure mock JSON tools) fail to test whether enterprise agents can coordinate across heterogeneous protocols and legacy carrier interfaces in regulated small-business operations.
- **Decision:** Model Evergreen Insurance Partners as 8 independent Bun + Hono microservices spanning three distinct interaction modalities:
  1. **REST APIs** (`ams` `:3000`, `rater` `:3001`, `crm` `:3002`, `ecm` `:3003`, `claims` `:3007`) governed by [`specs/`](specs/) OpenAPI 3.0 contracts and scoped OAuth 2.0 JWTs.
  2. **Model Context Protocol (MCP)** (`comm` `:3004`, stdio + SSE) for omnichannel inbox, outbound messaging, call transcripts, and HMAC-signed webhooks.
  3. **Carrier Portal Web UIs + Backing APIs** (`carrier-summit` `:3005`, `carrier-coastal` `:3006`) with React frontends and `MODALITY_MODE=strict` enforcement.
- **Consequence:** Full benchmark coverage across all 20 scenarios (253 task cases) requires orchestrating REST tool calls, native MCP tool discovery, and browser/portal workflows under real OAuth scope enforcement.

---

## 2026-10-19 — ADR-002: Dual Deterministic Seed Modes (`realistic` vs. `clean`) & Prisma 7 Persistence

- **Context:** Evaluating agent reliability requires distinguishing baseline workflow competence from adversarial resilience (duplicate client records, below-minimum state liability limits, lapsed policies, coastal moratoriums, and unsigned compliance documents).
- **Decision:** Maintain two parallel, deterministic 16-file seed datasets ([`data/seed/`](data/seed/) for `SEED_MODE=realistic` and [`data/seed-clean/`](data/seed-clean/) for `SEED_MODE=clean`) loaded via Prisma 7 across SQLite (per-service local/container default) and PostgreSQL (`TEST_DATABASE_URL` / CloudNativePG in Kubernetes), paired with `/sim/snapshot` and `/sim/reset` endpoints for exact pre/post database state diffing (`S3-DIFF-1`).
- **Consequence:** Every scenario can be graded in both clean and adversarial modes with zero cross-run state pollution and exact collateral-damage detection.

---

## 2026-10-25 — ADR-003: 60/40 Output + OTLP Trace Scoring, Hard E&O Auto-Fail & `EVAL-P01..P10` Rubric Calibration

- **Context:** Checking only final database state misses unsafe intermediate actions (e.g., skipping coverage verification or failing to escalate an attorney mention), while uncalibrated LLM judges suffer from scale ambiguity and sensitivity/specificity bias.
- **Decision:** Combine **Output Scoring (60%)** ([`eval/evaluators/output.ts`](eval/evaluators/output.ts) + snapshot state diffing) with **OpenTelemetry `gen_ai.*` Trace Scoring (40%)** ([`eval/evaluators/trace.ts`](eval/evaluators/trace.ts)), enforce a hard `0%` auto-fail override on any uncaught E&O trigger ([`regulatory.md`](regulatory.md)), and implement [`eval/evaluators/rubric.ts`](eval/evaluators/rubric.ts) in strict compliance with `EVAL-P01..P10` (`gemini-4-argon` default judge, binary/4-point ordinal scales only, mandatory `reasoningTrace` before `score`/`passed`, `CONTRADICTION_AWARE_4PT_STEPS`, and Rogan-Gladen prevalence debiasing). Export tasks natively to METR v0.5.0, Harbor / Terminal-Bench, UK AISI Inspect AI, OpenEnv / `verifiers`, and Princeton HAL.
- **Consequence:** Agents are evaluated on outcome accuracy, trajectory compliance, regulatory safety, and Pareto cost/latency efficiency across all major public benchmark harnesses.

---

## 2026-11-09 — ADR-004: Insurance Technology Executive Showcase, Three Lines of Defense & 3-Stage Agent-to-Code Evolution

- **Context:** Insurance technology executives, agency principals, and E&O officers evaluating AI automation need runnable proof of agency capacity expansion (`$200K → $385K` revenue/employee for an 11-person agency), deterministic service-layer E&O protection, real ACORD document rendering, and compounding token economics — without losing the rigor of the 20-scenario / 253-task benchmark suite.
- **Decision:**
  1. **Three Lines of Defense:** Enforce a **1st-Line Service-Layer E&O Compliance Firewall** ([`packages/shared/src/compliance-firewall.ts`](packages/shared/src/compliance-firewall.ts)) returning HTTP `422` on 10-state auto statutory minimum violations (`CA`, `TX`, `FL`, `NY`, `IL`, `PA`, `OH`, `GA`, `NC`, `MI`), unapproved backdating, and binding authority breaches across AMS and Rater; pair it with the **2nd-Line Principal Escalation Queue** (`ams.escalations`) and **3rd-Line 35-Table SQLite State-Diff Auditor** ([`eval/evaluators/state-diff.ts`](eval/evaluators/state-diff.ts)).
  2. **3-Stage Agent-to-Code Evolution (`eval/evolution-showcase.ts`):** Model and execute the progression from **Stage 1 General Agent** (`6,500` tokens, `pass^5 = 44%`) to **Stage 2 Domain Skill** (`2,700` tokens, `pass^5 = 86%`) to **Stage 3 `$0`-Token Compiled Deterministic Code** (`privy:cert-issuer`, `privy:claims-intake`, `privy:renewal-monitor`, `privy:endorsement-guard`, `0` tokens, `pass^5 = 100%`) with automatic `FallbackToSkill` on mid-conversation client pivots (`Scenarios 17–20`).
  3. **GM3 Light Executive Workbench & Fictional Carrier Hygiene:** Mount the 4-tab GM3 Light Executive Workbench directly on AMS at `GET /` (`:3000`) with a `bun run showcase` launcher, generate real binary ACORD 25 COI PDFs ([`services/ecm/src/templates/acord-25.ts`](services/ecm/src/templates/acord-25.ts)), and sanitize all 7 carrier display names to fictional showcase brands (*Summit Fire & Casualty*, *Coastal Star Auto*, *Hartland Commercial*, *Erie Basin Mutual*, *National Shield*, *SafeHarbor*, *Liberty Crest*).
- **Consequence:** The repository functions simultaneously as an interactive Executive Operations & Governance Showcase and a 20-scenario / 253-task multi-modal verification benchmark.
