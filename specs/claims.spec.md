# Claims service: behaviour specification

This document states what the Claims service does, as seen over HTTP and in its database tables. Together with the files under "Durable contracts" it is meant to be enough to rebuild the service without reading the current code. Each rule has an id (`CLM-Rnn`). The tests in [`tests/conformance/claims/`](../tests/conformance/claims/) cite those ids.

## 1. Purpose

The service records insurance claims for the agency: First Notice of Loss (FNOL) intake, assignment to an adjuster, status and reserve tracking through to settlement or denial, document metadata, and an audit trail (the claim timeline) of every change. It serves on port 3007 by default (`PORT` overrides it). It calls no other service.

## 2. Durable contracts

| Contract | File |
| :--- | :--- |
| HTTP operations, request and response schemas, scopes | [`claims.yaml`](claims.yaml) |
| State machine, preconditions and timeline effects in machine-readable form | [`claims.behavior.yaml`](claims.behavior.yaml) |
| Tables and columns | [`../services/claims/prisma/schema.prisma`](../services/claims/prisma/schema.prisma) |
| Seed data | [`../data/seed/`](../data/seed/) (`realistic`) and [`../data/seed-clean/`](../data/seed-clean/) (`clean`): `adjusters.json`, `claims.json` |
| Shared behaviour: token endpoint, bearer authentication, scope checks, error envelope, correlation id, pagination, `/sim/*` control plane, request log | [`../packages/shared/`](../packages/shared/) |

Where this document and `claims.behavior.yaml` differ, this document describes the running service; the differences are listed in section 11.

## 3. Data model and invariants

Four tables. All timestamps are text.

**`adjusters`** (key `adjuster_id`): `first_name`, `last_name`, `email`, `phone` (nullable), `specialty` (`auto`, `property`, `liability`, `general`), `active` (integer `1` or `0`), `max_open_claims` (integer), `created_at`. No operation writes this table.

**`claims`** (key `claim_id`): `policy_id`, `client_id`, `claim_type`, `status`, `loss_date` (`YYYY-MM-DD`), `reported_date` (`YYYY-MM-DD`), `loss_description`, `loss_location` (nullable), `reserve_amount` (nullable number), `settlement_amount` (nullable number), `adjuster_id` (nullable, refers to `adjusters`), `notes` (nullable), `created_at`, `updated_at`.

**`claim_documents`** (key `document_id`): `claim_id`, `document_type`, `file_name`, `file_path`, `uploaded_by` (nullable), `uploaded_at`.

**`claim_timeline`** (key `event_id`): `claim_id`, `event_type`, `description`, `old_value` (nullable text), `new_value` (nullable text), `created_by` (nullable), `created_at`.

Value sets:

- Claim types: `auto_collision`, `auto_comprehensive`, `property_damage`, `theft`, `liability`, `medical`, `fire`, `water`, `weather`.
- Claim statuses: `reported`, `assigned`, `investigating`, `reserved`, `settled`, `denied`.
- Document types: `police_report`, `medical_records`, `photos`, `estimate`, `correspondence`, `other`.
- Timeline event types written by the service: `status_change`, `assignment`, `reserve_change`, `note`, `document_upload`. (`payment` is in the OpenAPI enum but is never written.)

Invariants:

- An **open claim** is a claim whose status is neither `settled` nor `denied`.
- `policy_id` and `client_id` are stored as given. They are not checked against any other service.
- Rows are never deleted by an operation. Timeline and document rows are only ever added.
- Every timeline row written by the service has `event_id` = `EVT-` plus 8 lowercase hexadecimal characters, `created_by` = null, and `created_at` = the time of writing.
- Timestamps written by the service are ISO 8601 in UTC with milliseconds, for example `2026-03-01T09:30:00.123Z`.
- A request that fails (any 4xx or 5xx) writes no row.

## 4. Auth and scopes

