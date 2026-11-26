# Rater service: behaviour specification

This document states what the Rater service does, as seen over HTTP and in its database tables. Together with the files under "Durable contracts" it is meant to be enough to rebuild the service without reading the current code. Each rule has an id (`RTR-Rnn`). The tests in [`tests/conformance/rater/`](../tests/conformance/rater/) cite those ids.

## 1. Purpose

The service is the agency's comparative rater. It takes a quote request, produces one simulated quote per eligible carrier, reports the results, and binds a chosen quote after applying the agency's errors-and-omissions (E&O) guardrails. It also publishes the carrier directory with each carrier's appetite. It serves on port 3001 by default (`PORT` overrides it). It calls one other service, the AMS, and only to verify an escalation (RTR-R44).

## 2. Durable contracts

| Contract | File |
| :--- | :--- |
| HTTP operations, request and response schemas, scopes | [`rater.yaml`](rater.yaml) |
| Tables and columns | [`../services/rater/prisma/schema.prisma`](../services/rater/prisma/schema.prisma) |
| Seed data | [`../data/seed/`](../data/seed/) (`realistic`) and [`../data/seed-clean/`](../data/seed-clean/) (`clean`): `carriers.json`, `quotes.json` |
| Shared behaviour: token endpoint, bearer authentication, scope checks, error envelope, correlation id, pagination, `/sim/*` control plane, request log, binding-authority and state-minimum checks | [`../packages/shared/`](../packages/shared/) |
| Escalation lookup on the AMS (`GET /v1/escalations/{escalation_id}`) | [`ams.yaml`](ams.yaml) |

## 3. Data model and invariants

Three tables. All timestamps are text. Columns marked "JSON text" hold a JSON value serialised as text.

**`carriers`** (key `carrier_code`): `carrier_name`, `states` (JSON text, list of state codes), `policy_types` (JSON text), `risk_categories` (JSON text), `appetite_level`, `min_driver_age`, `max_vehicles`, `accepts_sr22`, `surplus_lines_only`, `sr22_available`, `citizens_eligible` (booleans), `state_restrictions` (JSON text). No operation writes this table.

**`quote_requests`** (key `request_id`): `client_id`, `policy_type`, `effective_date` (`YYYY-MM-DD`, nullable), `status`, `submitted_at`, `completed_at` (nullable), `expires_at` (nullable), `risk_data` (JSON text), `created_at`.

**`carrier_quotes`** (key `quote_id`): `request_id` (refers to `quote_requests`), `carrier_code`, `carrier_name`, `status`, `premium_annual`, `premium_monthly` (nullable numbers), `coverages` (JSON text, list), `deductibles` (JSON text, object), `decline_reason`, `valid_until`, `bound_at` (nullable), `created_at`.

Value sets:

- Policy types: `personal_auto`, `homeowners`, `umbrella`, `bop`, `workers_comp`, `general_liability`, `professional_liability`, `renters`.
- Payment methods: `eft`, `credit_card`, `check`, `mortgagee_billed`.
- Risk categories: `preferred`, `standard`, `non_standard`.
- Quote request statuses written by the service: `completed`, `pending`, `expired`. Seed data also holds `partial` and `requires_info`.
- Carrier quote statuses written by the service: `quoted`, `bound`, `expired`. Seed data also holds `declined`, `pending`, `error`, `underwriting_hold`.

Invariants:

- Timestamps written by the service are ISO 8601 in UTC with milliseconds.
- A request that fails (any 4xx or 5xx) writes no row.
- Binding changes one `carrier_quotes` row and nothing else. It creates no policy in any service.

## 4. Auth and scopes

