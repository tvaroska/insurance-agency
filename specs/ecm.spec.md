# ECM service: behaviour specification

This document states what the Enterprise Content Management (ECM) service does, as seen over HTTP and in its database tables. Together with the files under "Durable contracts" it is meant to be enough to rebuild the service without reading the current code. Each rule has an id (`ECM-Rnn`). The tests in [`tests/conformance/ecm/`](../tests/conformance/ecm/) cite those ids.

## 1. Purpose

The service is the agency's document store. It records uploaded documents (metadata only), audits whether a client has the documents the agency must hold, tracks e-signature envelopes, lists marketing assets, and produces PDFs: Certificates of Insurance (COI, ACORD 25) and the ACORD 90, 80 and 35 forms. It serves on port 3003 by default (`PORT` overrides it). To build PDFs it reads clients and policies from the AMS and claims from the Claims service.

## 2. Durable contracts

| Contract | File |
| :--- | :--- |
| HTTP operations, request and response schemas, scopes | [`ecm.yaml`](ecm.yaml) |
| Tables and columns | [`../services/ecm/prisma/schema.prisma`](../services/ecm/prisma/schema.prisma) |
| Seed data | [`../data/seed/`](../data/seed/) (`realistic`) and [`../data/seed-clean/`](../data/seed-clean/) (`clean`): `documents.json`, `envelopes.json`, `marketing_assets.json` |
| Shared behaviour: token endpoint, bearer authentication, scope checks, error envelope, correlation id, pagination, `/sim/*` control plane, request log | [`../packages/shared/`](../packages/shared/) |
| Operations called on the AMS: list clients, get client, list a client's policies | [`ams.yaml`](ams.yaml) |
| Operation called on Claims: get claim | [`claims.yaml`](claims.yaml) |

## 3. Data model and invariants

Three tables. All timestamps are text. Columns marked "JSON text" hold a JSON value serialised as text.

**`documents`** (key `document_id`): `client_id`, `document_type`, `filename`, `mime_type`, `file_size_bytes` (integer), `status`, `upload_date`, `signer_name`, `signer_email`, `signed_date`, `expiration_date` (all four nullable), `tags` (JSON text, list of strings).

**`envelopes`** (key `envelope_id`): `client_id`, `document_ids` (JSON text, list), `signers` (JSON text, list of `{ name, email, role, status, signed_at }`), `status`, `message` (nullable), `redirect_url` (nullable), `created_at`, `completed_at` (nullable), `expiration_date`.

**`marketing_assets`** (key `asset_id`): `name`, `description` (nullable), `category`, `mime_type`, `url`, `version`, `published_date`. No operation writes this table.

Value sets:

- Document types: `signed_application`, `id_verification`, `coi`, `dec_page`, `endorsement`, `cancellation_notice`, `welcome_kit`.
- Document statuses: `uploaded`, `pending_signature`, `signed`, `expired`, `generated`. The service writes `uploaded` (upload) and `generated` (COI).
- Envelope statuses: `created`, `sent`, `viewed`, `signed`, `completed`, `declined`, `expired`. The service writes `created` and, through the simulated clock, `expired`.
- Asset categories: `welcome_kit`, `flyer`, `comparison_template`, `social_media`.
- ACORD form types: `90`, `80`, `35`.

Invariants:

- Only metadata is stored. Uploaded file content is discarded, and generated PDFs are not kept in the database.
- A document over the API is the `documents` row with `tags` parsed into a JSON array.
- `client_id` values in uploads and envelopes are stored as given, without checking any other service.
- Timestamps written by the service are ISO 8601 in UTC with milliseconds.
- A request that fails (any 4xx or 5xx) writes no row.

## 4. Auth and scopes