- **CLM-R01** `GET /health` needs no credentials and returns `200` with `{ "status": "ok", "service": "claims", "timestamp": <ISO time> }`.
- **CLM-R02** `POST /oauth/token` needs no credentials and implements the OAuth 2.0 client-credentials grant from the shared package. The body may be JSON or form-encoded with `grant_type`, `client_id`, `client_secret` and optional `scope` (space separated). Success is `200` with `access_token`, `token_type: "Bearer"`, `expires_in: 3600` and `scope`. Without `scope` the token holds every scope the client may hold; with `scope` it holds exactly the requested ones. Failures: other grant type `400 unsupported_grant_type`; missing id or secret `400 invalid_request`; unknown client or wrong secret `401 invalid_client`; a scope the client may not hold `400 invalid_scope`. These bodies use `error` and `error_description`, not the error envelope of CLM-R05. Clients: `agent-full` (all scopes), `agent-csr`, `agent-readonly` (read scopes only), each with secret `dev-secret`.
- **CLM-R03** Every path under `/v1` requires `Authorization: Bearer <token>` with a token signed by the service (HS256, secret from `JWT_SECRET`, default `dev-secret`) that has not expired. Otherwise the answer is `401` with `error_code: "AUTH_ERROR"`. This check runs before everything else, including for paths under `/v1` that do not exist.
- **CLM-R04** Each operation requires one scope. A token without it gets `403` with `error_code: "FORBIDDEN"` and a message naming the missing scope. The scope check runs before the body is read, before validation and before any lookup.

| Operation | Scope |
| :--- | :--- |
| `POST /v1/claims`, `POST /v1/claims/fnol`, `PATCH /v1/claims/{claim_id}` | `claims:write` |
| `GET /v1/claims`, `GET /v1/claims/{claim_id}`, `GET /v1/claims/{claim_id}/timeline`, `GET /v1/adjusters` | `claims:read` |
| `POST /v1/claims/{claim_id}/assign` | `claims:assign` |
| `POST /v1/claims/{claim_id}/documents` | `claims:documents` |

- **CLM-R05** Errors under `/v1` use one envelope: `{ "error_code", "message", "correlation_id", "details"? }`. A validation failure is `400` with `error_code: "VALIDATION_ERROR"`, `message: "One or more fields failed validation."` and `details`, a list of `{ "field", "message", "code" }`. Field codes used by this service: `required`, `invalid_enum`, `invalid_format`, `out_of_range`, `too_long`. When a rule below says checks are "reported together", one response lists every failing field. A missing row is `404` with `error_code: "NOT_FOUND"` and message `claim not found.` or `adjuster not found.`.
- **CLM-R06** Every response carries an `X-Correlation-ID` header. It repeats the request's `X-Correlation-ID` when one was sent and is a fresh UUID otherwise. An error body's `correlation_id` has the same value.
- **CLM-R07** A write operation whose body is not valid JSON answers `500` with `error_code: "INTERNAL_ERROR"` (after the checks of CLM-R03 and CLM-R04) and writes nothing.

## 5. Rules per operation

### 5.1 File a claim: `POST /v1/claims` and `POST /v1/claims/fnol`

- **CLM-R10** The two paths behave identically.
- **CLM-R11** Three alternate field names are accepted. Each is used only when the canonical field is absent from the body: `loss_type` for `claim_type`, `description` for `loss_description`, `estimated_loss` for `reserve_amount`. `reserve_amount` itself is also accepted.

Checks run in this order. CLM-R12 to CLM-R16 are reported together.

- **CLM-R12** `policy_id`, `client_id`, `claim_type`, `loss_date` and `loss_description` are required. Missing, null or empty string gives code `required`. An empty-string `claim_type` or `loss_date` is reported twice: as `required` and as `invalid_enum` (CLM-R13) or `invalid_format` (CLM-R14).
- **CLM-R13** `claim_type` must be one of the nine claim types; otherwise `invalid_enum`.
- **CLM-R14** `loss_date` must match `^\d{4}-\d{2}-\d{2}$`; otherwise `invalid_format`. Nothing checks that it is a real calendar date: `2024-02-31` is accepted and stored as sent.
- **CLM-R15** `loss_description` longer than 5000 characters, or `loss_location` longer than 500, gives `too_long`.
- **CLM-R16** A reserve (`reserve_amount` or `estimated_loss`) below 0 gives `out_of_range` on field `reserve_amount`. Zero is accepted.
- **CLM-R17** Then: a `loss_date` later than today's date in UTC gives `400` with `loss_date` / `out_of_range`. Today's date is accepted.
- **CLM-R18** Then: `adjuster_id` counts only when it is a string that is not blank after trimming; the trimmed value is used. Any other value is treated as absent. An id with no adjuster row gives `404 NOT_FOUND` (`adjuster not found.`). An adjuster with `active` = 0 gives `400` with `adjuster_id` / `invalid_enum`. The adjuster's capacity is not checked here.
- **CLM-R19** On success the answer is `201` with the new `claims` row:
  - `status` is `reported`, also when an adjuster was given.
  - `adjuster_id` is the given adjuster or null.
  - `reported_date` is today's date in UTC. `created_at` and `updated_at` are the same current timestamp.
  - `reserve_amount` is the given reserve when it is a number, otherwise null. `settlement_amount` is null.
  - `loss_location` and `notes` are the given values or null.