- **RTR-R01** `GET /health` needs no credentials and returns `200` with `{ "status": "ok", "service": "rater", "timestamp": <ISO time> }`.
- **RTR-R02** `POST /oauth/token` needs no credentials and implements the OAuth 2.0 client-credentials grant from the shared package: body (JSON or form-encoded) with `grant_type`, `client_id`, `client_secret`, optional `scope`; `200` with `access_token`, `token_type: "Bearer"`, `expires_in: 3600`, `scope`. Clients `agent-full`, `agent-csr`, `agent-readonly` (read scopes only) with secret `dev-secret`. A wrong secret gives `401` with `error: "invalid_client"`.
- **RTR-R03** Every path under `/v1` requires `Authorization: Bearer <token>` with an unexpired token signed by the service (HS256, secret from `JWT_SECRET`, default `dev-secret`). Otherwise `401` with `error_code: "AUTH_ERROR"`. This runs before everything else, including for unknown paths under `/v1`.
- **RTR-R04** Each operation requires one scope. A token without it gets `403` with `error_code: "FORBIDDEN"` and a message naming the scope. The scope check runs before the body is read, before validation and before any lookup.

| Operation | Scope |
| :--- | :--- |
| `POST /v1/quotes/request` | `rater:quotes:create` |
| `GET /v1/quotes`, `GET /v1/quotes/{request_id}/results` | `rater:quotes:read` |
| `POST /v1/quotes/{quote_id}/bind` | `rater:quotes:bind` |
| `GET /v1/carriers`, `GET /v1/carriers/appetite` | `rater:carriers:read` |

- **RTR-R05** Errors use the shared envelope `{ "error_code", "message", "correlation_id", "details"? }`, except the E&O refusals of RTR-R42 to RTR-R44, which have their own body. A validation failure is `400` with `error_code: "VALIDATION_ERROR"`, `message: "One or more fields failed validation."` and `details`, a list of `{ "field", "message", "code" }`. Field codes used: `required`, `invalid_enum`, `invalid_format`. "Reported together" below means one response lists every failing field. A missing row is `404` with `error_code: "NOT_FOUND"`; a conflict is `409` with `error_code: "CONFLICT"`.
- **RTR-R06** Every response carries `X-Correlation-ID`: the request's value when sent, a fresh UUID otherwise. A shared-envelope error body's `correlation_id` has the same value.
- **RTR-R07** A write operation whose body is not valid JSON answers `400` with `error_code: "VALIDATION_ERROR"` (after RTR-R03 and RTR-R04) and writes nothing.

## 5. Rules per operation

### 5.1 List quote requests: `GET /v1/quotes`

- **RTR-R10** `200` with `{ "data": [...], "pagination": { "limit", "cursor", "next_cursor", "has_more" } }`, ordered by `request_id` ascending. Each item has `request_id`, `client_id`, `policy_type`, `effective_date`, `status` (as stored), `submitted_at`, `completed_at`, `created_at` and `carriers`: one entry per carrier quote of the request with `quote_id`, `carrier_code`, `carrier_name`, `status`, `premium_annual`, `premium_monthly`, `decline_reason`, `valid_until`. `quote_id` is null when the carrier quote's status is `declined`.
- **RTR-R11** Optional filters `client_id`, `policy_type`, `status` and `carrier_code` match exactly and are not validated: an unknown value gives an empty list (`carrier_code` keeps only quote requests with a matching carrier quote and filters their `carriers` list to that code). `cursor` pages by `{ "request_id" }`; a malformed cursor gives `400` with `cursor` / `invalid_format`.
- **RTR-R12** `limit` defaults to 50. A value that is not a number, or is 0, means 50. Other values are clamped to 1..100.

### 5.2 Submit a quote request: `POST /v1/quotes/request`

