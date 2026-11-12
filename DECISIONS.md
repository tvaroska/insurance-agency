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
  1. **Three Lines of Defense:** Enforce a **1st-Line Service-Layer E&O Compliance Firewall** ([`packages/shared/src/compliance-firewall.ts`](packages/shared/src/compliance-firewall.ts)) returning HTTP `422` on 10-state auto statutory minimum violations (`CA`, `TX`, `FL`, `NY`, `IL`, `PA`, `OH`, `GA`, `NC`, `MI`), unapproved backdating, and binding authority breaches across AMS and Rater; pair it with the **2nd-Line Principal Escalation Queue** (`ams.escalations`) and **3rd-Line 32-Table SQLite State-Diff Auditor across all 8 services** ([`eval/evaluators/state-diff.ts`](eval/evaluators/state-diff.ts)).
  2. **3-Stage Agent-to-Code Evolution (`eval/evolution-showcase.ts`):** Model and execute the progression from **Stage 1 Zero-Shot General Agent** (measured `v0.7` baseline: `gemini-3.8-flash` `66.7%` `pass@1` / `0.68` mean, `claude-sonnet-5-5` `50.0%` / `0.62` mean, `DeepSeek-V4.1-Flash` `33.3%` / `0.53` mean; `16.7%–66.7%` false-completion rate) to **Stage 2 Domain Skill + Guardrails** (projected target: `2,700` tokens, `97.0%` `pass@1`, `pass^5 = 86%`) to **Stage 3 `$0`-Token Compiled Deterministic Code** (`privy:cert-issuer`, `privy:claims-intake`, `privy:renewal-monitor`, `privy:endorsement-guard`, `0` tokens, measured `100.0%` scripted reference verifier across all 20 workflows) with automatic `FallbackToSkill` on mid-conversation client pivots (`Scenarios 17–20`).
  3. **GM3 Light Executive Workbench & Fictional Carrier Hygiene:** Mount the 4-tab GM3 Light Executive Workbench directly on AMS at `GET /` (`:3000`) with a `bun run showcase` launcher, generate real binary ACORD 25 COI PDFs ([`services/ecm/src/templates/acord-25.ts`](services/ecm/src/templates/acord-25.ts)), and sanitize all 7 carrier display names to fictional showcase brands (*Summit Fire & Casualty*, *Coastal Star Auto*, *Hartland Commercial*, *Erie Basin Mutual*, *National Shield*, *SafeHarbor*, *Liberty Crest*).
- **Consequence:** The repository functions simultaneously as an interactive Executive Operations & Governance Showcase and a 20-scenario / 253-task multi-modal verification benchmark.

---

## 2026-11-10 — ADR-005: First Results Run: Three Workhorse Models, a LangChain Agent inside Inspect, Typed Tools, and Service-Side Traces

- **Context:** The `README.md` Results section is a placeholder. The first run has to compare models fairly (the author works at Google, and the rubric judge defaults to `gemini-4-argon`), keep the three ways in honest, and score every harness the same way. Two gaps block real-agent scoring: only the scripted agent and the OpenEnv adapter produce traces (the Inspect scorer falls back to an empty trace and the Harbor verifier to a canned Scenario 01 fixture, while `eval/score.ts` counts a trap as caught only when both its trace and output checks pass), and strict modality accepts any non-empty `X-Portal-Session` header or a `Referer` with a "Mozilla" user agent.
- **Decision:**
  1. **Models:** `gemini-3.8-flash`, Claude Sonnet 5.5 (`claude-sonnet-5-5`), and DeepSeek-V4.1-Flash (open-weight, MIT license): each vendor's everyday workhorse model, all served through Vertex AI. Exact model IDs and reasoning settings are pinned per run.
  2. **Harness:** one standard LangChain agent run inside UK AISI Inspect AI through Inspect's agent bridge. The agent calls the placeholder model `inspect`, and Inspect routes every call to the configured provider, so all three models take the same path while Inspect supplies repeated trials, token counts, and logs. Rejected: pure Google ADK (vendor home-advantage optics, and only Gemini runs natively), each vendor's own agent through Harbor (model and agent change together; kept for a later vendor-products comparison), a home-grown agent loop (less trusted, more to build), and OpenEnv / `verifiers` (its step API removes the three-modality test; kept for learning-mechanism experiments).
  3. **Typed tools, no shell:** REST tools generated from [`specs/`](specs/) for the 5 REST services, the messaging hub over MCP, and the carrier portals through a Playwright browser MCP server. Without a shell or a generic HTTP tool, an agent can only use the interface each system offers.
  4. **Service-side traces:** each service records the agent's API calls (`/v1/*` and MCP `tools/call`) as OTLP client spans in the format [`eval/evaluators/trace.ts`](eval/evaluators/trace.ts) already parses, skipping internal service-to-service calls, OAuth, `/sim/*`, and static assets. `/sim/reset` clears the log and `GET /sim/trace` exports it, so every harness (including browser-driven portal calls) is scored the same way and agents need no OpenTelemetry instrumentation.
  5. **Portal sessions:** strict mode accepts only `X-Portal-Session` tokens issued by `/auth/portal-session`; the carrier web UIs fetch and attach the token, and the `Referer` fallback is removed.
  6. **Validation before spending tokens:** through the service-side trace path ([`eval/validate-harness.ts`](eval/validate-harness.ts)), the scripted reference agent must score `1.000` and a do-nothing agent `0.000` across all 20 scenarios (`eval/report.ts` caps `overall.score` at `0` when `apiCallCount === 0`), and each model must pass nearly all `scripted` (step-by-step) tasks in a smoke test before the real run. Headline numbers come from the rule-based checks; judge-based rubric scores are reported separately.
