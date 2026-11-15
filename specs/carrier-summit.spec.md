# Summit Fire & Casualty carrier portal (`carrier-summit`, port 3005): behaviour specification

This document, together with the durable contracts listed below, is meant to be enough to rebuild the service implementation from nothing. It describes only what a client can observe over HTTP and in the service's database tables, plus a page-level contract for the portal's browser UI. Every rule has an id (`SMT-Rn`) that the conformance tests in [`tests/conformance/carrier-summit/`](../tests/conformance/carrier-summit/) cite.

Where this document and [`carrier-summit.yaml`](carrier-summit.yaml) disagree, this document describes what the service does today; each disagreement is listed under [Known gaps](#known-gaps).

## Purpose

Summit Fire & Casualty is a simulated insurance carrier that writes property business. Its portal lets an agent submit a property for a quote, follow the inspection and the underwriting conditions that the submission triggers, record an underwriting decision, and list the documents of an issued policy.

The portal has two faces served by one process: a JSON API under `/v1/summit`, and a single-page browser UI served from `/`. In strict mode the API only answers requests that come from a browser session that loaded the UI (see [Portal session](#portal-session-and-strict-mode)), which forces an automated agent to work through the page the way a person would.

## Durable contracts

| Contract | Path |
| :--- | :--- |
| API wire contract (OpenAPI 3.0) | [`specs/carrier-summit.yaml`](carrier-summit.yaml) |
| Behaviour (this file) | [`specs/carrier-summit.spec.md`](carrier-summit.spec.md) |
| Table definitions | [`services/carrier-summit/prisma/schema.prisma`](../services/carrier-summit/prisma/schema.prisma) |
| Package manifest: entry points and dependencies | [`services/carrier-summit/package.json`](../services/carrier-summit/package.json) |
| Seed data | `quotes.json` and `policies.json` in [`data/seed/`](../data/seed/) and [`data/seed-clean/`](../data/seed-clean/) |
| Browser UI: source and built bundle | [`services/carrier-summit/ui/`](../services/carrier-summit/ui/), [`services/carrier-summit/public/`](../services/carrier-summit/public/) |
| Shared package: tokens, scopes, error envelope, validation helpers, correlation id, request log, chaos, strict mode and portal sessions, `/sim/*` control plane | [`packages/shared/`](../packages/shared/) |
| Conformance tests | [`tests/conformance/carrier-summit/`](../tests/conformance/carrier-summit/) |

The UI and the shared package are part of the durable set: a rebuild of the service keeps them and serves them. This document says how the service must use them and what the result looks like on the wire.

## Data model and invariants

Four tables. Column names and types are those of the Prisma schema. Timestamps are ISO-8601 strings; dates are `YYYY-MM-DD` strings.

**`quotes`**: one row per quote from this carrier.

| Column | Notes |
| :--- | :--- |
| `quote_id` | Primary key. Seed rows: `QT-NNN-SMIT`. Submissions: `QT-SMIT-<epoch milliseconds>`. |
| `request_id` | Seed: `QR-NNN`. Submissions: `QR-<epoch milliseconds>`. |
| `client_id`, `policy_type` | Free text, not checked against any other service. |
| `premium_annual`, `premium_monthly` | Nullable numbers. |
| `coverages` | JSON-encoded array. |
| `deductibles` | JSON-encoded object. |
| `status` | Seed values `quoted`, `declined`, `bound`, `underwriting_hold`, `pending`; submissions are `submitted`; time travel adds `expired`. |
| `decline_reason`, `valid_until` | Nullable. `valid_until` is a date. |
| `submitted_at` | Timestamp. |
| `underwriting_status` | `pending_review`, `approved`, `declined` or `referred`. |
| `underwriting_notes` | Nullable. |
| `property_address`, `property_details` | JSON-encoded objects; null on seed rows. |
| `photo_checklist` | JSON-encoded array; null on seed rows. |
| `inspection_status` | `not_scheduled` (seed rows) or `scheduled` (submissions). |
| `inspection_scheduled_at`, `inspection_completed_at`, `inspection_notes` | Nullable. Only `inspection_scheduled_at` is ever set. |

**`policies`**: `policy_id` (primary key), `client_id`, `policy_type`, `effective_date`, `expiration_date`, `premium_current`, `status`, `coverages` (JSON-encoded array), `created_at`, `updated_at`. The API never creates a policy; rows come from seed data.

**`policy_documents`**: `document_id` (primary key, `SDOC-NNN`), `policy_id`, `document_type`, `filename`, `file_size_bytes`, `version` (default 1), `supersedes` (nullable), `created_at`.

**`underwriting_conditions`**: `condition_id` (primary key, `COND-<quote_id>-<n>`), `quote_id`, `condition_type`, `description`, `status` (default `pending`), `created_at`, `resolved_at` (nullable).

Invariants:

- **SMT-R1** The service owns exactly these four tables. `GET /sim/snapshot` returns them under the keys `quotes`, `policies`, `policy_documents`, `underwriting_conditions`, each sorted ascending by its primary key, with columns exactly as stored (JSON-encoded columns stay strings).
- **SMT-R2** Every `policy_documents.policy_id` names an existing policy and every `underwriting_conditions.quote_id` names an existing quote.
- **SMT-R3** JSON-encoded columns always hold valid JSON text and are returned decoded on the wire.
- **SMT-R4** No operation deletes a row. The API writes only to `quotes` (insert on submission, update on decision) and `underwriting_conditions` (insert on submission).
- **SMT-R5** The service calls no other service.

## Auth and scopes

- **SMT-R6** `GET /health` needs no token and returns `200` with `{ "status": "ok", "service": "carrier-summit", "timestamp": <ISO time> }`.
- **SMT-R7** `GET /auth/dev-token` needs no token and returns `200` with `{ "token": <JWT> }`. The token is valid for one hour, has subject `dev-user`, and carries exactly the four carrier scopes `carrier:quotes:read`, `carrier:quotes:write`, `carrier:underwriting:write`, `carrier:policies:read`. This is the token the browser UI uses.
- **SMT-R8** `POST /oauth/token` is the shared client-credentials endpoint and needs no token. For this service: `agent-full` holds all four carrier scopes; `agent-csr` holds all but `carrier:underwriting:write`; `agent-readonly` holds `carrier:quotes:read` and `carrier:policies:read`.
- **SMT-R9** Every route under `/v1/summit` requires `Authorization: Bearer <token>`. A missing or malformed header, a bad signature or an expired token gives `401` with `{ "error_code": "AUTH_ERROR", "message": ..., "correlation_id": ... }`.
- **SMT-R10** Each route checks one scope after the token check. A token without it gets `403` with `{ "error_code": "FORBIDDEN", "message": "Missing required scope(s): <scope>", "correlation_id": ... }`, and nothing is written.

  | Route (under `/v1/summit`) | Scope |
  | :--- | :--- |
  | `GET /quotes/{quote_id}` | `carrier:quotes:read` |
  | `POST /underwriting/{quote_id}/decision` | `carrier:underwriting:write` |
  | `GET /policies/{policy_id}/documents` | `carrier:policies:read` |
  | `POST /submissions` | `carrier:quotes:write` |
  | `GET /inspections/{quote_id}` | `carrier:quotes:read` |
  | `GET /inspections/{quote_id}/conditions` | `carrier:quotes:read` |

- **SMT-R11** Order of checks on an API request: strict-mode session (SMT-R15), then token (`401`), then scope (`403`), then body validation (`400`), then existence (`404`), then state (`409`).
- **SMT-R12** Every response carries an `X-Correlation-ID` header, echoing the request's header when one was sent. Error bodies produced by the shared envelope repeat it as `correlation_id`.
- **SMT-R13** Error bodies use the shared envelope: `{ "error_code", "message", "correlation_id" }`, plus `details` (an array of `{ "field", "message", "code" }`) for validation errors. Validation errors are status `400` with `error_code` `VALIDATION_ERROR` and message `One or more fields failed validation.`. Not found is `404` `NOT_FOUND` with message `<thing> not found.`. A state conflict is `409` `CONFLICT`.

## Portal session and strict mode

The process reads `MODALITY_MODE` from its environment. Any value other than `strict` (ignoring case), or no value, means permissive mode. `GET /sim/status` reports the value as `modality_mode`.

- **SMT-R14** Bootstrap cookie. A `GET /` or `GET /index.html` response carries, in both modes, a `Set-Cookie` header: `evergreen_portal_boot_carrier-summit=<uuid>; HttpOnly; SameSite=Strict; Path=/`. Each load issues a fresh value; earlier values stay valid. No other response sets it, including the HTML returned for other paths (SMT-R35) and a `HEAD /`.
- **SMT-R15** Session endpoint. `GET /auth/portal-session` needs no bearer token and returns `200` with `{ "session_token": "portal_sess_carrier-summit_<uuid>", "service": "carrier-summit", "modality": "web-portal", "header": "X-Portal-Session", "expires_in": 3600 }`. Each call issues a new token; earlier tokens stay valid.
  - In permissive mode it answers every request, with or without a cookie.
  - In strict mode the request must send a `Cookie` header containing a bootstrap cookie value this process issued and that has not expired. Otherwise the answer is `403` with `{ "error_code": "PORTAL_BOOTSTRAP_REQUIRED", "message": ..., "correlation_id": ... }`.
- **SMT-R16** Strict guard. In strict mode every request under `/v1/summit` must send an `X-Portal-Session` header holding a session token this process issued and that has not expired. Otherwise the answer is `403` with `{ "error_code": "MODALITY_VIOLATION", "message": ..., "correlation_id": ... }`. The guard runs before the token check, so a request with neither token nor session gets `403`, and a request with a valid session and no bearer token gets `401`. A valid session does not replace the bearer token or the scope.
- **SMT-R17** In permissive mode the `X-Portal-Session` header is ignored: requests succeed without it and with an unknown value.
- **SMT-R18** Lifetime. Bootstrap cookies and session tokens live for 3600 seconds of wall-clock time; time travel does not expire them. They are held in the memory of the issuing process: a token from another service (for example `carrier-coastal`) or from before a restart is unknown. `POST /sim/reset` and `POST /sim/seed` discard every cookie and session, so a client must load `/` and fetch a session again afterwards.
- **SMT-R19** Scorer exemption. In strict mode a request under `/v1/summit` that carries `X-Eval-Scorer: true` passes the guard without a session and is then handled normally (token and scope still apply). If the process has `EVERGREEN_SCORER_SECRET` set, the request must also carry that value in `X-Evergreen-Scorer-Secret`. The `X-Evergreen-Internal` header does not exempt a request.
- **SMT-R20** Strict mode leaves `/health`, `/auth/dev-token`, `/oauth/token`, `/sim/*` and the static UI open.

The handshake a browser, or a test acting as one, performs in strict mode:

1. `GET /` and keep the bootstrap cookie.
2. `GET /auth/dev-token` for a bearer token.
3. `GET /auth/portal-session` with the cookie, for a session token.
4. Call `/v1/summit/...` with `Authorization: Bearer <token>` and `X-Portal-Session: <session token>`.

## Rules per operation

Paths are relative to `/v1/summit`. "Now" is wall-clock time (see [Simulated clock](#simulated-clock)).

### `GET /quotes/{quote_id}` (getQuote)

- **SMT-R21** Unknown id: `404`, message `quote not found.`. Otherwise `200` with `quote_id`, `request_id`, `client_id`, `policy_type`, `premium_annual`, `premium_monthly`, `coverages` (array), `deductibles` (object), `status`, `decline_reason`, `valid_until`, `submitted_at`, `underwriting_status`, `underwriting_notes`. Property and inspection columns are not part of this response.

### `POST /underwriting/{quote_id}/decision` (submitUnderwritingDecision)

Body: `{ "decision": "approve" | "decline" | "refer", "notes"?: string }`.

- **SMT-R22** Validation, before the quote is looked up: `decision` missing or null gives detail `{ field: "decision", code: "required" }`; a value outside the three gives `{ field: "decision", code: "invalid_enum" }`; the empty string gives both, `required` first. The past-tense words `approved`, `declined` and `referred` are not accepted. Status `400`.
- **SMT-R23** Unknown quote: `404`, message `quote not found.`.
- **SMT-R24** If the quote's `underwriting_status` is already `approved` or `declined`: `409` with message `Quote already has underwriting decision '<status>'.`, and the row is unchanged.
- **SMT-R25** Otherwise the row is updated: `underwriting_status` becomes `approved`, `declined` or `referred` for `approve`, `decline`, `refer`; `underwriting_notes` becomes `notes`, or null when `notes` is absent (an earlier note is overwritten). No other column changes; in particular the quote's `status` and `decline_reason` stay as they were, and no policy is created.
- **SMT-R26** The response is `200` with the quote in the shape of SMT-R21 after the update, plus `decided_at` (now). `decided_at` is not stored.

### `GET /policies/{policy_id}/documents` (getPolicyDocuments)

- **SMT-R27** Unknown policy: `404`, message `policy not found.`. Otherwise `200` with `{ "policy_id", "document_count", "documents": [ { "document_id", "document_type", "filename", "file_size_bytes", "created_at" } ] }`. `document_count` equals the array length. `version` and `supersedes` are not returned. A policy with no documents returns an empty array.

### `POST /submissions` (submitProperty)

Body: `client_id`, `policy_type`, `property_address` (object), `property_details` (object), `coverages` (array), and optionally `deductibles` (object) and `photo_checklist` (array).

- **SMT-R28** Validation: `client_id`, `policy_type`, `property_address`, `property_details` and `coverages` are required. Each one that is missing, null or the empty string adds a detail `{ field, code: "required" }`, in that order, and all are reported together with status `400`. An empty object or empty array counts as present. Nothing else is validated: types, the contents of the objects, the policy type and the client are accepted as given.
- **SMT-R29** Premium. With `sqft` = `property_details.square_feet`, or 2000 when absent or zero, and `year` = `property_details.year_built`, or 2000 when absent or zero:
  - age factor = `max(0, 1 - (2026 - year) * 0.005)`
  - `premium_annual` = `sqft * 0.85 * age factor`, rounded to cents
  - `premium_monthly` = `premium_annual / 12`, rounded to cents

  Example: 2400 square feet built in 1996 gives 1734.00 a year and 144.50 a month. The year 2026 is a constant of the formula, not the current year.
- **SMT-R30** One `quotes` row is inserted: `quote_id` `QT-SMIT-<epoch milliseconds now>`; `request_id` `QR-<epoch milliseconds now>`; `client_id`, `policy_type` as given; the premiums of SMT-R29; `coverages`, `property_address`, `property_details` JSON-encoded as given; `deductibles` as given or `{}`; `photo_checklist` as given or `[]`; `status` `submitted`; `underwriting_status` `pending_review`; `submitted_at` now; `inspection_status` `scheduled`; `inspection_scheduled_at` now plus seven days; every other nullable column null.
- **SMT-R31** Three `underwriting_conditions` rows are inserted for the quote, with ids `COND-<quote_id>-1` to `-3`, `status` `pending`, `created_at` equal to the quote's `submitted_at`, `resolved_at` null:

  | n | `condition_type` | `description` |
  | :--- | :--- | :--- |
  | 1 | `inspection_required` | `4-point inspection report required (roof, electrical, plumbing, HVAC)` |
  | 2 | `document_required` | `Proof of prior insurance coverage required` |
  | 3 | `document_required` | `Property photos must be reviewed and verified` |

- **SMT-R32** The response is `201` with `quote_id`, `request_id`, `client_id`, `policy_type`, `premium_annual`, `premium_monthly`, `status` (`submitted`), `inspection_status` (`scheduled`), `inspection_scheduled_at`, `conditions_count` (3), `submitted_at`.

### `GET /inspections/{quote_id}` (getInspectionStatus)

- **SMT-R33** Unknown quote: `404`, message `quote not found.`. Otherwise `200` with `quote_id`, `inspection_status`, `inspection_scheduled_at`, `inspection_completed_at`, `inspection_notes`, `property_address` and `property_details` (decoded objects, or null when the column is null).

### `GET /inspections/{quote_id}/conditions` (getInspectionConditions)

- **SMT-R34** Unknown quote: `404`, message `quote not found.`. Otherwise `200` with `{ "quote_id", "conditions_count", "conditions": [ { "condition_id", "condition_type", "description", "status", "created_at", "resolved_at" } ] }`. `conditions_count` equals the array length. A quote with no conditions (every seed quote) returns an empty array, not `404`.

### Static UI

- **SMT-R35** `GET /` and `GET /index.html` return the portal page as `text/html`. Files under `/assets/` named by that page are served with their own content type. Any other `GET` path that matches no API route and no file returns the same page (so a deep link reloads the application), without a bootstrap cookie.

### Latency

- **SMT-R36** When the process has `CARRIER_LATENCY_MS` set to a positive number, every authenticated `/v1/summit` request waits that many milliseconds after the token check and before it is handled. Default is no delay.

## Browser UI: page-level contract

The UI is a single page titled "Summit Fire & Casualty — Commercial Agent Portal". It has a header ("SUMMIT FIRE & CASUALTY", "Property Portal"), three tabs, and the footer "Training Environment — Not for Production Use". The page loads without calling the API; calls happen on user actions.

How the page talks to the API (every screen):

- **SMT-R37** On its first API call the page fetches `GET /auth/dev-token` and `GET /auth/portal-session` and keeps both in memory. Every API request sends `Content-Type: application/json`, `Authorization: Bearer <dev token>` and `X-Portal-Session: <session token>`. A session is renewed when it has less than a minute to live. If `/auth/portal-session` answers `403`, the page reloads `/` once to get a fresh bootstrap cookie and asks again. If an API call answers `403` with `MODALITY_VIOLATION`, the page drops its session, gets a new one and repeats the call once. Any other non-success answer is shown to the user as the response's `message`.

Screens:

**Property Submission** (first tab, shown on load). A four-step form with a step indicator, "Back" and "Next" buttons, and "Submit Property" on the last step.

| Step | Fields | Needed to continue |
| :--- | :--- | :--- |
| 1 Address | Street Address, City, State (2 characters), ZIP Code (10 characters) | all four |
| 2 Property Details | Year Built, Square Footage, Construction Type (Frame, Masonry, Masonry Veneer, Fire Resistive, Superior), Roof Type (Asphalt Shingle, Metal, Tile, Slate, Wood Shake, Flat / Membrane), Roof Year, Heating Type (Forced Air, Radiant, Heat Pump, Baseboard, Wood Stove) | year, square footage, construction type, roof type |
| 3 Photo Checklist | seven checkboxes: Front Exterior, Rear Exterior, Roof View, Kitchen, Bathroom, Electrical Panel, HVAC System | nothing |
| 4 Coverage | Dwelling Limit, Personal Property Limit, Liability Limit, Deductible ($500, $1,000, $2,500, $5,000, $10,000) | dwelling limit, deductible |

Action: "Submit Property" sends `POST /v1/summit/submissions`. On success the page shows "Property submission created successfully." and returns to step 1 with an empty form. On failure it shows the error message and keeps the form.

**Underwriting Review** (second tab). A search box ("Enter quote ID to review") and a "Look Up" button.

- Look-up sends `GET /v1/summit/quotes/{id}` and then `GET /v1/summit/inspections/{id}/conditions`. An unknown quote shows the error message.
- Quote Details card: Quote ID, Client ID, Policy Type, and Underwriting Status as a badge.
- Review Timeline card: six steps (Submitted, Inspection Scheduled, Inspection Complete, Documents Received, Under Review, Decision). `pending_review` marks "Under Review" as current; `approved`, `declined` and `referred` mark "Decision" as current; earlier steps show as completed.
- Conditions card, only when the quote has conditions: each condition's description and status.
- Decision card: when `underwriting_status` is `pending_review`, a notes box ("Optional underwriting notes...") and three buttons, "Approve", "Decline", "Refer", each sending `POST /v1/summit/underwriting/{id}/decision` and then reloading the quote. For any other status the card says "This quote has already been reviewed (<status>)." and offers no buttons.

**Policy Documents** (third tab). A search box ("Enter policy ID (e.g. POL-001)") and a "Search" button.

- Search sends `GET /v1/summit/policies/{id}/documents`.
- Result: a table with Type (title case, for example "Dec Page"), Filename, Version, Size (B, KB or MB) and Created (date). "No documents found for this policy." when the list is empty. An unknown policy shows the error message.

What a browser user must be able to complete:

- **SMT-R38** Load the portal in strict mode and use any screen without ever handling a token: the page performs the handshake of SMT-R14 to SMT-R16 by itself and recovers from a lost session (SMT-R37).
- **SMT-R39** Look up a quote by id and see its client, policy type, underwriting status, timeline position and conditions.
- **SMT-R40** List the documents of a policy by id.
- **SMT-R41** Submit a property and have a quote created with an inspection scheduled and three conditions (SMT-R30, SMT-R31).
- **SMT-R42** Record an approve, decline or refer decision, with optional notes, on a quote that is pending review, and see the new status.

SMT-R41 and SMT-R42 cannot be completed with the UI as shipped; see Known gaps 7 and 8.

## State machines

**Underwriting status** (`quotes.underwriting_status`), moved only by the decision operation:

| From | `approve` | `decline` | `refer` |
| :--- | :--- | :--- | :--- |
| `pending_review` | `approved` | `declined` | `referred` |
| `referred` | `approved` | `declined` | `referred` |
| `approved` | `409` | `409` | `409` |
| `declined` | `409` | `409` | `409` |

**Quote status** (`quotes.status`): set at creation (`submitted` for submissions, the seed value otherwise). The only transition is `quoted` to `expired`, by time travel (SMT-R46). An underwriting decision does not change it.

**Policy status**: `active` to `expired`, by time travel only (SMT-R46).

**Inspection status**: `not_scheduled` or `scheduled` from creation; nothing completes an inspection. **Condition status**: `pending` from creation; nothing resolves a condition.

## Facts that depend on seed data

- **SMT-R43** `POST /sim/reset` (optional body `{ "seed_mode": "realistic" | "clean" }`, default from `SEED_MODE`, else `realistic`; any value other than `clean` loads the realistic set) drops and recreates the four tables and loads seed data from `data/seed/` or `data/seed-clean/`. `POST /sim/seed` with `base: "empty"` recreates the tables and loads nothing before inserting the rows given in the request.
- **SMT-R44** Seed mapping.
  - Quotes: every entry of `results` in `quotes.json` whose `carrier_code` is `SMIT` becomes a row. `quote_id`, premiums, `coverages`, `deductibles`, `status`, `decline_reason`, `valid_until` come from the result; `request_id`, `client_id`, `policy_type`, `submitted_at` from the enclosing request. `underwriting_status` is `declined` when the result's status is `declined`, `approved` when it is `bound`, and `pending_review` otherwise. `underwriting_notes` is null, `inspection_status` is `not_scheduled`, property and inspection columns are null.
  - Policies: every entry of `policies.json` whose `carrier_code` is `SMIT`, columns copied, `coverages` JSON-encoded.
  - Documents: three per policy, in file order of the policies, numbered across all policies from `SDOC-001`: `dec_page` (`<slug>_declarations.pdf`, base size 180000), `id_cards` (`<slug>_id_cards.pdf`, base 95000), `policy_jacket` (`<slug>_policy_jacket.pdf`, base 450000). `<slug>` is the policy id in lower case with every character outside `a-z0-9` replaced by `_`. `file_size_bytes` is the base plus `((n + 1) * 1337) mod 50000`, where `n` is the document's number (1 for `SDOC-001`). `created_at` is the policy's; `version` 1; `supersedes` null.
  - `underwriting_conditions` starts empty.
- **SMT-R45** Facts the tests pin (the realistic and clean sets are the same for this carrier):

  | Fact | Value |
  | :--- | :--- |
  | Quotes | 14: 7 `quoted`, 4 `declined`, 1 `bound`, 1 `underwriting_hold`, 1 `pending` |
  | Underwriting status at seed | 9 `pending_review`, 4 `declined`, 1 `approved` |
  | Policies | 17: 15 `active`, 2 `expired` |
  | Documents | 51 |
  | `QT-001-SMIT` | client `CLI-003`, `personal_auto`, annual 1085, monthly 94.5, `quoted`, `pending_review`, valid until `2026-11-08` |
  | `QT-002-SMIT` | `declined` / `declined`, premiums null, with a decline reason |
  | `QT-007-SMIT` | `bound` / `approved` |
  | `POL-PA-2025-001847` | documents `SDOC-001` to `SDOC-003`; `SDOC-001` is `pol_pa_2025_001847_declarations.pdf`, 182674 bytes |

## Simulated clock

- **SMT-R46** `POST /sim/time-travel` moves the shared simulated clock and then, for this service:
  - every quote with `status` `quoted` and a `valid_until` date earlier than the simulated date becomes `expired`
  - every policy with `status` `active` and an `expiration_date` earlier than the simulated date becomes `expired`, and its `updated_at` becomes the simulated time

  The response's `transitions` is `{ "quotes_expired": <count>, "policies_expired": <count> }`. Dates equal to the simulated date do not expire. Quotes in any other status, and quotes without `valid_until`, are untouched.
- **SMT-R47** API operations follow the shared simulated clock (`getSimulatedNow()`, `nextSimulatedEpochMs()`, anchored at `2026-10-14T12:00:00.000Z` unless `SIMULATED_TODAY` overrides it): monotonic epoch-millisecond ids, `submitted_at`, `inspection_scheduled_at` and `decided_at` advance with `/sim/time-travel`. Portal session and bootstrap cookie lifetimes continue to use 3600s of wall-clock time. Reset and seed return the simulated clock to `2026-10-14T12:00:00.000Z` (`clock_offset_ms` = 0).

## Simulation control plane and request log

- **SMT-R48** The service mounts the shared control plane without authentication: `GET /sim/snapshot`, `POST /sim/reset`, `POST /sim/seed`, `POST /sim/time-travel`, `POST /sim/chaos`, `GET /sim/status`, `GET /sim/trace`.
- **SMT-R49** Chaos applies to `/v1/*` only: with `POST /sim/chaos` `{ "enabled": true, "error_rate": 1 }` every such request is answered with the configured status (default `503`) and `{ "error_code": "SERVICE_UNAVAILABLE", ... }` without running. `/health`, `/auth/*`, `/sim/*` and the UI are not affected. Reset and seed turn chaos off.
- **SMT-R50** Request log. Every `/v1/*` request is recorded as a span and returned by `GET /sim/trace` in OTLP JSON form, under resource attribute `service.name` = `carrier-summit`. A span's `url.full` and `server.port` use the canonical port 3005 whatever port the process listens on. Reset and seed clear the log.

## Runtime contract

What the rest of the repository relies on when it starts the service. The package manifest ([`services/carrier-summit/package.json`](../services/carrier-summit/package.json)) is part of the durable set and names the entry points, so a rebuild must put its code where the manifest looks for it.

- **SMT-R51** Entry points. The manifest's `start` script (`bun run src/index.ts`) starts the HTTP service, which also serves the built page from `services/carrier-summit/public/` (SMT-R35), and its `seed` script (`bun run src/seed.ts`) runs the seed script. The HTTP service listens on the port named by `PORT`, default 3005. The module `src/index.ts` has a default export `{ port, fetch }` and a named export `app` whose `fetch(request)` answers a request without a socket; the conformance harness uses `app` when it cannot bind a port.
- **SMT-R52** Database. The service keeps its tables in one SQLite file: the `file:` URL in `DATABASE_URL` when that is set; otherwise `carrier-summit.db` in the directory named by `EVERGREEN_DATA_DIR`; otherwise `services/carrier-summit/data/carrier-summit.db`. A missing directory is created. Starting the service does not create or fill the tables; `POST /sim/reset`, `POST /sim/seed` and the seed script do (SMT-R43).
- **SMT-R53** Seed script. Running the `seed` script drops and recreates the four tables in the database of SMT-R52, loads the data set named by `SEED_MODE` (`clean`; unset or any other value means realistic) with the same mapping as a reset, and exits with status 0. A running service on the same database sees the result at once.
- **SMT-R54** Access log. Every request the HTTP service answers is written to standard output as one line of JSON with `timestamp`, `method`, `path`, `status`, `duration_ms` and `correlation_id` (the value of SMT-R12), plus `query` when the request had a query string (personal data masked by the shared package) and `user_agent` when the request sent one.

## Known gaps

Disagreements between [`carrier-summit.yaml`](carrier-summit.yaml) and the service. The spec above follows the service.

1. **Validation status.** The OpenAPI file declares `422` for invalid bodies on the decision and submission operations. The service answers `400` (SMT-R13).
2. **Portal session is not in the OpenAPI file.** `GET /auth/portal-session`, the bootstrap cookie, the `X-Portal-Session` header and the `403` codes `MODALITY_VIOLATION` and `PORTAL_BOOTSTRAP_REQUIRED` are specified only here. `POST /oauth/token` and `/sim/*` are also outside the OpenAPI file.
3. **Enum values.** The OpenAPI schemas list fewer values than the service returns: `policy_type` (`auto`, `home`, `umbrella`; the data has `personal_auto`, `homeowners`, `bop` and others, and submissions accept any text), quote `status` (`quoted`, `approved`, `declined`; the service also has `bound`, `pending`, `underwriting_hold`, `submitted`, `expired`), `document_type` (`declaration`, `id_card`, `endorsement`, `cancellation`; the service has `dec_page`, `id_cards`, `policy_jacket`) and `inspection_status` (no `not_scheduled`).
4. **Server path.** The OpenAPI file lists `/health` and `/auth/dev-token` under the server URL ending in `/v1`. The service serves both at the root, without `/v1`.

Behaviour that looks unfinished and is specified as it is:

5. A decision never changes the quote's `status`, so an approved quote stays `quoted` and can later become `expired` by time travel (SMT-R25, SMT-R46).
6. Submission ids come from the clock in milliseconds; two submissions in the same millisecond collide on the primary key and the second fails with `500`. Malformed JSON on a POST route also gives `500`, not `400`.
7. **Property Submission screen.** The page collects `Client ID` and `Policy Type` alongside address, property details, photo checklist, and coverage limits, and posts `{ "client_id", "policy_type", "property_address", "property_details", "coverages", "deductibles", "photo_checklist" }` matching SMT-R28. Legacy malformed bodies (`{ "address", "property", "photos", "coverage" }`) remain refused with `400`.
8. **Underwriting Review decision buttons.** The page enables `Approve`, `Decline` and `Refer` for both `pending_review` and `referred` quotes (SMT-R24) and sends `approve`, `decline` and `refer` matching SMT-R22; past-tense enum values (`approved`, `declined`, `referred`) remain refused with `400`.
9. The Policy Documents table has a Version column, but the API does not return `version`, so it always shows "--".
10. An unknown `GET` path under `/v1/summit`, sent with a valid token, falls through to the UI page and returns `200` HTML rather than a JSON `404`.
11. Inspections are never completed and conditions are never resolved; no route does either.

What the conformance suite cannot prove over HTTP, and would need a real browser:

12. Everything the page does on its own: rendering of the three screens, which fields gate "Next" and "Submit", the timeline and badge display, the table formatting, and the session renewal and retry logic of SMT-R37. The suite checks that the page and its assets are served and that the served script contains the routes, headers and screen labels of this contract; it performs the same handshake the page performs and calls the same API routes with the same headers.
13. Browser cookie handling: that an `HttpOnly`, `SameSite=Strict` cookie is stored and sent back by a browser. The suite reads the `Set-Cookie` header and sends the cookie by hand.
14. SMT-R38 to SMT-R42 as user journeys. The suite proves the API half of each, and for SMT-R41 and SMT-R42 it proves that the bodies the shipped page sends are refused.
15. Expiry of cookies and sessions after one hour of wall-clock time is not waited for.

Strict mode, `EVERGREEN_SCORER_SECRET` and `CARRIER_LATENCY_MS` are tested on extra instances started with those variables. When the suite runs against an already deployed service these extra instances are not available.