- **RTR-R20** All of the following are reported together:
  - `policy_type` is required and must be a policy type (`required`, `invalid_enum`).
  - `effective_date` is required and must match `^\d{4}-\d{2}-\d{2}$` (`required`, `invalid_format`).
  - `client` and `requested_coverages` are required.
  - When `client` is present: `client.first_name`, `client.last_name` and `client.address` are required. When `client.address` is present: `client.address.state` is required and must match `^[A-Z]{2}$` (`invalid_format`).
  - `policy_type` `personal_auto` requires `drivers` and `vehicles`. `homeowners` requires `property`.
  - `requested_coverages`, when not null, must be a non-empty array (`invalid_format`).

  "Required" means not missing, not null and not the empty string. An empty-string `policy_type` or `effective_date` is reported twice: as `required` and as `invalid_enum` or `invalid_format`. Field names in `details` use dots, for example `client.address.state`.
- **RTR-R21** The eligible carriers are the `carriers` rows whose `states` list contains `client.address.state` and whose `policy_types` list contains `policy_type`.
- **RTR-R22** One `quote_requests` row is written:
  - `request_id` = `qr_` followed by 1 to 8 random characters from `a-z0-9`.
  - `client_id` per RTR-R23, `policy_type` and `effective_date` as given.
  - `status` = `completed` and `completed_at` = now when at least one carrier is eligible; otherwise `status` = `pending` and `completed_at` = null.
  - `submitted_at` = `created_at` = now. `expires_at` = null.
  - `risk_data` = JSON text of `{ state, address, requested_coverages }` (state and address from `client.address`) plus `drivers`, `vehicles`, `property` and `business` when the body has them.

  One `carrier_quotes` row is written per eligible carrier:
  - `quote_id` = `qt_` followed by 1 to 8 random characters from `a-z0-9`; `request_id`; the carrier's code and name.
  - `status` = `quoted`. `premium_annual` is a random amount from 800 to 5000, rounded to cents. `premium_monthly` is `premium_annual / 12`, rounded to cents.
  - `coverages` = JSON text of `requested_coverages`. `deductibles` = `{}`. `decline_reason` and `bound_at` are null.
  - `valid_until` = now plus 30 days. `created_at` = now.
- **RTR-R23** `client_id` is the first of these that is present: body `client_id`; `client.client_id`; `client.id`; the id listed below for the lower-cased name `"<first_name> <last_name>"`; otherwise `<first_name>-<last_name>` in lower case.

  | Name | Id | Name | Id | Name | Id |
  | :--- | :--- | :--- | :--- | :--- | :--- |
  | sarah chen | CLI-001 | natasha brooks | CLI-012 | kevin tran | CLI-023 |
  | james chen | CLI-002 | william okafor | CLI-013 | rachel adams | CLI-024 |
  | maria rodriguez | CLI-003 | emily nakamura | CLI-014 | derek hawkins | CLI-025 |
  | david thompson | CLI-004 | george papadopoulos | CLI-015 | victor marsh | CLI-026 |
  | linda thompson | CLI-005 | ashley morales | CLI-016 | tanya marsh | CLI-027 |
  | marcus williams | CLI-006 | daniel reeves | CLI-017 | nathan blackwood | CLI-028 |
  | priya patel | CLI-007 | rosa jimenez | CLI-018 | kailani akana | CLI-029 |
  | robert kim | CLI-008 | tyler morrison | CLI-019 | sara chen | CLI-030 |
  | jennifer kim | CLI-009 | samantha west | CLI-020 | patricia kowalski | CLI-032 |
  | angela foster | CLI-010 | brian lawson | CLI-021 | andre washington | CLI-033 |
  | carlos gutierrez | CLI-011 | megan sullivan | CLI-022 | | |

- **RTR-R24** The answer is `202` with `{ request_id, status, created_at, estimated_completion, carriers_queried }`: `status` as stored, `estimated_completion` = now plus 2 minutes, `carriers_queried` = the number of eligible carriers.

### 5.3 Quote results: `GET /v1/quotes/{request_id}/results`

