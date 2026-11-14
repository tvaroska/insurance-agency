# CRM service: behaviour specification

This document states what the CRM service does, as seen over HTTP and in its database tables. Together with the files under "Durable contracts" it is meant to be enough to rebuild the service without reading the current code. Each rule has an id (`CRM-Rnn`). The tests in [`tests/conformance/crm/`](../tests/conformance/crm/) cite those ids.

## 1. Purpose

The service holds the agency's sales and marketing data: leads with an engagement score, marketing campaigns and the clients enrolled in them, and a retention-risk list of existing clients. It serves on port 3002 by default (`PORT` overrides it). It calls no other service.

## 2. Durable contracts

| Contract | File |
| :--- | :--- |
| HTTP operations, request and response schemas, scopes | [`crm.yaml`](crm.yaml) |
| Tables and columns | [`../services/crm/prisma/schema.prisma`](../services/crm/prisma/schema.prisma) |
| Seed data | [`../data/seed/`](../data/seed/) (`realistic`) and [`../data/seed-clean/`](../data/seed-clean/) (`clean`): `leads.json`, `campaigns.json`, `retention_risks.json` |
| Shared behaviour: token endpoint, bearer authentication, scope checks, error envelope, correlation id, pagination, `/sim/*` control plane, request log | [`../packages/shared/`](../packages/shared/) |

`crm.yaml` also describes webhook event payloads. The service sends no webhooks.

## 3. Data model and invariants

Four tables. All timestamps are text.

**`leads`** (key `lead_id`): `client_id` (nullable), `first_name`, `last_name`, `email`, `phone` (nullable), `source`, `status`, `score` (integer), `assigned_producer` (nullable), `tags` (JSON text holding an array), `notes` (nullable), `last_activity_date` (`YYYY-MM-DD`, nullable), `created_at`, `updated_at`.

**`campaigns`** (key `campaign_id`): `name`, `type`, `status`, `enrolled_count` (integer), `conversion_rate` (number). No operation creates or deletes campaigns; only `enrolled_count` changes.

**`campaign_enrollments`** (key `enrollment_id`): `campaign_id` (refers to `campaigns`), `client_id`, `trigger_reason` (nullable), `metadata` (JSON text, nullable), `enrolled_at`, `sequence_step` (integer).

**`retention_risks`** (key `client_id`): `client_name`, `risk_score` (integer), `rate_increase_pct`, `months_since_contact`, `email_open_rate`, `policies_count`, `recommended_action`, `assigned_producer` (all nullable). No operation writes this table.

Value sets:

- Lead statuses: `new`, `contacted`, `qualified`, `proposal_sent`, `closed_won`, `closed_lost`.
- Lead sources: `referral`, `web`, `cold_call`, `phone`, `partner`, `event`.
- Campaign statuses: `active`, `paused`, `completed`. Campaign types: `nurture`, `retention`, `cross_sell`, `welcome`.

Invariants:

- A lead over the API is the `leads` row with `tags` parsed from JSON text into a JSON value.
- `client_id` values are stored as given. They are not checked against any other service.
- Each successful enrollment adds exactly one `campaign_enrollments` row and adds 1 to the campaign's `enrolled_count`.
- Timestamps written by the service are ISO 8601 in UTC with milliseconds.
- A request that fails (any 4xx or 5xx) writes no row.

## 4. Auth and scopes

- **CRM-R01** `GET /health` needs no credentials and returns `200` with `{ "status": "ok", "service": "crm", "timestamp": <ISO time> }`.
- **CRM-R02** `POST /oauth/token` needs no credentials and implements the OAuth 2.0 client-credentials grant from the shared package: body (JSON or form-encoded) with `grant_type`, `client_id`, `client_secret`, optional `scope`; `200` with `access_token`, `token_type: "Bearer"`, `expires_in: 3600`, `scope`. Clients `agent-full`, `agent-csr`, `agent-readonly` with secret `dev-secret`. A wrong secret gives `401` with `error: "invalid_client"`.
- **CRM-R03** Every path under `/v1` requires `Authorization: Bearer <token>` with an unexpired token signed by the service (HS256, secret from `JWT_SECRET`, default `dev-secret`). Otherwise `401` with `error_code: "AUTH_ERROR"`. This runs before everything else, including for unknown paths under `/v1`.
- **CRM-R04** Each operation requires one scope. A token without it gets `403` with `error_code: "FORBIDDEN"` and a message naming the scope. The scope check runs before the body is read, before validation and before any lookup.