- **ECM-R01** `GET /health` needs no credentials and returns `200` with `{ "status": "ok", "service": "ecm", "timestamp": <ISO time> }`.
- **ECM-R02** `POST /oauth/token` needs no credentials and implements the OAuth 2.0 client-credentials grant from the shared package: body (JSON or form-encoded) with `grant_type`, `client_id`, `client_secret`, optional `scope`; `200` with `access_token`, `token_type: "Bearer"`, `expires_in: 3600`, `scope`. Clients `agent-full`, `agent-csr`, `agent-readonly` with secret `dev-secret`. A wrong secret gives `401` with `error: "invalid_client"`.
- **ECM-R03** Every path under `/v1` requires `Authorization: Bearer <token>` with an unexpired token signed by the service (HS256, secret from `JWT_SECRET`, default `dev-secret`). Otherwise `401` with `error_code: "AUTH_ERROR"`. This runs before everything else, including for unknown paths under `/v1`.
- **ECM-R04** Each operation requires one scope. A token without it gets `403` with `error_code: "FORBIDDEN"` and a message naming the scope. The scope check runs before the body is read, before validation, before any lookup and before any call to another service.

| Operation | Scope |
| :--- | :--- |
| `POST /v1/documents/upload` | `ecm:documents:upload` |
| `GET /v1/documents`, `GET /v1/documents/{client_id}/audit` | `ecm:documents:read` |
| `POST /v1/documents/coi/generate`, `POST /v1/documents/coi`, `POST /v1/coi/generate`, `POST /v1/coi` | `ecm:documents:write` |
| `GET /v1/documents/coi/{document_id}/pdf`, `GET /v1/coi/{document_id}/pdf` | `ecm:documents:read` |
| `GET /v1/documents/acord/{form_type}` | `ecm:acord:read` |
| `GET /v1/envelopes` | `ecm:envelopes:read` |
| `POST /v1/envelopes/create` | `ecm:envelopes:create` |
| `GET /v1/assets/marketing` | `ecm:assets:read` |

- **ECM-R05** Errors under `/v1` use the shared envelope `{ "error_code", "message", "correlation_id", "details"? }`. A validation failure is `400` with `error_code: "VALIDATION_ERROR"`, `message: "One or more fields failed validation."` and `details`, a list of `{ "field", "message", "code" }`. Field codes used: `required`, `invalid_enum`, `invalid_format`, `too_long`, and three specific to this service: `not_found`, `invalid_status`, `invalid_type`. "Reported together" below means one response lists every failing field. A missing row is `404` with `error_code: "NOT_FOUND"`.
- **ECM-R06** Every response carries `X-Correlation-ID`: the request's value when sent, a fresh UUID otherwise. An error body's `correlation_id` has the same value.
- **ECM-R07** A JSON operation whose body is not valid JSON, and an upload whose body is not valid `multipart/form-data`, answer `400` with `error_code: "VALIDATION_ERROR"` (after ECM-R03 and ECM-R04) and write nothing.
- **ECM-R08** `ecm:envelopes:read` is a standard OAuth scope grantable to `agent-full`, `agent-csr`, and `agent-readonly` and is required by `GET /v1/envelopes`. A token without it gets `403` naming `ecm:envelopes:read`.

## 5. Rules per operation

Pagination is the same wherever it appears: `limit` defaults to 25 (50 for envelopes), is clamped to 1..100, and falls back to 25 when not a number. The response has `pagination: { limit, cursor, next_cursor, has_more }`; `cursor` repeats the request's `cursor` (null when absent). When more rows exist, `has_more` is true and `next_cursor` is the base64 encoding of a JSON object holding the two sort columns of the last row; otherwise `has_more` is false and `next_cursor` is null. A cursor that cannot be decoded, or lacks a sort column, gives `400` with `cursor` / `invalid_format`.

### 5.1 Upload a document: `POST /v1/documents/upload`

The body is `multipart/form-data` with a file part `file` and text parts `client_id`, `document_type` and, zero or more times, `tags`.