- **RTR-R30** Unknown request: `404 NOT_FOUND`, message `quote request not found.`
- **RTR-R31** `200` with `request_id`, `status` (RTR-R32), `policy_type`, `effective_date`, `created_at`, `completed_at` and `carriers`: one entry per carrier quote with `carrier_code`, `carrier_name`, `quote_id` (null when the quote is `declined`), `status`, `premium_annual`, `premium_monthly`, `coverages` and `deductibles` (as JSON values, not text), `decline_reason`, `valid_until`.
- **RTR-R32** The reported `status` is the stored status, except when the stored status is neither `completed` nor `requires_info` and the request has carrier quotes: then it is `completed` when no carrier quote is `pending`, `partial` when some but not all are `pending`, and the stored status when all are `pending`. The stored row is not changed.

### 5.4 Bind a quote: `POST /v1/quotes/{quote_id}/bind`

Checks run in this order and stop at the first failure.

- **RTR-R40** Reported together: `payment_method` is required and must be a payment method (`invalid_enum`); `producer_id`, `insured_signature_collected` and `insured_signature_date` are required; `insured_signature_date` must match `^\d{4}-\d{2}-\d{2}$` (`invalid_format`). Then, as a separate step: `insured_signature_collected` must be exactly `true`, otherwise `400` with `insured_signature_collected` / `invalid_format`. Both steps run before the quote is looked up.
- **RTR-R41** Unknown quote: `404 NOT_FOUND`, message `quote not found.` A quote with status `bound`: `409 CONFLICT`, message `Quote <quote_id> is already bound.` A quote with status `declined`: `409 CONFLICT`, message `Cannot bind declined quote <quote_id>.` Any other status besides `quoted` (`pending`, `expired`, `error`, `underwriting_hold`): `409 CONFLICT`, message `Cannot bind quote <quote_id> with status '<status>'.` A `quoted` row with a non-null `valid_until` whose `YYYY-MM-DD` date precedes the simulated agency date (`getSimulatedNow().toISOString().slice(0, 10)`): `409 CONFLICT`, message `Cannot bind expired quote <quote_id> (valid_until <valid_until>).` Only `quoted` rows with null or non-expired `valid_until` proceed.
- **RTR-R42** Premium threshold. When the quote's `premium_annual` is above 10000 the bind needs a manager escalation. Exactly 10000 does not. Without a non-empty `escalation_id` in the body the answer is `422`:

  ```json
  {
    "error": "E&O_RULES_TRIGGERED",
    "error_code": "E_EO_PREMIUM_THRESHOLD_EXCEEDED",
    "message": "This bind request triggers E&O rules that require manager escalation.",
    "details": [{ "field": "premium_annual", "message": "<rule message>", "code": "E_EO_PREMIUM_THRESHOLD_EXCEEDED" }],
    "eo_rules": [{ "rule": "premium_threshold", "error_code": "E_EO_PREMIUM_THRESHOLD_EXCEEDED", "message": "<rule message>" }]
  }
  ```

  The rule message is `Premium of $<premium with two decimals> exceeds the $10,000 threshold requiring manager approval.` These bodies have no `correlation_id`.