| Operation | Scope |
| :--- | :--- |
| `GET /v1/leads`, `GET /v1/leads/scoring`, `GET /v1/leads/{id}` | `crm:leads:read` |
| `POST /v1/leads`, `PATCH /v1/leads/{id}` | `crm:leads:write` |
| `GET /v1/campaigns` | `crm:campaigns:read` |
| `POST /v1/campaigns/{id}/enroll`, `POST /v1/leads/{id}/enroll` | `crm:campaigns:enroll` |
| `GET /v1/analytics/retention-risk` | `crm:analytics:read` |

- **CRM-R05** Errors under `/v1` use the shared envelope `{ "error_code", "message", "correlation_id", "details"? }`. A validation failure is `400` with `error_code: "VALIDATION_ERROR"`, `message: "One or more fields failed validation."` and `details`, a list of `{ "field", "message", "code" }`. Field codes used: `required`, `invalid_enum`, `out_of_range`, `too_long`, `invalid_format`. "Reported together" below means one response lists every failing field. A missing row is `404` with `error_code: "NOT_FOUND"` and message `lead not found.` or `campaign not found.`. A conflict is `409` with `error_code: "CONFLICT"`.
- **CRM-R06** Every response carries `X-Correlation-ID`: the request's value when sent, a fresh UUID otherwise. An error body's `correlation_id` has the same value.
- **CRM-R07** A write operation whose body is not valid JSON answers `500` with `error_code: "INTERNAL_ERROR"` (after CRM-R03 and CRM-R04) and writes nothing.

## 5. Rules per operation

### 5.1 List leads: `GET /v1/leads`

- **CRM-R10** `200` with `{ "data": [leads], "pagination": { "limit", "cursor", "next_cursor", "has_more" } }`, ordered by `score` descending, then `lead_id` descending.
- **CRM-R11** Optional filters, combined with AND: `client_id`, `status`, `source` and `assigned_producer` match exactly; `min_score` keeps `score >= min_score`.
- **CRM-R12** Reported together: `status` or `source` outside its value set (including an empty `status=` or `source=`) gives `invalid_enum`; `min_score` below 0 or above 100 gives `out_of_range`.
- **CRM-R13** `limit` defaults to 25, is clamped to 1..100, and is ignored when not a number. `pagination.cursor` repeats the `cursor` parameter (null when absent). When more rows exist, `has_more` is true and `next_cursor` is the base64 encoding of the JSON object `{ "score", "lead_id" }` of the last row on the page; otherwise `has_more` is false and `next_cursor` is null. Passing `next_cursor` as `cursor` returns the rows that follow, with no gap and no repeat. A cursor that is not base64 JSON of an object with both keys gives `400` with `cursor` / `invalid_format`.

### 5.2 Lead scoring list: `GET /v1/leads/scoring`

- **CRM-R14** Identical to `GET /v1/leads` (CRM-R10 to CRM-R13: same rows, order, validation and pagination), except that the `client_id` parameter is ignored.

### 5.3 Lead by id: `GET /v1/leads/{id}`

- **CRM-R20** `200` with the lead, or `404 NOT_FOUND` (`lead not found.`).

### 5.4 Create a lead: `POST /v1/leads`

- **CRM-R30** Reported together: `first_name`, `last_name`, `email`, `source` are required (missing, null or empty gives `required`); `first_name` or `last_name` over 100 characters, `email` over 255, or `notes` over 2000 gives `too_long`; `source` outside the six lead sources gives `invalid_enum`.
- **CRM-R31** The formats of `email` and `phone` are not checked, and nothing prevents two leads with the same email.
- **CRM-R32** On success the answer is `201` with the new lead, and one `leads` row is written:
  - `lead_id` is `lead_` followed by 1 to 8 characters from `a-z0-9`, chosen at random. A `lead_id` in the body is ignored.
  - `status` is `new` and `score` is 50, whatever the body says.
  - `client_id` is the given value, or the empty string when absent.
  - `phone`, `assigned_producer` and `notes` are the given values or null. `tags` is the given value or `[]`.
  - `last_activity_date` is today's date in UTC. `created_at` and `updated_at` are the same current timestamp.

### 5.5 Update a lead: `PATCH /v1/leads/{id}`

Checks run in this order.