- **ECM-R10** Reported together: `file`, `client_id` and `document_type` are required; `document_type` must be a document type (`invalid_enum`). An empty `document_type` is reported as both `required` and `invalid_enum`.
- **ECM-R11** On success one `documents` row is written and the answer is `201` with `{ document_id, filename, mime_type, upload_date, status }`:
  - `document_id` = `doc_` followed by 1 to 8 random characters from `a-z0-9`.
  - `filename` = the file part's name; `mime_type` = the file part's content type, or `application/octet-stream` when it has none; `file_size_bytes` = the file's length.
  - `status` = `uploaded`; `upload_date` = now; `tags` = the given tags in order, or `[]`.
  - `signer_name`, `signer_email`, `signed_date`, `expiration_date` are null.

### 5.2 List documents: `GET /v1/documents`

- **ECM-R20** `200` with `{ "data": [documents], "pagination": {...} }`, ordered by `upload_date` descending, then `document_id` descending.
- **ECM-R21** Optional filters, combined with AND: `status`, `document_type` and `client_id` match exactly; `date_from` keeps `upload_date >= date_from` and `date_to` keeps `upload_date <= date_to`, both compared as text and not validated.
- **ECM-R22** A non-empty `status` or `document_type` outside its value set gives `invalid_enum`, reported together. Empty values are ignored.
- **ECM-R23** Pagination as above, with the cursor built from `{ "upload_date", "document_id" }`.

### 5.3 Client document audit: `GET /v1/documents/{client_id}/audit`

- **ECM-R30** When the client has no documents at all, the answer is `404 NOT_FOUND`, message `client documents not found.` When the client has documents but the `status` filter matches none of them, the answer is `200` with `documents: []` and compliance fields still computed from all of the client's documents (ECM-R32).
- **ECM-R31** Otherwise `200` with `{ client_id, documents, compliance_status, missing_documents, pagination }`. `documents` are the client's documents, ordered and paged as in ECM-R20 and ECM-R23, optionally filtered by `status` (a non-empty value outside the document statuses gives `400` with `status` / `invalid_enum`).
- **ECM-R32** `compliance_status` and `missing_documents` are computed from all of the client's documents, whatever the `status` filter and the page:
  - The required document types are `signed_application` and `id_verification`. For each one the client lacks, `missing_documents` gets, in that order, `{ document_type, required_by, reason }`, where `required_by` is now plus 30 days and `reason` is `A signed application is required to bind or renew any policy.` or `State law requires a government-issued photo ID on file before binding coverage.`
  - `compliance_status` is `missing_documents` when anything is missing; otherwise `expired_documents` when any document has an `expiration_date` that, compared as text, is earlier than the current time in ISO form; otherwise `compliant`.

### 5.4 List envelopes: `GET /v1/envelopes`

- **ECM-R40** `200` with `{ "data": [...], "pagination": {...} }`, ordered by `created_at` descending, then `envelope_id` descending; default `limit` 50. Each item has `envelope_id`, `client_id`, `document_ids` (array), `signers` (array), `signer_name` and `signer_email` (name and email of the first signer, or null), `message`, `redirect_url`, `status`, `created_at`, `completed_at`, `expiration_date`.
- **ECM-R41** Optional filters `client_id` and `status`, combined with AND. A non-empty `status` outside the envelope statuses gives `400` with `status` / `invalid_enum`. Pagination as above, with the cursor built from `{ "created_at", "envelope_id" }`.

### 5.5 Create an envelope: `POST /v1/envelopes/create`

- **ECM-R42** Checks run in this order and stop at the first step that fails:
  1. Reported together: `client_id`, `document_ids` and `signers` are required; `message` over 1000 characters gives `too_long`.
  2. `document_ids` must be a non-empty array, else `document_ids` / `invalid_format`.
  3. `signers` must be a non-empty array, else `signers` / `invalid_format`.
  4. Signers are checked in order. The first signer lacking `name`, `email` or `role` is reported (its missing fields together) as `signers[<index>].name` and so on, code `required`.
