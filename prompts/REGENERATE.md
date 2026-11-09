# Single-Service Regenerative Blueprint (`services/claims` on `:3007`)

This blueprint implements the **Durable Ports, Disposable Adapters** pattern (combining DORA small-batch stability, Charity Majors' *Disposable Software vs. Durable Systems*, and Chad Fowler's *Regenerative Software / Phoenix Architecture*) on a single bounded microservice inside Evergreen Insurance Partners: **`services/claims` (`:3007`)**.

Rather than regenerating all 8 microservices at once, Hexagonal Architecture freezes the **Syntactic Driving Port** ([`../specs/claims.yaml`](../specs/claims.yaml)), the **Formal Behavioral Contract** ([`../specs/claims.behavior.yaml`](../specs/claims.behavior.yaml)), the **Data & Shared Contracts** ([`../services/claims/src/schema.ts`](../services/claims/src/schema.ts) and [`../packages/shared/`](../packages/shared/)), and the Executive Workbench UI on `:3000`. That boundary isolates [`../services/claims/src/routes/claims.ts`](../services/claims/src/routes/claims.ts) and [`../services/claims/src/routes/adjusters.ts`](../services/claims/src/routes/adjusters.ts) (`~680 LOC`) as a **Disposable Service Implementation** that any engineer or coding agent can delete from disk, regenerate from scratch in under 60 seconds, and verify in under 5 seconds without breaking the UI or sibling microservices.

---

## 1. Architectural Boundary: Durable Ports vs. Disposable Implementation

| Layer | Path | Durability | Role in the Phoenix Drill |
| :--- | :--- | :--- | :--- |
| **Syntactic Wire Contract (OpenAPI 3.0)** | [`../specs/claims.yaml`](../specs/claims.yaml) | **Frozen (Durable)** | Defines all REST paths, request/response JSON schemas, and OAuth 2.0 scopes (`claims:read`, `claims:write`, `claims:assign`, `claims:documents`). |
| **Formal Behavioral Contract (State Machine + DbC)** | [`../specs/claims.behavior.yaml`](../specs/claims.behavior.yaml) | **Frozen (Durable)** | Machine-readable finite state machine (`transitions`), input normalization aliases, `requires` preconditions, `ensures` postconditions, `claim_timeline` side-effects, and multi-step Arazzo-style verification workflows. |
| **Data & Persistence Contract** | [`../services/claims/src/schema.ts`](../services/claims/src/schema.ts), [`../services/claims/src/seed.ts`](../services/claims/src/seed.ts) | **Frozen (Durable)** | Defines the 4 SQLite/Prisma tables (`claims`, `adjusters`, `claim_documents`, `claim_timeline`) and deterministic benchmark seed rows. |
| **Server Envelope & Simulation Port** | [`../services/claims/src/index.ts`](../services/claims/src/index.ts), [`../packages/shared/`](../packages/shared/) | **Frozen (Durable)** | Mounts `/health`, `/sim` (`snapshot`, `reset`, `time-travel`), `/oauth/token`, validation helpers, and cursor pagination. |
| **Contract & Invariant Test Suite** | [`../services/claims/src/__tests__/claims.test.ts`](../services/claims/src/__tests__/claims.test.ts) | **Frozen (Durable)** | Behavioral & contract test suite that parses `specs/claims.behavior.yaml`, exhaustively executes all 30 `(fromState, toState)` transition pairs, and verifies every `requires`/`ensures` invariant. |
| **Disposable Route Implementation** | `services/claims/src/routes/claims.ts`<br>`services/claims/src/routes/adjusters.ts` | **Disposable (Regenerable)** | Safe to delete (`rm`) and regenerate via Claude Code or Antigravity whenever business rules, SDKs, or runtime conventions evolve. |

---

## 2. Compilation Chain (`Idea` to `Spec` to `Frozen Contract` to `Code`)

### Stage A: Idea & Problem Physics (`idea.md`)