- **RTR-R43** State minimum limits (for quotes whose request has `policy_type` `personal_auto`) and backdating floor (`getBackdatingFloor()`, for any quote with a non-null `effective_date`). The state is the first present of `risk_data.state`, `risk_data.address.state` and `risk_data.garaging_state`; when none is present, `DEFAULT` (`25/50/10`) is checked first and any stricter `state` in the bind body is also enforced (`state` in the bind body never overrides a request state or lowers `DEFAULT`). The coverage items checked are `risk_data.requested_coverages` followed by the quote's `coverages`. If `effective_date` precedes `getBackdatingFloor()`, rule `backdating` (`E_EO_BACKDATING_PROHIBITED`, field `effective_date`) is added to `eo_rules` (waivable by an approved same-client `backdating` escalation when no other rule is violated).

  Minimums, as bodily injury per person / bodily injury per accident / property damage, in thousands of dollars: CA 30/60/15, TX 30/60/25, FL 10/20/10, NY 25/50/10, IL 25/50/20, PA 15/30/5, OH 25/50/25, GA 25/50/25, NC 50/100/50, MI 50/100/10. Any other or missing state uses 25/50/10 and is named `DEFAULT` in messages.

  Reading an item:
  - Its kind is the lower-cased `coverage_type`, else `type`, else `coverage`.
  - Kinds `bodily_injury`, `liability` and `bi` are checked against the per-person and per-accident minimums; `property_damage` and `pd` against the property damage minimum. Other kinds are not checked.
  - Limits come from numeric `per_person_limit` and `per_accident_limit` (or `per_occurrence_limit`), else from `limit` (or `limits`): a number, or text split on `/` into per person, per accident and, as a third part, property damage. A bodily injury item with a third part is also checked against the property damage minimum.
  - A number above 0 and below 1000 means thousands (`25` is 25000).

  The first violation found gives `422`, in the shape of RTR-R42 with `error_code` and `details[0].code` = `E_EO_STATE_MINIMUM_VIOLATION`, `details[0].field` = `coverages`, and `message` = `details[0].message` = the violation text:
  - `Bodily injury per-person limit ($<limit>) is below <state> statutory minimum of $<minimum> (<a/b/c>).`
  - `Bodily injury per-accident limit ($<limit>) is below ...`
  - `Property damage limit ($<limit>) is below ...`

  Amounts use thousands separators (`$25,000`). `eo_rules` lists the premium rule first when RTR-R42 also applies, then `{ "rule": "state_minimum_violation", ... }`. An escalation cannot waive this refusal: it is returned even when `escalation_id` is given, and the AMS is not called.
- **RTR-R44** Escalation check, when RTR-R42 applies and `escalation_id` is given. The service sends `GET <AMS base URL>/v1/escalations/<escalation_id, URL-encoded>` with the caller's `Authorization` header and the header `X-Evergreen-Internal: 1`. The AMS base URL is `AMS_BASE_URL` when set and not empty, else `AMS_URL`, else `http://localhost:3000`; trailing slashes are dropped.
  - A non-2xx answer gives `422` with `error: "ESCALATION_VERIFICATION_FAILED"`, `error_code: "E_EO_PREMIUM_THRESHOLD_EXCEEDED"`, message `Could not verify escalation <id>: <status>`, `details: [{ field: "escalation_id", message, code: "E_EO_PREMIUM_THRESHOLD_EXCEEDED" }]` and `eo_rules` as in RTR-R42.
  - A 2xx answer is accepted only when its `status` is `approved`, its `client_id` equals the quote request's `client_id` and its `reason` is `premium_threshold`. Otherwise `422` with `error: "ESCALATION_NOT_APPROVED"` and the same shape. The message names the first failing check, in this order: `Escalation <id> has status '<status>', but 'approved' is required.`; `Escalation <id> belongs to client '<client>', not '<request client>'.`; `Escalation <id> has reason '<reason>', but 'premium_threshold' is required.`
- **RTR-R45** On success the quote's `status` becomes `bound` and `bound_at` the current time. No other row changes: the request and its other quotes stay as they are, and `payment_method`, `producer_id` and the signature fields are not stored. The answer is `201`:
  - `policy_id` = `POL-<carrier_code>-<current year>-<six random digits>`
  - `quote_id`, `carrier_code`, `carrier_name`, `premium_annual`, `premium_monthly` from the quote
  - `effective_date` = the request's effective date, and `expiration_date` = the same calendar day one year later (`YYYY-MM-DD`), rolling over when that day does not exist (`2028-02-29` gives `2029-03-01`); both null when the request has no effective date
  - `bind_status` = `bound`, `bound_at`
  - `policy_documents_url` = `<ECM base URL>/v1/documents?client_id=<request.client_id, URL-encoded>` when the associated quote request has a `client_id`, otherwise `<ECM base URL>/v1/documents` (`ECM_BASE_URL`, else `ECM_URL`, else `http://localhost:3003`, without trailing slashes)