- **ECM-R43** Then every id in `document_ids` must be an existing document. Otherwise `404 NOT_FOUND` with message `documents: <missing ids, comma separated, in request order> not found.` The documents need not belong to `client_id`.
- **ECM-R44** On success one `envelopes` row is written and the answer is `201` with `{ envelope_id, client_id, document_ids, signers, status, created_at, completed_at, expiration_date }`:
  - `envelope_id` = `env_` followed by 1 to 8 random characters from `a-z0-9`.
  - `status` = `created`; `created_at` = now; `completed_at` = null; `expiration_date` = now plus 30 days.
  - Each signer is stored as `{ name, email, role, status: "pending", signed_at: null }`; other signer fields in the request are dropped.
  - `message` and `redirect_url` are stored as given or null. They are not part of the `201` body but appear in the envelope list.
  - The documents themselves are not changed.

### 5.6 List marketing assets: `GET /v1/assets/marketing`

- **ECM-R50** `200` with `{ "data": [asset rows], "pagination": {...} }`, ordered by `published_date` descending, then `asset_id` descending.
- **ECM-R51** Optional filter `category`; a non-empty value outside the asset categories gives `400` with `category` / `invalid_enum`. Pagination as above, with the cursor built from `{ "published_date", "asset_id" }`.

### 5.7 Generate a Certificate of Insurance

- **ECM-R60** `POST /v1/documents/coi/generate`, `POST /v1/documents/coi`, `POST /v1/coi/generate` and `POST /v1/coi` behave identically.
- **ECM-R61** The certificate holder is `certificate_holder` (`{ name, address? }`) when present; otherwise, when `holder_name` is present, `{ name: holder_name, address: holder_address or {} }`. Reported together: `policy_id` and the certificate holder are required (field `certificate_holder`). Then, as a separate step, a holder without a `name` gives `400` with `certificate_holder.name` / `required`. No other service is called before these checks pass.
- **ECM-R62** The policy and its client are found through the AMS as described in ECM-R81.
- **ECM-R63** A policy the AMS does not list gives `400` with `policy_id` / `not_found`, message `Policy <policy_id> not found.` A policy whose `status` is not `active` gives `400` with `policy_id` / `invalid_status`, message `Cannot generate COI: policy status is '<status>'. Policy must be active.`
- **ECM-R64** On success one `documents` row is written and the answer is `201`.
  - Row: `document_id` = `doc_` plus 1 to 8 random characters from `a-z0-9`; `client_id` = the client's `id`; `document_type` = `coi`; `filename` = `COI-<policy_id>-<current time in epoch milliseconds>.pdf`; `mime_type` = `application/pdf`; `file_size_bytes` = the length of the PDF; `status` = `generated`; `upload_date` = now; `expiration_date` = the policy's `expiration_date`; `tags` = `["coi", <policy_type>]`; signer fields null.
  - Body: `document_id`, `client_id`, `policy_id`, `document_type`, `filename`, `file_size_bytes`, `pdf_url` = `/v1/documents/coi/<document_id>/pdf`, `status`, `certificate_holder` = `{ name, address }` (address `{}` when none was given), `description` = the request's `description` or `Certificate of Insurance for <first_name> <last_name>`, `coverage_summary` = `{ policy_type, carrier_code, effective_date, expiration_date, coverages }` copied from the policy (`coverages` `[]` when the policy has none), `created_at` = now.
- **ECM-R65** The certificate PDF follows section 6 with form number `25`, title `CERTIFICATE OF LIABILITY INSURANCE` and these fields: `PRODUCER` = `Evergreen Insurance Partners`; `INSURED` = `<first_name> <last_name>`; `INSURED EMAIL`; `INSURED ADDRESS` = street, city, state and zip joined with `, `; `INSURED PHONE`; `POLICY NUMBER`; `INSURER / CARRIER` = `carrier_code`; `LINE OF BUSINESS` = `policy_type` in upper case; `POLICY EFF DATE`; `POLICY EXP DATE`; `ANNUAL PREMIUM` = `premium_current` as currency; the coverage table; `CERTIFICATE HOLDER` = the holder's name; `HOLDER ADDRESS` = the holder's address parts joined with `, `, or `On File` when there are none; `DESCRIPTION OF OPERATIONS / LOCATIONS` = the description of ECM-R64.