**Core Mission:** Provide a governed First Notice of Loss (FNOL), adjuster assignment, reserve tracking, and Special Investigations Unit (SIU) / attorney escalation audit service for an 11-person Property & Casualty (P&C) insurance brokerage (`services/claims` on port `:3007`).

**Why a Naive 1-Paragraph Prompt Fails:**
Asking an LLM to *"build a Hono + Prisma CRUD service for insurance claims and adjusters"* fails in production and benchmark evaluation for five domain-specific reasons:
1. **Multi-Agent Payload Aliasing:** Upstream CSR agents and compiled workflows (`privy:claims-intake`) submit either `claim_type` or `loss_type`, and either `loss_description` or `description`, plus optional `estimated_loss` and `adjuster_id` during initial FNOL intake. If `POST /v1/claims/fnol` does not normalize these aliases or auto-transition initial status to `assigned` when `adjuster_id` is supplied, multi-service workflows break.
2. **Forward-Only Status State Machine:** Claims cannot jump backward (for example, `settled` back to `investigating` or `reported` straight to `settled`). Only explicit forward transitions are valid, and `settled` / `denied` are terminal states.
3. **Adjuster Capacity & Active Guards:** Assigning a claim to an inactive adjuster (`active === false`) or an adjuster whose open claims (`status NOT IN ('settled', 'denied')`) have reached `max_open_claims` must fail before mutating the claim record.
4. **Temporal Integrity on Loss Dates:** `loss_date` must match `YYYY-MM-DD`, represent a real calendar date, and never lie in the future (`loss_date > today`).
5. **3rd-Line Audit Trail Completeness (`claim_timeline`):** Every FNOL creation, adjuster assignment, status transition, reserve update, note edit, and document upload must append a structured row to `claim_timeline`. Our 35-table SQLite State-Diff Auditor ([`../eval/evaluators/state-diff.ts`](../eval/evaluators/state-diff.ts)) grades database state directly rather than trusting chat transcripts.

### Stage B: Domain Specification & State-Machine Invariants (`spec.md`)

#### 1. Enumerations & Forward-Only State Machine (Defined in [`../specs/claims.behavior.yaml`](../specs/claims.behavior.yaml))

- **`CLAIM_TYPES`:** `["auto_collision", "auto_comprehensive", "property_damage", "theft", "liability", "medical", "fire", "water", "weather"]`
- **`CLAIM_STATUSES`:** `["reported", "assigned", "investigating", "reserved", "settled", "denied"]`
- **`DOCUMENT_TYPES`:** `["police_report", "medical_records", "photos", "estimate", "correspondence", "other"]`
- **`ADJUSTER_SPECIALTIES`:** `["auto", "property", "liability", "general"]`
- **`STATUS_TRANSITIONS` (Strict Forward-Only Graph):**
  - `reported` can transition to: `["assigned", "denied"]`
  - `assigned` can transition to: `["investigating", "denied"]`
  - `investigating` can transition to: `["reserved", "denied"]`
  - `reserved` can transition to: `["settled", "denied"]`
  - `settled` can transition to: `[]` (terminal)
  - `denied` can transition to: `[]` (terminal)

#### 2. Endpoint Behavioral Specification