- **RTR-R46** When the AMS cannot be reached in RTR-R44, the answer is `500 INTERNAL_ERROR` and the quote stays unbound.

### 5.5 Carrier directory: `GET /v1/carriers` and `GET /v1/carriers/appetite`

- **RTR-R50** `GET /v1/carriers` returns `200` with `{ "data": [...], "pagination": { "limit", "cursor", "next_cursor", "has_more" } }`, ordered by `carrier_code` ascending. Each item is the `carriers` row with `states`, `policy_types`, `risk_categories` and `state_restrictions` as JSON arrays.
- **RTR-R51** Optional filters, combined with AND: `state`, `policy_type`, `risk_category`. `risk_category` matches exact array entries (so `standard` does not select carriers that list only `non_standard`) and must be one of the three risk categories, otherwise `400` with `risk_category` / `invalid_enum`. `state` and `policy_type` match inside the stored list text and are not validated.
- **RTR-R52** `limit` defaults to 25, is clamped to 1..100, and is ignored when not a number. `pagination.cursor` repeats the `cursor` parameter. When more rows exist, `has_more` is true and `next_cursor` is the base64 encoding of the JSON object `{ "carrier_code" }` of the last row; otherwise `has_more` is false and `next_cursor` is null. A cursor that cannot be decoded gives `400` with `cursor` / `invalid_format`.
- **RTR-R53** `GET /v1/carriers/appetite` is identical to `GET /v1/carriers` (RTR-R50 to RTR-R52).

## 6. State machines

Carrier quote `status`:

| From | To | Trigger |
| :--- | :--- | :--- |
| (none) | `quoted` | quote request submitted (RTR-R22) |
| `quoted` (and `valid_until` not past simulated date) | `bound` | bind (RTR-R41, RTR-R45) |
| `quoted` | `expired` | simulated clock passes `valid_until` (RTR-R110) |

Quote request `status`: created as `completed` or `pending` (RTR-R22); `pending` or `completed` becomes `expired` when the simulated clock passes `expires_at` (RTR-R110). Binding does not change it.

## 7. Facts that depend on seed data and the control plane

- **RTR-R100** `GET /sim/snapshot` returns `tables` with exactly `quote_requests`, `carrier_quotes` and `carriers`. `POST /sim/seed` with `base: "empty"` leaves all three present and empty.
- **RTR-R101** Both data sets hold:
  - 7 carriers: `CSTL`, `ERIE`, `HRTF`, `LIBT`, `NTNW`, `SAFECO`, `SMIT`.
  - 17 quote requests, `QR-001` onward: 15 `completed`, 1 `partial`, 1 `requires_info`; 9 personal_auto, 3 homeowners, 2 bop, 1 workers_comp, 1 renters, 1 general_liability. Seeded requests have `effective_date` null.
  - 54 carrier quotes: 31 `quoted`, 12 `declined`, 7 `bound`, 2 `pending`, 1 `error`, 1 `underwriting_hold`. None has a premium above 10000. Where a seeded quote has a `valid_until`, it is date-only text.
- **RTR-R102** `POST /sim/reset` and `POST /sim/seed` rebuild all three tables, discarding earlier writes.

## 8. Simulated clock