### 5.8 Download a certificate PDF: `GET /v1/documents/coi/{document_id}/pdf` and `GET /v1/coi/{document_id}/pdf`

- **ECM-R66** Both paths behave identically. For a certificate generated by the running process the answer is `200` with the same PDF bytes that `file_size_bytes` measured, `Content-Type: application/pdf`, `Content-Length`, and `Content-Disposition: inline; filename="ACORD-25-<document_id>.pdf"`. An id that is neither such a certificate nor a stored `coi` document gives `404 NOT_FOUND`, message `COI document not found.`
- **ECM-R67** For a stored document of type `coi` that has no stored PDF bytes in the running process (such as seeded metadata rows), the answer is `404 NOT_FOUND`, message `COI document not found.` — the service never fabricates placeholder PDF bytes. A stored document of another type also gives `404 NOT_FOUND`.

### 5.9 ACORD forms: `GET /v1/documents/acord/{form_type}`

- **ECM-R70** `form_type` must be `90`, `80` or `35`, else `400` with `form_type` / `invalid_enum`.
- **ECM-R71** Forms `90` and `80` require the query parameter `policy_id` (`400`, `policy_id` / `required`). The policy and client are found as in ECM-R81; an unknown policy gives `400` with `policy_id` / `not_found`. Form `90` needs a `personal_auto` policy and form `80` a `homeowners` policy; otherwise `400` with `policy_id` / `invalid_type`, message `ACORD 90 requires a personal_auto policy.` or `ACORD 80 requires a homeowners policy.` The policy's status is not checked.
- **ECM-R72** Form `35` requires the query parameter `claim_id` (`400`, `claim_id` / `required`). The service reads the claim from Claims (`GET /v1/claims/<claim_id>`), then the client (`GET /v1/clients/<claim.client_id>`) and the client's policies (`GET /v1/clients/<claim.client_id>/policies?limit=100`) from the AMS. When none of those policies has the claim's `policy_id`, the answer is `400` with `claim_id` / `not_found`, message `Policy referenced by claim not found in AMS.`
- **ECM-R73** On success the answer is `200` with `Content-Type: application/pdf`, `Content-Length`, and `Content-Disposition: inline; filename="ACORD-<form_type>.pdf"`. Nothing is stored. The PDFs follow section 6:
  - Form `90`, title `PERSONAL AUTOMOBILE APPLICATION`. Fields: `FULL NAME`, `DATE OF BIRTH`, `MARITAL STATUS`, `MAILING ADDRESS` (`<street>, <city>, <state> <zip>`), `DRIVER LICENSE #`, `PHONE`, `EMAIL`, `OCCUPATION`, `POLICY NUMBER`, `CARRIER`, `STATUS` (upper case), `EFFECTIVE DATE`, `EXPIRATION DATE`, `ANNUAL PREMIUM` (currency), `MULTI-POLICY DISCOUNT` (`Yes` or `No`), then the coverage table.
  - Form `80`, title `HOMEOWNERS APPLICATION`. As form `90`, without `MAILING ADDRESS` and `DRIVER LICENSE #`, and with `STREET ADDRESS`, `CITY`, `STATE`, `ZIP CODE` from the client's address.
  - Form `35`, title `LOSS NOTICE`. Fields: `FULL NAME`, `PHONE`, `EMAIL`, `MAILING ADDRESS`, `POLICY NUMBER`, `CARRIER`, `POLICY TYPE` (upper case, first underscore as a space), `EFFECTIVE DATE`, `EXPIRATION DATE`, `DATE OF LOSS`, `DATE REPORTED`, `TYPE OF LOSS` (upper case, underscores as spaces), `LOCATION OF LOSS`, the loss description as wrapped text, `CLAIM NUMBER`, `CLAIM STATUS` (upper case), `RESERVE AMOUNT` and `SETTLEMENT AMOUNT` (currency). When the claim has an adjuster: `ADJUSTER NAME`, `SPECIALTY` (upper case), `EMAIL`, `PHONE`.