- **CRM-R40** The body must contain at least one of `status`, `score`, `tags`, `notes`, `assigned_producer`. Otherwise `400` with `body` / `required`. This runs before the lead is looked up.
- **CRM-R41** Reported together, still before the lookup: `status` outside the six statuses gives `invalid_enum`; `score` below 0 or above 100 gives `out_of_range`; `notes` over 2000 characters gives `too_long`.
- **CRM-R42** Unknown lead: `404 NOT_FOUND`.
- **CRM-R43** On success each of the five fields present in the body is stored (null clears `notes` and `assigned_producer`; `tags` is replaced as a whole), `updated_at` becomes the current time, `last_activity_date` becomes today's date in UTC, and the answer is `200` with the updated lead. All other body fields are ignored.
- **CRM-R44** Lead status has no state machine: any status may be set from any other.

### 5.6 Enroll a lead's client: `POST /v1/leads/{id}/enroll`

- **CRM-R50** Checks run in this order and stop at the first failure:
  1. `campaign_id` missing, null or empty: `400` with `campaign_id` / `required`.
  2. Unknown lead: `404` (`lead not found.`).
  3. Unknown campaign: `404` (`campaign not found.`).
  4. Campaign status other than `active`: `409 CONFLICT`, message `Campaign <campaign_id> is not active (status: <status>).`
  5. Only when the lead has a non-empty `client_id`: an existing enrollment with the same `campaign_id` and `client_id` gives `409 CONFLICT`, message `Client <client_id> is already enrolled in campaign <campaign_id>.`
- **CRM-R51** On success one `campaign_enrollments` row is written and the campaign's `enrolled_count` grows by 1. The lead row is not changed. The enrollment has `enrollment_id` = `enr_` followed by 1 to 8 characters from `a-z0-9`, the `campaign_id`, `client_id` = the lead's `client_id`, `trigger_reason` = the given value or null (no length limit here), `metadata` = the given object as JSON text or null, `enrolled_at` = the current time, `sequence_step` = 1. The answer is `201` with `{ enrollment_id, campaign_id, client_id, enrolled_at, sequence_step }`.
- **CRM-R52** A lead whose `client_id` is null or empty is enrolled with `client_id` = `""`. Step 5 of CRM-R50 is skipped, so the same lead can be enrolled in the same campaign repeatedly.

### 5.7 List campaigns: `GET /v1/campaigns`

- **CRM-R60** `200` with `{ "data": [campaign rows], "pagination": {...} }`, ordered by `campaign_id` ascending.
- **CRM-R61** Optional filters `status` and `type`, combined with AND. Values outside the value sets give `invalid_enum`, reported together.
- **CRM-R62** Pagination as in CRM-R13, with the cursor built from `{ "campaign_id" }`.

### 5.8 Enroll a client: `POST /v1/campaigns/{id}/enroll`

- **CRM-R70** Checks run in this order:
  1. Reported together: `client_id` missing, null or empty gives `required`; `trigger_reason` over 500 characters gives `too_long`.
  2. Unknown campaign: `404` (`campaign not found.`).
  3. Campaign status other than `active`: `409 CONFLICT`, message as in CRM-R50.
  4. An existing enrollment with the same campaign and `client_id`: `409 CONFLICT`, message as in CRM-R50.
- **CRM-R71** On success the effects and the `201` answer are those of CRM-R51, with `client_id` taken from the body. The client id is not verified.

### 5.9 Retention risk: `GET /v1/analytics/retention-risk`

- **CRM-R80** `200` with `{ "data": [...], "pagination": {...} }`. Each item is `{ client_id, client_name, risk_score, factors: { rate_increase_pct, months_since_contact, email_open_rate, policies_count }, recommended_action }`; `assigned_producer` is not returned. Order: `risk_score` descending, then `client_id` descending.
- **CRM-R81** `min_risk_score` keeps `risk_score >= min_risk_score` and defaults to 50. A value below 0 or above 100 gives `400` with `min_risk_score` / `out_of_range`. `assigned_producer` filters by exact match.
- **CRM-R82** Pagination as in CRM-R13, with the cursor built from `{ "risk_score", "client_id" }`.
- **CRM-R83** A `min_risk_score` (here) or `min_score` (CRM-R12) that is not a number answers `500 INTERNAL_ERROR`.

## 6. State machines

None. Lead `status` is free (CRM-R44). Campaign `status` is never changed by an operation; it only gates enrollment (CRM-R50, CRM-R70). `sequence_step` of an enrollment starts at 1 and grows only through the simulated clock (CRM-R110).

## 7. Facts that depend on seed data and the control plane