- **RTR-R110** Every `POST /sim/time-travel` (body `{ "days": <number> }` or `{ "target_date": <ISO date> }`; neither or invalid gives `400 VALIDATION_ERROR`) compares the new simulated time, as ISO text, with stored values. Quote requests with status `pending` or `completed` and a non-null `expires_at` earlier than it become `expired`. Carrier quotes with status `quoted` and a non-null `valid_until` earlier than it become `expired`. It answers `200` with `{ "status": "ok", "service": "rater", "simulated_time", "days_advanced", "transitions": { "quote_requests_expired": n, "carrier_quotes_expired": m } }`.
- **RTR-R111** The comparison runs on every call, including zero and negative days. On realistic/clean seed data at the `2026-10-14T12:00:00.000Z` baseline, `days: 0` expires requests and quotes whose `expires_at` / `valid_until` precedes `2026-10-14`.
- **RTR-R112** Request handling reads the shared simulated clock (`getSimulatedNow()`): `created_at`, `submitted_at`, `completed_at`, `estimated_completion`, `valid_until`, `bound_at` and the year in `policy_id` follow the simulated clock (`2026-10-14T12:00:00.000Z` plus `clock_offset_ms`).
- **RTR-R113** `POST /sim/seed` and `POST /sim/reset` reset the simulated clock to `2026-10-14T12:00:00.000Z` (`clock_offset_ms` = 0).

## 9. Calls to other services

One: the escalation lookup of RTR-R44, `GET /v1/escalations/{id}` on the AMS, made only when a bind exceeds the premium threshold, carries an `escalation_id` and has no state-minimum violation. Fields read from the answer: `status`, `client_id`, `reason`.

## 10. Runtime contract

What the service must provide besides its `/v1` operations. The token endpoint, the `/sim/*` control plane, fault injection and the request log come from [`../packages/shared/`](../packages/shared/); the service has to mount them as described here.

- **RTR-R120** Process. The service starts with `bun run src/index.ts` in `services/rater/` and listens on `PORT` (default 3001). The entry module's default export is `{ port, fetch }`, where `fetch` handles one HTTP request; it also exports `app` (whose `app.fetch` is the same handler) and `seedDatabase(mode)`. `bun run src/seed.ts` in the same directory rebuilds the database from the data set named by `SEED_MODE` (default `realistic`) and exits with code 0.
- **RTR-R121** Database. One SQLite file. Its location is `DATABASE_URL` (a `file:` URL) when set; otherwise `<EVERGREEN_DATA_DIR>/rater.db` when `EVERGREEN_DATA_DIR` is set; otherwise `services/rater/data/rater.db`. A missing directory is created. The seed script and the server resolve the location the same way, so they share the file.
- **RTR-R122** Seeding. Every seed (the seed script, `POST /sim/reset`, `POST /sim/seed`) drops and recreates all tables (`quote_requests`, `carrier_quotes`, `carriers`) and then loads a data set: mode `clean` reads `data/seed-clean/`, mode `empty` loads nothing, and any other mode reads `data/seed/`. Loading the same data set twice gives the same rows.
  `carriers.json` fills `carriers`, with `states`, `policy_types`, `risk_categories` and `state_restrictions` stored as JSON text. Each entry of `quotes.json` gives one `quote_requests` row and one `carrier_quotes` row per item of its `results`:
  - request: `request_id`, `client_id`, `policy_type`, `status`, `submitted_at` as given; `effective_date` and `expires_at` as given or null; `completed_at` = `submitted_at` when the status is `completed`, else null; `created_at` = `submitted_at`; `risk_data` = JSON text of `{ requested_coverages }` plus `drivers`, `vehicles`, `property`, `business` and `missing_fields` when present.
  - quote: `quote_id` as given, or `<request_id>-<carrier_code>-declined` when the item has none; `carrier_code`, `carrier_name`, `status` as given; `premium_annual`, `premium_monthly`, `decline_reason`, `valid_until` as given or null; `coverages` and `deductibles` as JSON text; `bound_at` = the request's `submitted_at` when the status is `bound`, else null; `created_at` = the request's `submitted_at`.

  The two data sets are identical for this service.
  `POST /sim/reset` takes the mode from `seed_mode` in its optional JSON body, else from `SEED_MODE`, else `realistic`, and answers `{ "status": "reset", "service": "rater", "seed_mode", "simulated_time" }`. `POST /sim/seed` takes `{ "base", "tables" }`: `base` is `empty` (default), `clean` or `realistic`; `tables` maps table names to rows inserted after the base is loaded, with nested JSON values stored as JSON text. With base `clean` or `realistic`, a row whose key already exists replaces the loaded row. It answers `{ "status": "seeded", "service", "base", "inserted": { table: count }, "simulated_time" }`. An unknown base or table name is `400 VALIDATION_ERROR` and changes nothing.