| Endpoint | Scope | Input Validation & Normalization | Database & `claim_timeline` Side Effects | Response |
| :--- | :--- | :--- | :--- | :--- |
| **`POST /v1/claims/fnol`** | `claims:write` | Normalize `claim_type = body.claim_type ?? body.loss_type` and `loss_description = body.loss_description ?? body.description`. Require `policy_id`, `client_id`, `claim_type`, `loss_date`, `loss_description` (`<= 5000` chars). Validate `claim_type` in `CLAIM_TYPES`. Validate `loss_date` is valid `YYYY-MM-DD` and `<= today` (`code: "future_date"` if future). If `estimated_loss != null`, validate `>= 0`. | Generate `claim_id = CLM-${year}-${6_digit_random}`. Set `status = body.adjuster_id ? "assigned" : "reported"`, `reserve_amount = body.estimated_loss ?? null`. Insert into `claims`. Append `claim_timeline` event `event_type: "fnol_received"`, `description: "FNOL received. Claim created."`, `new_value: initialStatus`. | `201 Created` with created claim row |
| **`GET /v1/claims`** | `claims:read` | Optional filters: `status` (`CLAIM_STATUSES`), `claim_type` (`CLAIM_TYPES`), `client_id`, `policy_id`, `adjuster_id`, plus `limit` and `cursor` via `parsePaginationParams`. | Query `prisma.claim.findMany` ordered by `created_at: "desc", claim_id: "desc"` with cursor pagination (`buildCursorWhere` + `paginatedResponse`). | `200 OK` paginated response (`{ data, pagination }`) |
| **`GET /v1/claims/:claim_id`** | `claims:read` | Require existing `claim_id` (else `notFoundError("claim")`). | Fetch `claim`, assigned `adjuster` (if `adjuster_id` set), `timeline` (`orderBy: { created_at: "asc" }`), and `documents`. | `200 OK` with `{ ...claim, adjuster, timeline, documents }` |
| **`POST /v1/claims/:claim_id/assign`** | `claims:assign` | Require `adjuster_id`. Verify claim exists (`404` if missing) and adjuster exists (`404` if missing). If `!adjuster.active`, throw `validationError` (`field: "adjuster_id"`, `code: "invalid_enum"`). Count open claims (`adjuster_id`, `status: { notIn: ["settled", "denied"] }`); if `openCount >= adjuster.max_open_claims`, throw `validationError` (`field: "adjuster_id"`, `code: "out_of_range"`). | Update `adjuster_id` and `updated_at` (plus `status = "assigned"` if `claim.status === "reported"`). Append `claim_timeline` event `event_type: "assignment"` (`old_value: claim.adjuster_id`, `new_value: body.adjuster_id`), and if transitioning from `reported`, append `event_type: "status_change"` (`old_value: "reported"`, `new_value: "assigned"`). | `200 OK` with updated claim row |
| **`PATCH /v1/claims/:claim_id`** | `claims:write` | Require at least one of `status`, `reserve_amount`, `settlement_amount`, `notes` (else `validationError` on `field: "body"`, `code: "required"`). Validate `status` in `CLAIM_STATUSES`, `reserve_amount >= 0`, `settlement_amount >= 0`, `notes <= 5000`. If `body.status !== claim.status`, enforce `STATUS_TRANSITIONS[claim.status]` (`code: "invalid_enum"` on illegal transition). | Update claim fields and `updated_at`. Append `claim_timeline` events for each changed attribute: `status_change` (when `status` changes), `reserve_change` (when `reserve_amount` changes), and `note` (`description: "Notes updated."` when `notes` changes). | `200 OK` with updated claim row |
| **`GET /v1/claims/:claim_id/timeline`** | `claims:read` | Verify claim exists (`404` if missing). | Query `prisma.claimTimeline.findMany` where `claim_id`, `orderBy: { created_at: "asc" }`. | `200 OK` with `{ data: events }` |
| **`POST /v1/claims/:claim_id/documents`** | `claims:documents` | Require `document_type` (in `DOCUMENT_TYPES`), `file_name` (`<= 255`), `file_path` (`<= 1000`). Verify claim exists (`404` if missing). | Create `claimDocument` with `document_id = DOC-${uuid8}` and `uploaded_at = now`. Append `claim_timeline` event `event_type: "document_upload"`, `new_value: document_id`. | `201 Created` with created document row |
| **`GET /v1/adjusters`** | `claims:read` | Optional filters: `specialty` (in `ADJUSTER_SPECIALTIES`) and `active` (`"true"` or `"false"`, else `validationError` on `field: "active"`). | Fetch matching adjusters (`orderBy: { adjuster_id: "asc" }`). For each adjuster, count open claims (`status: { notIn: ["settled", "denied"] }`) and return `active: Boolean(adj.active)` and `open_claims_count`. | `200 OK` with `{ data: results }` |