- **CRM-R100** `GET /sim/snapshot` returns `tables` with exactly `leads`, `campaigns`, `campaign_enrollments` and `retention_risks`. `POST /sim/seed` with `base: "empty"` leaves all four present and empty.
- **CRM-R101** Seed facts:

| | `realistic` | `clean` |
| :--- | :--- | :--- |
| Leads | 16, all with a `client_id` | 14, of which 9 have `client_id` null |
| Highest-scoring lead | `lead_e5f6a7b8` (95) | `lead_e5f6a7b8` (95) |
| Retention risks | 12, of which 10 score 50 or more; highest `CLI-032` (95) | 10, of which 8 score 50 or more; highest `CLI-002` (88) |
| Enrollments | 0 | 0 |

  Both data sets hold the same five campaigns: `camp_auto_nurture` (nurture, active, 205 enrolled), `camp_holiday_2025` (cross_sell, completed, 430), `camp_life_pivot_2026` (cross_sell, active, 148), `camp_new_client_welcome` (welcome, active, 89), `camp_renewal_q1` (retention, active, 312).
- **CRM-R102** `POST /sim/reset` and `POST /sim/seed` rebuild all four tables, discarding earlier writes.

## 8. Simulated clock

- **CRM-R110** `POST /sim/time-travel` that moves the clock forward by `d` days adds `max(1, floor(d / 7))` to `sequence_step` of every enrollment. The response's `transitions` is `{ "campaign_enrollments_advanced": <number of enrollments> }`.
- **CRM-R111** With zero or negative days nothing changes and `campaign_enrollments_advanced` is 0.
- **CRM-R112** Request handling does not read the simulated clock: `created_at`, `updated_at`, `last_activity_date` and `enrolled_at` use the real clock.
- **CRM-R113** `POST /sim/seed` and `POST /sim/reset` return the simulated clock to real time.

## 9. Calls to other services

None.

## 10. Runtime contract

What the service must provide besides its `/v1` operations. The token endpoint, the `/sim/*` control plane, fault injection and the request log come from [`../packages/shared/`](../packages/shared/); the service has to mount them as described here.

- **CRM-R120** Process. The service starts with `bun run src/index.ts` in `services/crm/` and listens on `PORT` (default 3002). The entry module's default export is `{ port, fetch }`, where `fetch` handles one HTTP request; it also exports `app` (whose `app.fetch` is the same handler) and `seedDatabase(mode)`. `bun run src/seed.ts` in the same directory rebuilds the database from the data set named by `SEED_MODE` (default `realistic`) and exits with code 0.
- **CRM-R121** Database. One SQLite file. Its location is `DATABASE_URL` (a `file:` URL) when set; otherwise `<EVERGREEN_DATA_DIR>/crm.db` when `EVERGREEN_DATA_DIR` is set; otherwise `services/crm/data/crm.db`. A missing directory is created. The seed script and the server resolve the location the same way, so they share the file.
- **CRM-R122** Seeding. Every seed (the seed script, `POST /sim/reset`, `POST /sim/seed`) drops and recreates all tables (`leads`, `campaigns`, `campaign_enrollments`, `retention_risks`) and then loads a data set: mode `clean` reads `data/seed-clean/`, mode `empty` loads nothing, and any other mode reads `data/seed/`. Loading the same data set twice gives the same rows.
  `leads.json` fills `leads` (the `tags` array is stored as JSON text; a lead without `client_id` gets null), `campaigns.json` fills `campaigns` and `retention_risks.json` fills `retention_risks`, columns copied by name. `campaign_enrollments` starts empty.
  `POST /sim/reset` takes the mode from `seed_mode` in its optional JSON body, else from `SEED_MODE`, else `realistic`, and answers `{ "status": "reset", "service": "crm", "seed_mode", "simulated_time" }`. `POST /sim/seed` takes `{ "base", "tables" }`: `base` is `empty` (default), `clean` or `realistic`; `tables` maps table names to rows inserted after the base is loaded, with nested JSON values stored as JSON text. With base `clean` or `realistic`, a row whose key already exists replaces the loaded row. It answers `{ "status": "seeded", "service", "base", "inserted": { table: count }, "simulated_time" }`. An unknown base or table name is `400 VALIDATION_ERROR` and changes nothing.