- **Consequence:** The first leaderboard measures models rather than adapters or vendor tooling, and the Inspect, Harbor, and OpenEnv packages all share one scoring path. Models, harness, and learning mechanism remain swappable: the learning mechanism (how an agent improves its prompts between runs) is still to be chosen.

---

## 2026-11-11 — ADR-006: Canonical Per-Service SQLite + In-Process Seed Isolation & Retirement of Unverified PG/K8s Manifests

- **Context:** `ADR-002` originally anticipated running Prisma 7 across both local SQLite and a CloudNativePG PostgreSQL Kubernetes deployment (`docker-compose.pg.yaml`, `k8s/`), but every `schema.prisma` (`provider = "sqlite"` via `@prisma/adapter-libsql`) and CI check (`TEST_DATABASE_URL=file::memory:`) only exercised SQLite. Meanwhile, subprocess seed resets (`Bun.spawnSync`) cost `~6.2s` per sample and risked mutating working-tree `services/*/data/*.db` files or triggering `SQLITE_BUSY`, while permissive defaults left gaps in strict portal bootstrap validation, cross-client collateral enforcement, and uncalibrated rubric defaults (`0.94`/`0.92`).
- **Decision:**
  1. **Canonical Per-Service SQLite + `< 100ms` In-Process Seed Isolation:** Standardize on isolated per-service SQLite databases resolved via `EVERGREEN_DATA_DIR` (`<svc>.db` inside ephemeral `/tmp` directories for `showcase`, `validate-harness`, parallel multi-stack runners, and integration tests), paired with `< 100ms` in-process `seedDatabase(seedMode)` on `POST /sim/reset` and 32-table `GET /sim/snapshot` primary-key state-diffing across all 8 services as the canonical `$0` benchmark topology. Retire the unverified `docker-compose.pg.yaml`, `k8s/`, `scripts/init-pg-dbs.sql`, and unused Drizzle `schema.ts` artifacts, superseding the unimplemented PostgreSQL/Kubernetes port in `ADR-002`.
  2. **Hardened `MODALITY_MODE=strict`, E&O Scope Guards & Scorer Secret:** Default `docker-compose.yml` and external adapters to `MODALITY_MODE=strict`, require portal bootstrap cookies (`evergreen_portal_boot_*`) before issuing `X-Portal-Session` tokens, enforce `jwtAuth` on `comm` `/mcp`, gate `X-Eval-Scorer` and `X-Evergreen-Internal` behind `EVERGREEN_SCORER_SECRET` when set, and enforce unconditional HTTP `422` statutory auto minimums plus client- and reason-scoped escalation checks across AMS and Rater.
  3. **Universal `collateralPolicy` & Calibrated `Class 3` `20 x k=5` Evaluation:** Enforce explicit `collateralPolicy` bounds across every variant of all 20 scenarios (259 tasks), calibrate `EVAL-P01..P10` communication rubrics against a 120-item dual-expert gold benchmark (`eval/calibration/rubric_gold_120.json`, Gwet's `AC2 >= 0.85`) with optional `--llm-judge` Vertex AI grading (reporting `deterministic-rule` offline without synthetic LLM Rogan-Gladen CIs), and evaluate models across all `20` scenarios at `k=5` epochs (`pass@1`, `pass^5`, zero-shot vs. `Domain skill (SOP)`) with replayable SHA-256 artifact bundles.
- **Consequence:** Local showcases, Cloud Build CI (`bun eval/validate-harness.ts`), and parallel multi-stack `20 x k=5` evaluations run at `$0` infrastructure cost with zero working-tree mutation, `< 100ms` resets, bidirectional OpenAPI route parity, and auditable empirical provenance.