---

## 3. The 60-Second Phoenix Drill

### Step 1: Delete the Disposable Service Implementation

From the repository root, delete both route implementation files in `services/claims`:

```bash
rm services/claims/src/routes/claims.ts services/claims/src/routes/adjusters.ts
```

### Step 2A: Regenerate with Claude Code (`claude`)

Copy and paste the following prompt into **Claude Code** (or run `claude -p`):

```text
Regenerate the deleted disposable route handlers `services/claims/src/routes/claims.ts` and `services/claims/src/routes/adjusters.ts` for the `:3007` Claims microservice.

Strict Hexagonal Port & Contract Rules:
1. Read these frozen contracts first:
   - `specs/claims.yaml` (OpenAPI 3.0 syntactic wire contract: routes, scopes, JSON schemas)
   - `specs/claims.behavior.yaml` (Formal Behavioral Contract: finite state machine `transitions`, `input_aliases`, `requires` preconditions, `ensures` postconditions, `timeline_effects`, and `workflows`)
   - `services/claims/src/schema.ts` and `services/claims/src/index.ts`
   - `services/claims/src/__tests__/claims.test.ts`
2. Do NOT edit `specs/claims.yaml`, `specs/claims.behavior.yaml`, `services/claims/src/schema.ts`, `services/claims/src/index.ts`, `packages/shared/*`, or any test file under `services/claims/src/__tests__/`.
3. Use Hono (`new Hono<AppVariables>()`), `prisma` from `../prisma`, and shared helpers from `@evergreen/shared` (`requireScopes`, `parsePaginationParams`, `buildCursorWhere`, `paginatedResponse`, `notFoundError`, `validationError`, `checkRequired`, `checkEnum`, `checkMaxLength`, `checkRange`, `throwIfErrors`).
4. Export `{ claimsRouter }` from `services/claims/src/routes/claims.ts` and `{ adjustersRouter }` from `services/claims/src/routes/adjusters.ts`.
5. Run `cd services/claims && bun test` and `bun run showcase:check` until 100% of unit, formal behavioral contract, and showcase checks pass with zero modifications to frozen files.
```

### Step 2B: Regenerate with Antigravity / Jetski (Stateless Goldfish Session)

Open a fresh **Antigravity / Jetski** conversation with clean context and run:

```text
Execute the Phoenix Drill in `prompts/REGENERATE.md` for `services/claims`:
1. Read `specs/claims.yaml`, `specs/claims.behavior.yaml`, `services/claims/src/schema.ts`, `services/claims/src/index.ts`, and `services/claims/src/__tests__/claims.test.ts`.
2. Regenerate `services/claims/src/routes/claims.ts` (`export { claimsRouter }`) and `services/claims/src/routes/adjusters.ts` (`export { adjustersRouter }`) to satisfy every OpenAPI wire schema and every state-machine transition, guard (`requires`), and `claim_timeline` side-effect (`ensures`) in `specs/claims.behavior.yaml`.
3. Keep all Driving Ports, behavioral specs, schemas, and tests untouched (`git diff --exit-code specs/ services/claims/src/schema.ts services/claims/src/__tests__/`).
4. Verify in under 5 seconds via `cd services/claims && bun test` and `bun run showcase:check`.
```

### Step 3: Deterministic Verification Gate (`< 5 Seconds`)

```bash
# 1. Run the Claims unit + formal behavioral contract suite (< 1s):
cd services/claims && bun test && cd ../..

# 2. Verify zero drift across all frozen Driving Ports, behavioral specs, schemas, and tests:
git diff --exit-code specs/claims.yaml specs/claims.behavior.yaml services/claims/src/schema.ts services/claims/src/index.ts services/claims/src/__tests__/

# 3. Verify all 8 microservices and the Executive Workbench preflight:
bun run showcase:check
```