- **RTR-R123** `GET /sim/status` answers `{ "status": "ok", "service": "rater", "simulated_time", "clock_offset_ms", "chaos": { "enabled", "error_rate", "status_code", "latency_ms" }, "modality_mode" }`, where `modality_mode` is `MODALITY_MODE` or `"permissive"` by default. After a seed or reset `clock_offset_ms` is 0 and `chaos` is `{ false, 0, 503, 0 }`. `GET /sim/snapshot` answers `{ "service", "timestamp", "simulated_time", "tables" }`. Neither needs credentials.
- **RTR-R124** Fault injection. `POST /sim/chaos` takes `{ "enabled" (boolean, required), "error_rate" (0 to 1), "status_code", "latency_ms" }`; fields left out keep their value; a missing or non-boolean `enabled` is `400 VALIDATION_ERROR`; on success it answers `200` with `{ "status": "ok", "service": "rater", "chaos": { "enabled", "error_rate", "status_code", "latency_ms" } }`. While enabled, every request under `/v1` is first delayed by `latency_ms` and then, with probability `error_rate`, answered with `status_code` and `error_code: "SERVICE_UNAVAILABLE"` before authentication and before any handler runs, so nothing is written. `/health`, `/oauth/token` and `/sim/*` are never affected. A seed or reset switches fault injection off.
- **RTR-R125** Request log. Every request under `/v1`, whatever its outcome (including `401`), is recorded and returned by `GET /sim/trace`, oldest first, in OTLP JSON: `resourceSpans[0].resource.attributes` holds `service.name` = `rater`; `scopeSpans[0].scope.name` is `evergreen-request-log`; each span has `traceId` (32 hex characters), `spanId` (16), `name` = `<METHOD> <path>`, `kind` 3, start and end times in nanoseconds, and the attributes `http.request.method`, `url.full` = `http://localhost:3001<path and query>`, `http.response.status_code`, `server.port` = 3001 and `http.request.body` (the first 16 KiB of the request body as text). The port in these attributes is always 3001, whatever `PORT` says. Requests that carry `X-Evergreen-Internal: 1` are not recorded, and neither are `/health`, `/oauth/token` and `/sim/*`. A successful seed or reset empties the log.
- **RTR-R126** Access log. For every request it answers, on any path, the service writes one line of JSON to standard output: `timestamp` (ISO time), `method`, `path` (without the query string), `status`, `duration_ms` (whole milliseconds), `correlation_id` (the value of RTR-R06), `query` (an object of the query parameters, present only when the request has any) and `user_agent` (present only when the request sent one). Personal data in `query` values is masked: an email address becomes its first character, `***@` and its domain; phone and social security numbers keep their last four digits.

## 11. Known gaps

All OpenAPI contract contradictions (`RTR-G01`–`RTR-G10`, `RTR-G13`) have been resolved across code and `rater.yaml`. The remaining items below are non-blocking behavioral notes:

| Id | Note |
| :--- | :--- |
| RTR-G11 | `POST /sim/time-travel` compares ISO strings directly against stored date/date-time strings (RTR-R110). |
| RTR-G14 | Binding stores no payment, producer or signature data and creates no AMS policy; `policy_id` is deterministic-random per episode and `policy_documents_url` points to ECM `/v1/documents` (RTR-R45). |
| RTR-G15 | An unreachable AMS gives `500` rather than an E&O refusal (RTR-R46). |
| RTR-G16 | Values of the wrong JSON type are not validated; their outcome is not part of this contract. |