## 6. PDF layout rules

All PDFs are one US Letter page in the standard Helvetica fonts, so their text can be read back. In drawing order:

1. Header: `ACORD <form number>`, the form title, `Evergreen Insurance Agency`, `Generated: <today's date in UTC, YYYY-MM-DD>`.
2. Sections, each a heading in upper case followed by fields. A field is its label followed directly by its value. A null value is drawn as an em dash (`—`).
3. Coverage table, where a form has one: the column heads `COVERAGE TYPE`, `LIMIT`, `DEDUCTIBLE`, then per coverage its type in title case with underscores as spaces (`bodily_injury` gives `Bodily Injury`), its `limit` or `—`, and its `deductible` as `$<amount>` or `—`.
4. Footer: `ACORD <form number> (2025/01)`, then `Generated by Evergreen Insurance Platform`.

Currency is `$` plus the amount with thousands separators and two decimals (`$1,200.00`). Fonts, colours and positions are not part of the contract.

## 7. Calls to other services

- **ECM-R80** Every call to the AMS or to Claims is a `GET` that carries the caller's `Authorization` header unchanged and the header `X-Evergreen-Internal: 1`. The AMS base URL is `AMS_BASE_URL` when set and not empty, else `AMS_URL`, else `http://localhost:3000`. The Claims base URL is `CLAIMS_BASE_URL`, else `CLAIMS_URL`, else `http://localhost:3007`. Trailing slashes are dropped.
- **ECM-R81** Finding a policy by id (COI and forms `90` and `80`): first read the whole client list, `GET /v1/clients?limit=100`, then `GET /v1/clients?limit=100&cursor=<pagination.next_cursor>` for as long as `pagination.has_more` is true. Then, for each client in list order, `GET /v1/clients/<id>/policies?limit=100` and look in its `data` for the policy id. The search stops at the first match; that client and policy are used.
- **ECM-R82** When a peer returns `404` for a referenced claim or client on ACORD 35, the service answers `404 NOT_FOUND`. When a peer call cannot be completed or fails with a non-2xx/non-404 status, the service answers `502` with `error_code: "INTERNAL_ERROR"` and writes nothing.

Fields read from the AMS client: `id`, `first_name`, `last_name`, `dob`, `email`, `phone`, `address` (`street`, `city`, `state`, `zip`), `driver_license_number`, `occupation`, `marital_status`. From the AMS policy: `policy_id`, `client_id`, `carrier_code`, `policy_type`, `effective_date`, `expiration_date`, `premium_current`, `status`, `multi_policy_discount`, `coverages` (`type`, `limit`, `deductible`). From the claim: `claim_id`, `policy_id`, `client_id`, `claim_type`, `status`, `loss_date`, `reported_date`, `loss_description`, `loss_location`, `reserve_amount`, `settlement_amount`, `adjuster` (`first_name`, `last_name`, `email`, `phone`, `specialty`).

## 8. State machines

Envelope `status`: created as `created` (ECM-R44); `created` or `sent` becomes `expired` when the simulated clock passes `expiration_date` (ECM-R110). No operation moves an envelope to `sent`, `viewed`, `signed`, `completed` or `declined`; those come from seed data.

Document `status`: `uploaded` on upload (ECM-R11) and `generated` for a COI (ECM-R64). No operation changes it afterwards.

## 9. Facts that depend on seed data, and the simulated clock

- **ECM-R100** `GET /sim/snapshot` returns `tables` with exactly `documents`, `envelopes` and `marketing_assets`. `POST /sim/seed` with `base: "empty"` leaves all three present and empty.
- **ECM-R101** Seed facts:

| | `realistic` | `clean` |
| :--- | :--- | :--- |
| Documents | 87: 47 uploaded, 36 signed, 3 pending_signature, 1 expired | 85: 47 uploaded, 38 signed |
| Document types | 37 signed_application, 24 id_verification, 16 dec_page, 4 coi, 2 welcome_kit, 2 endorsement, 2 cancellation_notice | the same without the 2 cancellation_notice |
| Envelopes | 10: 5 completed, 1 sent, 1 viewed, 1 declined, 1 expired, 1 created | 10, all completed |
| Marketing assets | 8, two per category | the same |

  Ids run from `DOC-001`, `ENV-001` and `AST-001`. In both data sets client `CLI-001` has 5 documents and is `compliant`.
- **ECM-R102** `POST /sim/reset` and `POST /sim/seed` rebuild all three tables, discarding earlier writes.
- **ECM-R110** Every `POST /sim/time-travel` (body `{ "days": <number> }` or `{ "target_date": <ISO date> }`; neither or invalid gives `400 VALIDATION_ERROR`) sets to `expired` each envelope whose status is `created` or `sent` and whose `expiration_date`, compared as text, is earlier than the new simulated time in ISO form. It answers `200` with `{ "status": "ok", "service": "ecm", "simulated_time", "days_advanced", "transitions": { "envelopes_expired": n } }`. Documents are not touched.
- **ECM-R111** The comparison runs on every call, including zero and negative days.
- **ECM-R112** Request handling reads the shared simulated clock (`getSimulatedNow()` / `getSimulatedToday()`, `nextSimulatedEpochMs()`): `upload_date`, `created_at`, envelope `expiration_date`, `required_by`, the audit's expiry check (ECM-R32), COI filename epoch stamps and the `Generated:` date in PDFs follow the simulated clock (`2026-10-14T12:00:00.000Z` plus `clock_offset_ms`).
- **ECM-R113** `POST /sim/seed` and `POST /sim/reset` reset the simulated clock to `2026-10-14T12:00:00.000Z` (`clock_offset_ms` = 0).

## 10. Runtime contract

What the service must provide besides its `/v1` operations. The token endpoint, the `/sim/*` control plane, fault injection and the request log come from [`../packages/shared/`](../packages/shared/); the service has to mount them as described here.

- **ECM-R120** Process. The service starts with `bun run src/index.ts` in `services/ecm/` and listens on `PORT` (default 3003). The entry module's default export is `{ port, fetch }`, where `fetch` handles one HTTP request; it also exports `app` (whose `app.fetch` is the same handler) and `seedDatabase(mode)`. `bun run src/seed.ts` in the same directory rebuilds the database from the data set named by `SEED_MODE` (default `realistic`) and exits with code 0.
- **ECM-R121** Database. One SQLite file. Its location is `DATABASE_URL` (a `file:` URL) when set; otherwise `<EVERGREEN_DATA_DIR>/ecm.db` when `EVERGREEN_DATA_DIR` is set; otherwise `services/ecm/data/ecm.db`. A missing directory is created. The seed script and the server resolve the location the same way, so they share the file.
- **ECM-R122** Seeding. Every seed (the seed script, `POST /sim/reset`, `POST /sim/seed`) drops and recreates all tables (`documents`, `envelopes`, `marketing_assets`) and then loads a data set: mode `clean` reads `data/seed-clean/`, mode `empty` loads nothing, and any other mode reads `data/seed/`. Loading the same data set twice gives the same rows.
  `documents.json` fills `documents` (`tags` stored as JSON text, a missing `expiration_date` as null), `envelopes.json` fills `envelopes` (`document_ids` and `signers` stored as JSON text) and `marketing_assets.json` fills `marketing_assets`, columns copied by name.
  `POST /sim/reset` takes the mode from `seed_mode` in its optional JSON body, else from `SEED_MODE`, else `realistic`, and answers `{ "status": "reset", "service": "ecm", "seed_mode", "simulated_time" }`. `POST /sim/seed` takes `{ "base", "tables" }`: `base` is `empty` (default), `clean` or `realistic`; `tables` maps table names to rows inserted after the base is loaded, with nested JSON values stored as JSON text. With base `clean` or `realistic`, a row whose key already exists replaces the loaded row. It answers `{ "status": "seeded", "service", "base", "inserted": { table: count }, "simulated_time" }`. An unknown base or table name is `400 VALIDATION_ERROR` and changes nothing.