- **CRM-R123** `GET /sim/status` answers `{ "status": "ok", "service": "crm", "simulated_time", "clock_offset_ms", "chaos": { "enabled", "error_rate", "status_code", "latency_ms" }, "modality_mode" }`. After a seed or reset `clock_offset_ms` is 0 and `chaos` is `{ false, 0, 503, 0 }`. `GET /sim/snapshot` answers `{ "service", "timestamp", "simulated_time", "tables" }`. Neither needs credentials.
- **CRM-R124** Fault injection. `POST /sim/chaos` takes `{ "enabled" (boolean, required), "error_rate" (0 to 1), "status_code", "latency_ms" }`; fields left out keep their value; a missing or non-boolean `enabled` is `400 VALIDATION_ERROR`. While enabled, every request under `/v1` is first delayed by `latency_ms` and then, with probability `error_rate`, answered with `status_code` and `error_code: "SERVICE_UNAVAILABLE"` before authentication and before any handler runs, so nothing is written. `/health`, `/oauth/token` and `/sim/*` are never affected. A seed or reset switches fault injection off.
- **CRM-R125** Request log. Every request under `/v1`, whatever its outcome (including `401`), is recorded and returned by `GET /sim/trace`, oldest first, in OTLP JSON: `resourceSpans[0].resource.attributes` holds `service.name` = `crm`; `scopeSpans[0].scope.name` is `evergreen-request-log`; each span has `traceId` (32 hex characters), `spanId` (16), `name` = `<METHOD> <path>`, `kind` 3, start and end times in nanoseconds, and the attributes `http.request.method`, `url.full` = `http://localhost:3002<path and query>`, `http.response.status_code`, `server.port` = 3002 and `http.request.body` (the first 16 KiB of the request body as text). The port in these attributes is always 3002, whatever `PORT` says. Requests that carry `X-Evergreen-Internal: 1` are not recorded, and neither are `/health`, `/oauth/token` and `/sim/*`. A successful seed or reset empties the log.
- **CRM-R126** Access log. For every request it answers, on any path, the service writes one line of JSON to standard output: `timestamp` (ISO time), `method`, `path` (without the query string), `status`, `duration_ms` (whole milliseconds), `correlation_id` (the value of CRM-R06), `query` (an object of the query parameters, present only when the request has any) and `user_agent` (present only when the request sent one). Personal data in `query` values is masked: an email address becomes its first character, `***@` and its domain; phone and social security numbers keep their last four digits.

## 11. Known gaps

Places where `crm.yaml` and the running service disagree, or where the behaviour is likely unintended. The running service is the reference, and the tests assert what it does. Each gap that contradicts `crm.yaml` or is likely unintended has a `test.todo` that names it.

| Id | Gap |
| :--- | :--- |
| CRM-G01 | Error bodies. `crm.yaml` describes `{ code, message, details[].{field, reason}, request_id }`. The service sends the shared envelope of CRM-R05 (`error_code`, `details[].{field, message, code}`, `correlation_id`). Every 4xx and 5xx body therefore fails the `Error` schema. |
| CRM-G02 | `Lead` in `crm.yaml` marks only `notes` nullable. The service returns null for `client_id` (seeded leads), `phone`, `assigned_producer` and, after `PATCH` with `tags: null`, `tags`. A lead created without a client has `client_id` `""`, while seeded leads without a client have null. |
| CRM-G03 | The `LeadSource` enum in `crm.yaml` omits `phone`, which the service accepts, stores and filters by. |
| CRM-G04 | `crm.yaml` gives `email` the format `email` and `phone` a pattern. The service checks neither (CRM-R31). |
| CRM-G05 | A numeric filter that is not a number gives `500` instead of `400` (CRM-R83). |
| CRM-G06 | A body that is not JSON gives `500` instead of `400` (CRM-R07). |
| CRM-G07 | Enrolling a lead that has no client writes an enrollment with `client_id` `""` and skips the duplicate check (CRM-R52). |
| CRM-G08 | `crm.yaml` documents `409` for `POST /v1/leads` and `PATCH /v1/leads/{id}`. The service never answers `409` there. |
| CRM-G09 | `pagination.next_cursor` is returned but is not part of `CursorPagination` in `crm.yaml`. |
| CRM-G10 | Values of the wrong JSON type are not validated. Their outcome is not part of this contract: for example a `score` sent as text, or a null `status` or `score`, gives `500`; a fractional `score` is stored without its fraction; and `tags` accepts any JSON value. `trigger_reason` is limited to 500 characters on one enroll path only (CRM-R70, not CRM-R51). |
| CRM-G11 | Operations ignore the simulated clock (CRM-R112). |