- **CLM-R20** `claim_id` is `CLM-<year>-<n>`, where `<year>` is the current four-digit year and `<n>` is six digits, zero padded. `<n>` is one more than the larger of (a) the number read from the id that sorts last, as text, among the ids with the same `CLM-<year>-` prefix (0 when that id's suffix is not a number) and (b) the count of ids with that prefix. With no such id it is `000001`. Ids of other years are ignored.
- **CLM-R21** One `claim_timeline` row is written: `event_type: "status_change"`, `old_value: null`, `new_value: "reported"`, `description: "Claim filed — status set to reported."`. No assignment event is written, even when an adjuster was given. No other table is touched.

### 5.2 List claims: `GET /v1/claims`

- **CLM-R30** `200` with `{ "data": [claim rows], "pagination": { "limit", "cursor", "next_cursor", "has_more" } }`. Rows are ordered by `created_at` descending, then `claim_id` descending.
- **CLM-R31** Optional filters, combined with AND: `client_id`, `policy_id`, `status` and `claim_type` match exactly; `date_from` keeps `loss_date >= date_from`; `date_to` keeps `loss_date <= date_to`.
- **CLM-R32** Reported together: `status` and `claim_type` outside their value sets give `invalid_enum`; a non-empty `date_from` or `date_to` that does not match `^\d{4}-\d{2}-\d{2}$` gives `invalid_format`. An empty `status=` or `claim_type=` is `invalid_enum`; empty `date_from`, `date_to`, `client_id` and `policy_id` are ignored.
- **CLM-R33** `limit` defaults to 25. A numeric value is clamped to the range 1 to 100. A value that is not a number is ignored.
- **CLM-R34** `pagination.cursor` repeats the `cursor` parameter (null when absent). When more rows exist, `has_more` is true and `next_cursor` is the base64 encoding of the JSON object `{ "created_at", "claim_id" }` of the last row on the page; otherwise `has_more` is false and `next_cursor` is null. Passing `next_cursor` as `cursor`, with the same filters, returns the rows that follow, with no gap and no repeat. A cursor that is not base64 JSON of an object with both keys gives `400` with `cursor` / `invalid_format`.

### 5.3 Claim detail: `GET /v1/claims/{claim_id}`

- **CLM-R40** Unknown id: `404 NOT_FOUND`.
- **CLM-R41** `200` with the claim row plus three fields: `adjuster` (the `adjusters` row for `adjuster_id`, without `open_claims_count`, or null), `timeline` (the claim's timeline rows ordered by `created_at` ascending) and `documents` (the claim's document rows).

### 5.4 Assign an adjuster: `POST /v1/claims/{claim_id}/assign`

- **CLM-R50** Checks run in this order and stop at the first failure: `adjuster_id` missing, null or empty gives `400` with `adjuster_id` / `required`; unknown claim gives `404` (`claim not found.`); unknown adjuster gives `404` (`adjuster not found.`); then CLM-R51; then CLM-R52.
- **CLM-R51** An adjuster with `active` = 0 gives `400` with `adjuster_id` / `invalid_enum`.
- **CLM-R52** Count the open claims whose `adjuster_id` is the requested adjuster. When the count is greater than or equal to the adjuster's `max_open_claims`, the answer is `400` with `adjuster_id` / `out_of_range`. The claim being assigned is part of the count when it is open and already belongs to that adjuster.
- **CLM-R53** On success the claim's `adjuster_id` becomes the requested adjuster and `updated_at` the current time. A `reported` claim also becomes `assigned`. A claim in any other status, including `settled` and `denied`, keeps its status. The answer is `200` with the updated claim row.
- **CLM-R54** One timeline row is written: `event_type: "assignment"`, `old_value` = the previous `adjuster_id` (or null), `new_value` = the new one, `description: "Adjuster <first_name> <last_name> assigned."`. When the status changed, a second row follows: `status_change`, `old_value: "reported"`, `new_value: "assigned"`, `description: "Status changed from reported to assigned."`.

### 5.5 Update a claim: `PATCH /v1/claims/{claim_id}`

Checks run in this order.

- **CLM-R60** The body must contain at least one of `status`, `reserve_amount`, `settlement_amount`, `notes`. Otherwise `400` with `body` / `required`. This runs before the claim is looked up.
- **CLM-R61** Reported together, still before the lookup: `status` outside the six statuses gives `invalid_enum`; `reserve_amount` or `settlement_amount` below 0 gives `out_of_range`; `notes` longer than 5000 characters gives `too_long`. A null `reserve_amount`, `settlement_amount` or `notes` skips its check. A null `status` also passes this step, and is then refused by CLM-R63.
- **CLM-R62** Unknown claim: `404 NOT_FOUND`.
- **CLM-R63** When `status` is given and differs from the current status, the change must be allowed by the state machine in section 6. Otherwise `400` with `status` / `invalid_enum` and message `Cannot transition from '<current>' to '<requested>'.`, and nothing in the request is applied. Sending the current status is accepted and changes nothing. `status: null` counts as a different status and is refused with `Cannot transition from '<current>' to 'null'.`
- **CLM-R64** On success each of the four fields present in the body is stored as given (null clears `reserve_amount`, `settlement_amount` and `notes`), `updated_at` becomes the current time, and the answer is `200` with the updated row. All other body fields are ignored. There are no cross-field requirements: `assigned` does not need an adjuster and `settled` does not need a settlement amount.
- **CLM-R65** Timeline rows are written in this order, one per field whose value actually changed:
  - status: `status_change`, `old_value` = previous status, `new_value` = new status, `description: "Status changed from <old> to <new>."`
  - reserve: `reserve_change`, `old_value` and `new_value` = the amounts as decimal text (`"1000"`, `"2500.5"`) or null when there is no amount, `description: "Reserve amount changed from <old or none> to <new>."` (a cleared reserve reads `to null.`)
  - notes: `note`, `old_value` and `new_value` null, `description: "Notes updated."`

  A change to `settlement_amount` writes no timeline row.

### 5.6 Claim timeline: `GET /v1/claims/{claim_id}/timeline`

- **CLM-R70** Unknown claim: `404 NOT_FOUND`. Otherwise `200` with `{ "data": [timeline rows] }` ordered by `created_at` ascending. Rows with equal `created_at` have no defined order.

### 5.7 Add a document: `POST /v1/claims/{claim_id}/documents`

- **CLM-R80** Reported together, before the claim is looked up: `document_type`, `file_name`, `file_path` are required (`required`); `document_type` must be a document type (`invalid_enum`); `file_name` over 255 or `file_path` over 1000 characters gives `too_long`. Then an unknown claim gives `404 NOT_FOUND`.
- **CLM-R81** On success the answer is `201` with the new `claim_documents` row: `document_id` = `DOC-` plus 8 lowercase hexadecimal characters, `claim_id` from the path, the three given fields, `uploaded_by` = the given value or null, `uploaded_at` = the current time. Only metadata is stored. The claim's status does not matter and the claim row is not changed.
- **CLM-R82** One timeline row is written: `document_upload`, `old_value: null`, `new_value` = the `document_id`, `description: "Document uploaded: <file_name> (<document_type>)."`.

### 5.8 List adjusters: `GET /v1/adjusters`

- **CLM-R90** `200` with `{ "data": [...] }`: every `adjusters` row plus `open_claims_count`, the number of open claims assigned to that adjuster. There is no pagination.
- **CLM-R91** Optional filters, combined with AND: `specialty` (one of the four specialties) and `active` (`"0"` or `"1"`). Other values give `invalid_enum`, reported together.

## 6. State machine

Claim `status`, changed through `PATCH` (CLM-R63):

| From | Allowed next |
| :--- | :--- |
| `reported` | `assigned`, `denied` |
| `assigned` | `investigating`, `denied` |
| `investigating` | `reserved`, `denied` |
| `reserved` | `settled`, `denied` |
| `settled` | none |
| `denied` | none |

Two other things change status: assigning an adjuster moves `reported` to `assigned` (CLM-R53), and moving the simulated clock forward moves `reported` and `assigned` to `investigating` (CLM-R110).

## 7. Facts that depend on seed data and the control plane

- **CLM-R100** `GET /sim/snapshot` returns `tables` with exactly `adjusters`, `claims`, `claim_documents` and `claim_timeline`, each ordered by its key.
- **CLM-R101** `POST /sim/seed` with `base: "empty"` leaves all four tables present and empty.
- **CLM-R102** Both data sets hold 3 adjusters and 14 claims, and no documents or timeline rows.
  - Adjusters: `ADJ-001` (auto, limit 25), `ADJ-002` (property, limit 20), `ADJ-003` (general, limit 30); all active. Open claims per adjuster: 1, 5 and 2 in `realistic`; 2, 5 and 2 in `clean`.
  - Claim ids run from `CLM-2025-000001` to `CLM-2026-000014`. The newest by `created_at` is `CLM-2026-000010`.
  - Status counts, `realistic`: 3 reported, 2 assigned, 5 investigating, 1 reserved, 2 settled, 1 denied. `clean`: 3 reported, 2 assigned, 5 investigating, 1 reserved, 3 settled.
  - The first claim filed during 2026 on either data set is `CLM-2026-000015`; in a later year it is `CLM-<year>-000001` (CLM-R20).
- **CLM-R103** `POST /sim/reset` (body `{ "seed_mode": "clean" | "realistic" }`) and `POST /sim/seed` (body `{ "base", "tables" }`) rebuild all four tables, discarding earlier writes. `/sim/seed` then inserts the given rows; with base `clean` or `realistic` a row whose key already exists replaces the seeded row.

## 8. Simulated clock

- **CLM-R110** `POST /sim/time-travel` that moves the clock forward (positive `days`, or a `target_date` after the current simulated time) sets every claim whose status is `reported` or `assigned` (or the legacy value `open`) to `investigating` and its `updated_at` to the new simulated time. No timeline row is written. The response's `transitions` is `{ "claims_advanced": <number of claims changed> }`.
- **CLM-R111** With zero or negative days no row changes and `claims_advanced` is 0.
- **CLM-R112** Request handling does not read the simulated clock. `reported_date`, the future-date check of CLM-R17, the year in `claim_id`, and every timestamp written by an operation use the real clock.
- **CLM-R113** `POST /sim/seed` and `POST /sim/reset` return the simulated clock to real time.

## 9. Calls to other services

None. The service neither calls peers nor verifies `policy_id` or `client_id`.

## 10. Runtime contract

What the service must provide besides its `/v1` operations. The token endpoint, the `/sim/*` control plane, fault injection and the request log come from [`../packages/shared/`](../packages/shared/); the service has to mount them as described here.

- **CLM-R120** Process. The service starts with `bun run src/index.ts` in `services/claims/` and listens on `PORT` (default 3007). The entry module's default export is `{ port, fetch }`, where `fetch` handles one HTTP request; it also exports `app` (whose `app.fetch` is the same handler) and `seedDatabase(mode)`. `bun run src/seed.ts` in the same directory rebuilds the database from the data set named by `SEED_MODE` (default `realistic`) and exits with code 0.
- **CLM-R121** Database. One SQLite file. Its location is `DATABASE_URL` (a `file:` URL) when set; otherwise `<EVERGREEN_DATA_DIR>/claims.db` when `EVERGREEN_DATA_DIR` is set; otherwise `services/claims/data/claims.db`. A missing directory is created. The seed script and the server resolve the location the same way, so they share the file.
- **CLM-R122** Seeding. Every seed (the seed script, `POST /sim/reset`, `POST /sim/seed`) drops and recreates all tables (`adjusters`, `claims`, `claim_documents`, `claim_timeline`) and then loads a data set: mode `clean` reads `data/seed-clean/`, mode `empty` loads nothing, and any other mode reads `data/seed/`. Loading the same data set twice gives the same rows.
  `adjusters.json` fills `adjusters` and `claims.json` fills `claims`, each column copied by name. `claim_documents` and `claim_timeline` start empty.
  `POST /sim/reset` takes the mode from `seed_mode` in its optional JSON body, else from `SEED_MODE`, else `realistic`, and answers `{ "status": "reset", "service": "claims", "seed_mode", "simulated_time" }`. `POST /sim/seed` takes `{ "base", "tables" }`: `base` is `empty` (default), `clean` or `realistic`; `tables` maps table names to rows inserted after the base is loaded, with nested JSON values stored as JSON text. With base `clean` or `realistic`, a row whose key already exists replaces the loaded row. It answers `{ "status": "seeded", "service", "base", "inserted": { table: count }, "simulated_time" }`. An unknown base or table name is `400 VALIDATION_ERROR` and changes nothing.
- **CLM-R123** `GET /sim/status` answers `{ "status": "ok", "service": "claims", "simulated_time", "clock_offset_ms", "chaos": { "enabled", "error_rate", "status_code", "latency_ms" }, "modality_mode" }`. After a seed or reset `clock_offset_ms` is 0 and `chaos` is `{ false, 0, 503, 0 }`. `GET /sim/snapshot` answers `{ "service", "timestamp", "simulated_time", "tables" }`. Neither needs credentials.
- **CLM-R124** Fault injection. `POST /sim/chaos` takes `{ "enabled" (boolean, required), "error_rate" (0 to 1), "status_code", "latency_ms" }`; fields left out keep their value; a missing or non-boolean `enabled` is `400 VALIDATION_ERROR`. While enabled, every request under `/v1` is first delayed by `latency_ms` and then, with probability `error_rate`, answered with `status_code` and `error_code: "SERVICE_UNAVAILABLE"` before authentication and before any handler runs, so nothing is written. `/health`, `/oauth/token` and `/sim/*` are never affected. A seed or reset switches fault injection off.
- **CLM-R125** Request log. Every request under `/v1`, whatever its outcome (including `401`), is recorded and returned by `GET /sim/trace`, oldest first, in OTLP JSON: `resourceSpans[0].resource.attributes` holds `service.name` = `claims`; `scopeSpans[0].scope.name` is `evergreen-request-log`; each span has `traceId` (32 hex characters), `spanId` (16), `name` = `<METHOD> <path>`, `kind` 3, start and end times in nanoseconds, and the attributes `http.request.method`, `url.full` = `http://localhost:3007<path and query>`, `http.response.status_code`, `server.port` = 3007 and `http.request.body` (the first 16 KiB of the request body as text). The port in these attributes is always 3007, whatever `PORT` says. Requests that carry `X-Evergreen-Internal: 1` are not recorded, and neither are `/health`, `/oauth/token` and `/sim/*`. A successful seed or reset empties the log.
- **CLM-R126** Access log. For every request it answers, on any path, the service writes one line of JSON to standard output: `timestamp` (ISO time), `method`, `path` (without the query string), `status`, `duration_ms` (whole milliseconds), `correlation_id` (the value of CLM-R06), `query` (an object of the query parameters, present only when the request has any) and `user_agent` (present only when the request sent one). Personal data in `query` values is masked: an email address becomes its first character, `***@` and its domain; phone and social security numbers keep their last four digits.

## 11. Known gaps

Places where a durable contract and the running service disagree, or where the behaviour is likely unintended. The running service is the reference, and the tests assert what it does. CLM-G01 to CLM-G04 contradict a contract file and each has a `test.todo` that names it.

| Id | Gap |
| :--- | :--- |
| CLM-G01 | A body that is not JSON gives `500 INTERNAL_ERROR` (CLM-R07). `claims.yaml` documents no `500` response; a `400` would be the conventional answer. |
| CLM-G02 | `claims.behavior.yaml` names the length error code `max_length`. The service sends `too_long` (CLM-R15, CLM-R61, CLM-R80). |
| CLM-G03 | `loss_date` is checked by pattern only (CLM-R14), so a stored value such as `2024-02-31` breaks `format: date` in `claims.yaml`. |
| CLM-G04 | `claims.yaml` describes FNOL `adjuster_id` as assigning "immediately". The service stores the adjuster but keeps status `reported`, writes no `assignment` event and skips the capacity check (CLM-R18, CLM-R19, CLM-R21). |
| CLM-G05 | Operations ignore the simulated clock (CLM-R112), so a claim filed after time travel is stamped with real time, and time travel changes status without a timeline row (CLM-R110). |
| CLM-G06 | Timeline order is by `created_at` only (CLM-R70). Two events written in the same millisecond, as in CLM-R54, have no guaranteed order. |