- **ECM-R123** `GET /sim/status` answers `{ "status": "ok", "service": "ecm", "simulated_time", "clock_offset_ms", "chaos": { "enabled", "error_rate", "status_code", "latency_ms" }, "modality_mode" }`, where `modality_mode` is `MODALITY_MODE` or `"permissive"` by default. After a seed or reset `clock_offset_ms` is 0 and `chaos` is `{ false, 0, 503, 0 }`. `GET /sim/snapshot` answers `{ "service", "timestamp", "simulated_time", "tables" }`. Neither needs credentials.
- **ECM-R124** Fault injection. `POST /sim/chaos` takes `{ "enabled" (boolean, required), "error_rate" (0 to 1), "status_code", "latency_ms" }`; fields left out keep their value; a missing or non-boolean `enabled` is `400 VALIDATION_ERROR`; on success it answers `200` with `{ "status": "ok", "service": "ecm", "chaos": { "enabled", "error_rate", "status_code", "latency_ms" } }`. While enabled, every request under `/v1` is first delayed by `latency_ms` and then, with probability `error_rate`, answered with `status_code` and `error_code: "SERVICE_UNAVAILABLE"` before authentication and before any handler runs, so nothing is written. `/health`, `/oauth/token` and `/sim/*` are never affected. A seed or reset switches fault injection off.
- **ECM-R125** Request log. Every request under `/v1`, whatever its outcome (including `401`), is recorded and returned by `GET /sim/trace`, oldest first, in OTLP JSON: `resourceSpans[0].resource.attributes` holds `service.name` = `ecm`; `scopeSpans[0].scope.name` is `evergreen-request-log`; each span has `traceId` (32 hex characters), `spanId` (16), `name` = `<METHOD> <path>`, `kind` 3, start and end times in nanoseconds, and the attributes `http.request.method`, `url.full` = `http://localhost:3003<path and query>`, `http.response.status_code`, `server.port` = 3003 and `http.request.body` (the first 16 KiB of the request body as text). The port in these attributes is always 3003, whatever `PORT` says. Requests that carry `X-Evergreen-Internal: 1` are not recorded, and neither are `/health`, `/oauth/token` and `/sim/*`. A successful seed or reset empties the log.
- **ECM-R126** Access log. For every request it answers, on any path, the service writes one line of JSON to standard output: `timestamp` (ISO time), `method`, `path` (without the query string), `status`, `duration_ms` (whole milliseconds), `correlation_id` (the value of ECM-R06), `query` (an object of the query parameters, present only when the request has any) and `user_agent` (present only when the request sent one). Personal data in `query` values is masked: an email address becomes its first character, `***@` and its domain; phone and social security numbers keep their last four digits.

## 11. Known gaps

All OpenAPI contract contradictions (`ECM-G01`–`ECM-G08`, `ECM-G14`) have been resolved across code, `packages/shared/src/auth.ts`, and `ecm.yaml`. The remaining items below are non-blocking behavioral notes:

| Id | Note |
| :--- | :--- |
| ECM-G09 | Certificates are kept in process memory, so a certificate generated before a seed, reset or restart is still served, or replaced by the placeholder of ECM-R67. The download filename of a placeholder differs between the first and later downloads. The placeholder shows fixed values (carrier `SMIT`, premium `$2,400.00`) and takes its policy number from the second dash-separated part of the filename. |
| ECM-G10 | The audit answers `404` when the `status` filter matches nothing, although the client has documents (ECM-R30). |
| ECM-G11 | Creating an envelope does not check that the documents belong to the client and does not set the documents to `pending_signature` (ECM-R43, ECM-R44). |
| ECM-G12 | `POST /sim/time-travel` expires envelopes (ECM-R110) without mutating document `status` rows. |
| ECM-G13 | Values of the wrong JSON type, and a `file` part sent as text, are not validated; their outcome is not part of this contract. |
