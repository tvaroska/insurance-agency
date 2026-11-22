# Coastal Star carrier portal (`carrier-coastal`, port 3006): behaviour specification

This document, together with the durable contracts listed below, is meant to be enough to rebuild the service implementation from nothing. It describes only what a client can observe over HTTP and in the service's database tables, plus a page-level contract for the portal's browser UI. Every rule has an id (`CST-Rn`) that the conformance tests in [`tests/conformance/carrier-coastal/`](../tests/conformance/carrier-coastal/) cite.

Where this document and [`carrier-coastal.yaml`](carrier-coastal.yaml) disagree, this document describes what the service does today; each disagreement is listed under [Known gaps](#known-gaps).

## Purpose

Coastal Star is a simulated insurance carrier that writes personal auto business and sells on speed. Its portal lets an agent get an instant quote from a vehicle identification number (VIN), submit a quote for a risk assessment, try different coverage choices and see the premium change, bind a quote into a policy, and fetch the policy's insurance ID card.

The portal has two faces served by one process: a JSON API under `/v1/coastal`, and a single-page browser UI served from `/`. In strict mode the API only answers requests that come from a browser session that loaded the UI (see [Portal session](#portal-session-and-strict-mode)), which forces an automated agent to work through the page the way a person would.

## Durable contracts

| Contract | Path |
| :--- | :--- |
| API wire contract (OpenAPI 3.0) | [`specs/carrier-coastal.yaml`](carrier-coastal.yaml) |
| Behaviour (this file) | [`specs/carrier-coastal.spec.md`](carrier-coastal.spec.md) |
| Table definitions | [`services/carrier-coastal/prisma/schema.prisma`](../services/carrier-coastal/prisma/schema.prisma) |
| Package manifest: entry points and dependencies | [`services/carrier-coastal/package.json`](../services/carrier-coastal/package.json) |
| Seed data | `quotes.json` and `policies.json` in [`data/seed/`](../data/seed/) and [`data/seed-clean/`](../data/seed-clean/) |
| Browser UI: source and built bundle | [`services/carrier-coastal/ui/`](../services/carrier-coastal/ui/), [`services/carrier-coastal/public/`](../services/carrier-coastal/public/) |
| Shared package: tokens, scopes, error envelope, validation helpers, correlation id, request log, chaos, strict mode and portal sessions, `/sim/*` control plane | [`packages/shared/`](../packages/shared/) |
| Conformance tests | [`tests/conformance/carrier-coastal/`](../tests/conformance/carrier-coastal/) |

The UI and the shared package are part of the durable set: a rebuild of the service keeps them and serves them. This document says how the service must use them and what the result looks like on the wire.

## Data model and invariants

Three tables. Column names and types are those of the Prisma schema. Timestamps are ISO-8601 strings; dates are `YYYY-MM-DD` strings.

**`quotes`**: one row per quote from this carrier.

| Column | Notes |
| :--- | :--- |
| `quote_id` | Primary key. Seed rows: `QT-NNN-CSTL`. Created by the API: `QT-CSTL-<epoch milliseconds>`. |
| `request_id` | Seed: `QR-NNN`. Created by the API: `QR-<epoch milliseconds>`. |
| `client_id`, `policy_type` | Free text, not checked against any other service. |
| `premium_annual`, `premium_monthly`, `premium_semi_annual` | Nullable numbers. `premium_semi_annual` is set only by the quick quote. |
| `coverages` | JSON-encoded array of `{ type, limit?, deductible? }`. |
| `deductibles` | JSON-encoded object. |
| `status` | `quoted` (only by seeding a row directly), `assessed`, `bound`; time travel adds `expired`. |
| `decline_reason`, `valid_until` | Nullable; copied from seed data. |
| `submitted_at` | Timestamp. |
| `risk_score` | Integer or null. |
| `risk_tier` | `preferred`, `standard`, `non_standard`, or null. |
| `risk_factors` | JSON-encoded array of `{ factor, impact, detail }`, or null. |
| `assessed_at` | Timestamp or null. |
| `bind_status` | `unbound` (default) or `bound`. |
| `bound_at`, `policy_id` | Set when bound. |
| `vin`, `vehicle_year`, `vehicle_make`, `vehicle_model`, `driver_name`, `driver_dob`, `driver_license`, `coverage_config` | Set only by the quick quote. |

**`policies`**: `policy_id` (primary key; seed ids such as `POL-PA-2025-002103`, bound ids `POL-CSTL-<epoch milliseconds>`), `client_id`, `policy_type`, `effective_date`, `expiration_date`, `premium_current`, `status`, `coverages` (JSON-encoded array), `created_at`, `updated_at`.

**`id_cards`**: `card_id` (primary key), `policy_id`, `card_data` (JSON-encoded object), `issued_at`.

Invariants:

- **CST-R1** The service owns exactly these three tables. `GET /sim/snapshot` returns them under the keys `quotes`, `policies`, `id_cards`, each sorted ascending by its primary key, with columns exactly as stored (JSON-encoded columns stay strings).
- **CST-R2** Every `id_cards.policy_id` names an existing policy, and a policy has at most one ID card. A quote with `bind_status` `bound` that was bound through the API has `status` `bound`, a `bound_at`, and a `policy_id` naming an existing policy.
- **CST-R3** JSON-encoded columns always hold valid JSON text and are returned decoded on the wire.
- **CST-R4** No operation deletes a row.
- **CST-R5** The service calls no other service.

## Auth and scopes

- **CST-R6** `GET /health` needs no token and returns `200` with `{ "status": "ok", "service": "carrier-coastal", "timestamp": <ISO time> }`.
- **CST-R7** `GET /auth/dev-token` needs no token and returns `200` with `{ "token": <JWT> }`. The token is valid for one hour, has subject `dev-user`, and carries exactly the four carrier scopes `carrier:quotes:read`, `carrier:quotes:write`, `carrier:underwriting:write`, `carrier:policies:read`. This is the token the browser UI uses.
- **CST-R8** `POST /oauth/token` is the shared client-credentials endpoint and needs no token. For this service: `agent-full` holds all four carrier scopes; `agent-csr` holds all but `carrier:underwriting:write`; `agent-readonly` holds `carrier:quotes:read` and `carrier:policies:read`.
- **CST-R9** Every route under `/v1/coastal` requires `Authorization: Bearer <token>`. A missing or malformed header, a bad signature or an expired token gives `401` with `{ "error_code": "AUTH_ERROR", "message": ..., "correlation_id": ... }`.
- **CST-R10** Each route checks one scope after the token check. A token without it gets `403` with `{ "error_code": "FORBIDDEN", "message": "Missing required scope(s): <scope>", "correlation_id": ... }`, and nothing is written.

  | Route (under `/v1/coastal`) | Scope |
  | :--- | :--- |
  | `POST /quotes/submit` | `carrier:quotes:write` |
  | `GET /quotes/{quote_id}/risk-assessment` | `carrier:quotes:read` |
  | `POST /quotes/{quote_id}/bind` | `carrier:underwriting:write` |
  | `POST /quotes/quick` | `carrier:quotes:write` |
  | `POST /quotes/{quote_id}/recalculate` | `carrier:quotes:read` |
  | `GET /policies/{policy_id}/id-card` | `carrier:policies:read` |

- **CST-R11** Order of checks on an API request: strict-mode session (CST-R16), then token (`401`), then scope (`403`), then body validation (`400`), then existence (`404`), then state (`409`, or `400` for binding an unassessed quote).
- **CST-R12** Every response carries an `X-Correlation-ID` header, echoing the request's header when one was sent. Error bodies produced by the shared envelope repeat it as `correlation_id`.
- **CST-R13** Error bodies use the shared envelope: `{ "error_code", "message", "correlation_id" }`, plus `details` (an array of `{ "field", "message", "code" }`) for validation errors. Validation errors are status `400` with `error_code` `VALIDATION_ERROR` and message `One or more fields failed validation.`. Not found is `404` `NOT_FOUND` with message `<thing> not found.`. A state conflict is `409` `CONFLICT`.

## Portal session and strict mode

The process reads `MODALITY_MODE` from its environment. Any value other than `strict` (ignoring case), or no value, means permissive mode. `GET /sim/status` reports the value as `modality_mode`.

- **CST-R14** Bootstrap cookie. A `GET /` or `GET /index.html` response carries, in both modes, a `Set-Cookie` header: `evergreen_portal_boot_carrier-coastal=<uuid>; HttpOnly; SameSite=Strict; Path=/`. Each load issues a fresh value; earlier values stay valid. No other response sets it, including the HTML returned for other paths (CST-R43) and a `HEAD /`.
- **CST-R15** Session endpoint. `GET /auth/portal-session` needs no bearer token and returns `200` with `{ "session_token": "portal_sess_carrier-coastal_<uuid>", "service": "carrier-coastal", "modality": "web-portal", "header": "X-Portal-Session", "expires_in": 3600 }`. Each call issues a new token; earlier tokens stay valid.
  - In permissive mode it answers every request, with or without a cookie.
  - In strict mode the request must send a `Cookie` header containing a bootstrap cookie value this process issued and that has not expired. Otherwise the answer is `403` with `{ "error_code": "PORTAL_BOOTSTRAP_REQUIRED", "message": ..., "correlation_id": ... }`.
- **CST-R16** Strict guard. In strict mode every request under `/v1/coastal` must send an `X-Portal-Session` header holding a session token this process issued and that has not expired. Otherwise the answer is `403` with `{ "error_code": "MODALITY_VIOLATION", "message": ..., "correlation_id": ... }`. The guard runs before the token check, so a request with neither token nor session gets `403`, and a request with a valid session and no bearer token gets `401`. A valid session does not replace the bearer token or the scope.
- **CST-R17** In permissive mode the `X-Portal-Session` header is ignored: requests succeed without it and with an unknown value.
- **CST-R18** Lifetime. Bootstrap cookies and session tokens live for 3600 seconds of wall-clock time; time travel does not expire them. They are held in the memory of the issuing process: a token from another service (for example `carrier-summit`) or from before a restart is unknown. `POST /sim/reset` and `POST /sim/seed` discard every cookie and session, so a client must load `/` and fetch a session again afterwards.
- **CST-R19** Scorer exemption. In strict mode a request under `/v1/coastal` that carries `X-Eval-Scorer: true` passes the guard without a session and is then handled normally (token and scope still apply). If the process has `EVERGREEN_SCORER_SECRET` set, the request must also carry that value in `X-Evergreen-Scorer-Secret`. The `X-Evergreen-Internal` header does not exempt a request.
- **CST-R20** Strict mode leaves `/health`, `/auth/dev-token`, `/oauth/token`, `/sim/*` and the static UI open.

The handshake a browser, or a test acting as one, performs in strict mode:

1. `GET /` and keep the bootstrap cookie.
2. `GET /auth/dev-token` for a bearer token.
3. `GET /auth/portal-session` with the cookie, for a session token.
4. Call `/v1/coastal/...` with `Authorization: Bearer <token>` and `X-Portal-Session: <session token>`.

## Risk assessment

Several operations and the seed loader share these definitions.

- **CST-R21** Score from a quote id. Start with `h = 0`; for each character of the quote id, in order, `h = (h * 31 + <character code>)` keeping the low 31 bits. The score is `(h mod 60) + 30`, so it lies between 30 and 89. Example: `QT-001-CSTL` scores 80.
- **CST-R22** Tier: score 75 or more is `preferred`; 50 to 74 is `standard`; below 50 is `non_standard`.
- **CST-R23** Factors from a score, always these three, in this order:

  | `factor` | `impact` and `detail` |
  | :--- | :--- |
  | `driver_age` | score ≥ 60: `positive`, `Primary driver in preferred age range`; else `neutral`, `Driver age within acceptable range` |
  | `vehicle_value` | score ≥ 70: `positive`, `Vehicle value within low-risk tier`; else `neutral`, `Vehicle value is moderate` |
  | `claims_history` | score ≥ 50: `positive`, `No claims in past 3 years`; else `negative`, `Recent claims on file` |

- **CST-R24** Recommendation: score 65 or more is `approve`; 45 to 64 is `review`; below 45 is `decline`.

## Rules per operation

Paths are relative to `/v1/coastal`. "Now" is wall-clock time (see [Simulated clock](#simulated-clock)). Every POST needs a JSON body, even if it is `{}`.

### `POST /quotes/submit` (submitQuote)

The operation has two forms, chosen by whether the body has a non-empty `quote_id`.

Without `quote_id`: create and assess a new quote.

- **CST-R25** `client_id`, `policy_type` and `effective_date` are required; each one that is missing, null or empty adds a detail `{ field, code: "required" }`, in that order, status `400`. Nothing else is validated.
- **CST-R26** One `quotes` row is inserted: `quote_id` `QT-CSTL-<epoch milliseconds now>`; `request_id` `QR-<epoch milliseconds now>`; `client_id`, `policy_type` as given; `coverages` as given or `[]`; `deductibles` `{}`; `status` `assessed`; `submitted_at` and `assessed_at` now; `risk_score`, `risk_tier`, `risk_factors` from the new quote id (CST-R21 to CST-R23); `bind_status` `unbound`. The premium is a base of 2800 when `policy_type` is `bop` and 1400 for any other type, times `1 + (score - 50) / 100`, rounded to cents; `premium_monthly` is the annual premium divided by 12, rounded to cents. `effective_date` is not stored.
- **CST-R27** The response is `201` with `quote_id`, `request_id`, `client_id`, `policy_type`, `premium_annual`, `premium_monthly`, `coverages`, `status`, `risk_score`, `risk_tier`, `assessed_at`.

With `quote_id`: assess an existing quote. Other body fields are ignored.

- **CST-R28** Unknown quote: `404`, message `quote not found.`. A quote whose `status` is not `quoted`: `409`, message `Quote already has status '<status>'. Only 'quoted' quotes can be submitted.`, row unchanged.
- **CST-R29** Otherwise the row is updated: `status` `assessed`; `risk_score`, `risk_tier`, `risk_factors` from the quote id; `assessed_at` now. Premiums and coverages are unchanged. The response is `201` with `quote_id`, `request_id`, `client_id`, `policy_type`, `premium_annual`, `premium_monthly`, `coverages`, `deductibles`, `status`, `risk_score`, `risk_tier`, `assessed_at`, `submitted_at`.

### `GET /quotes/{quote_id}/risk-assessment` (getRiskAssessment)

- **CST-R30** Unknown quote: `404`, message `quote not found.`. A quote with no `risk_score` or no `assessed_at`: `404`, message `risk assessment not found.`. Otherwise `200` with `quote_id`, `risk_score`, `risk_tier`, `factors` (the stored factors), `recommendation` (CST-R24, from the stored score), `assessed_at`.

### `POST /quotes/quick` (quickQuote)

Body: `vin`, `client_id`, `driver_name`, and optionally `driver_dob` (date) and `driver_license`.

- **CST-R31** `vin`, `client_id` and `driver_name` are required; each one missing, null or empty adds a detail `{ field, code: "required" }`, in that order, status `400`. The VIN's length and characters are not checked.
- **CST-R32** VIN decode. The make comes from the first three characters, upper-cased:

  | Prefix | Make | Models, in order |
  | :--- | :--- | :--- |
  | `1HG` | Honda | Civic, Accord, CR-V |
  | `1FA` | Ford | Mustang, Fusion, F-150 |
  | `1G1` | Chevrolet | Malibu, Equinox, Silverado |
  | `5YJ` | Tesla | Model 3, Model Y, Model S |
  | `WBA` | BMW | 3 Series, 5 Series, X3 |
  | `JTD` | Toyota | Camry, RAV4, Corolla |
  | anything else | Generic | Sedan |

  With `h` computed over the whole VIN as given, by the hash of CST-R21: the year is `2018 + (h mod 8)` and the model is the entry at position `h mod <number of models>` (counting from zero). Example: `1HGCM82633A004352` is a 2021 Honda Accord.
- **CST-R33** Premium. Start at 1200 a year.
  - Vehicle age is `2026 - year` (2026 is a constant of the formula). Two years or less: times 1.15. Three to five: unchanged. Older: times 0.9.
  - Driver age is whole years from `driver_dob` to now, using a year of 365.25 days; when `driver_dob` is absent the date `1990-01-01` is used. Under 25: times 1.4. 25 to 29: times 1.15. Over 65: times 1.1. Otherwise unchanged.
  - `annual` is the result rounded to cents; `semi_annual` is `annual * 0.52` rounded to cents; `monthly` is `annual / 12` rounded to cents.
- **CST-R34** Risk. The score is a random whole number from 50 to 84, not derived from the quote id. The tier follows CST-R22 (so it is `preferred` or `standard`). The stored factors are: `driver_age` (`positive` when the score is 60 or more, else `neutral`; detail `Driver age assessment`), `vehicle_value` (`neutral`; detail `<year> <make> <model>`), `claims_history` (`positive`; detail `No claims on file`).
- **CST-R35** One `quotes` row is inserted: ids as in CST-R26; `client_id` as given; `policy_type` `personal_auto`; the three premiums; `coverages` and `coverage_config` both the default coverage list below; `deductibles` `{ "collision": 500, "comprehensive": 250 }`; `status` `assessed`; `submitted_at` and `assessed_at` now; the risk fields; `vin` as given; `vehicle_year`, `vehicle_make`, `vehicle_model` from the decode; `driver_name`; `driver_dob` or null; `driver_license` or null.

  Default coverages: `bodily_injury` limit `100/300`; `property_damage` limit `50000` (a number); `collision` deductible `500`; `comprehensive` deductible `250`; `uninsured_motorist` limit `100/300`.
- **CST-R36** The response is `201` with `quote_id`, `client_id`, `vehicle` (`vin`, `year`, `make`, `model`), `premium` (`annual`, `semi_annual`, `monthly`), `risk_score`, `risk_tier`, `coverages`, `status` (`assessed`), `assessed_at`.

### `POST /quotes/{quote_id}/recalculate` (recalculateQuote)

Body: optionally `coverages`, an array of `{ type, limit?, deductible? }`.

- **CST-R37** Unknown quote: `404`, message `quote not found.`. Otherwise the operation computes an adjusted premium and writes nothing.
  - The coverage list is the body's `coverages` when given, otherwise the quote's stored coverages. Any other body field is ignored.
  - The base is the quote's `premium_annual`, or 1200 when that is null or zero.
  - The base is multiplied by one factor for each coverage whose `type` and limit (as text) appear in the limit table, and one for each whose `type` and deductible (as text) appear in the deductible table. Unknown types and values contribute nothing.

  | Limit factors | |
  | :--- | :--- |
  | `bodily_injury` | `25/50` 0.7, `50/100` 0.85, `100/300` 1.0, `250/500` 1.2, `500/500` 1.35 |
  | `property_damage` | `25000` 0.8, `50000` 1.0, `100000` 1.15, `250000` 1.3 |
  | `uninsured_motorist` | `25/50` 0.75, `50/100` 0.9, `100/300` 1.0, `250/500` 1.15 |

  | Deductible factors | |
  | :--- | :--- |
  | `collision` | `250` 1.15, `500` 1.0, `1000` 0.85, `2500` 0.7 |
  | `comprehensive` | `100` 1.2, `250` 1.0, `500` 0.85, `1000` 0.7 |

  - `adjusted_premium.annual` is the product rounded to cents; `semi_annual` is `annual * 0.52` and `monthly` is `annual / 12`, both rounded to cents.
- **CST-R38** The response is `200` with `quote_id`, `original_premium` (`annual` and `monthly` as stored, possibly null), `adjusted_premium` (`annual`, `semi_annual`, `monthly`), and `coverages` (the list that was used).

### `POST /quotes/{quote_id}/bind` (bindQuote)

Body: `effective_date` (date) and optionally `payment_plan`.

- **CST-R39** Checks, in order:
  1. `effective_date` missing, null or empty: detail `{ field: "effective_date", code: "required" }`. `payment_plan` given and not one of `annual`, `monthly`, `semi_annual`: detail `{ field: "payment_plan", code: "invalid_enum" }`. Status `400`.
  2. Unknown quote: `404`, message `quote not found.`.
  3. `bind_status` already `bound`: `409`, message `Quote has already been bound.`.
  4. `status` not `assessed`: `400` validation error with one detail, `{ field: "quote_id", message: "Quote must be assessed before binding. Current status: '<status>'." }` (this detail has no `code`).

  When any check fails nothing is written.
- **CST-R40** On success one `policies` row is inserted and the quote is updated.
  - Policy: `policy_id` `POL-CSTL-<epoch milliseconds now>`; `client_id`, `policy_type` and `coverages` copied from the quote; `effective_date` as given; `expiration_date` the same month and day one year later (`2026-04-01` gives `2027-04-01`; the date is not checked, so `2028-02-29` gives `2029-02-29`); `premium_current` the quote's `premium_annual`, or 0 when null; `status` `active`; `created_at` and `updated_at` now.
  - Quote: `status` `bound`, `bind_status` `bound`, `bound_at` now, `policy_id` the new policy.
  - `payment_plan` is validated but not stored and changes nothing.
- **CST-R41** The response is `200` with `quote_id`, `policy_id`, `bind_status` (`bound`), `effective_date`, `expiration_date`, `premium_current`, `bound_at`.

### `GET /policies/{policy_id}/id-card` (getPolicyIdCard)

- **CST-R42** Unknown policy: `404`, message `policy not found.`. If the policy already has an `id_cards` row, that card is returned. Otherwise a card is created by this request and returned: `card_id` is `IDC-`, then the first eight characters of the policy id after removing everything but upper-case letters and digits, then `-<epoch milliseconds now>`; `issued_at` now; `card_data` is

  ```json
  { "carrier": "Coastal Star Insurance", "carrier_code": "CSTL", "policy_number": "<policy_id>",
    "insured_name": "<the policy's client_id>", "policy_type": "...", "effective_date": "...",
    "expiration_date": "...", "coverages_summary": [ { "type": "...", "limit": ... } ] }
  ```

  with one `coverages_summary` entry per coverage of the policy, carrying its `type` and its `limit` when it has one. The response is `200` with `card_id`, `policy_id`, `card_data` (decoded), `issued_at`. Repeating the request returns the same card: same `card_id`, same `issued_at`, and still one row.

### Static UI

- **CST-R43** `GET /` and `GET /index.html` return the portal page as `text/html`. Files under `/assets/` named by that page are served with their own content type. Any other `GET` path that matches no API route and no file returns the same page (so a deep link reloads the application), without a bootstrap cookie.

### Latency

- **CST-R44** When the process has `CARRIER_LATENCY_MS` set to a positive number, every authenticated `/v1/coastal` request waits that many milliseconds after the token check and before it is handled. Default is no delay.

## Browser UI: page-level contract

The UI is a single page titled "Coastal Star Auto Portal". It has a header ("COASTAL STAR", "Auto Portal"), three tabs, and the footer "Training Environment — Not for Production Use". The page loads without calling the API; calls happen on user actions.

How the page talks to the API (every screen):

- **CST-R45** On its first API call the page fetches `GET /auth/dev-token` and `GET /auth/portal-session` and keeps both in memory. Every API request sends `Content-Type: application/json`, `Authorization: Bearer <dev token>` and `X-Portal-Session: <session token>`. A session is renewed when it has less than a minute to live. If `/auth/portal-session` answers `403`, the page reloads `/` once to get a fresh bootstrap cookie and asks again. If an API call answers `403` with `MODALITY_VIOLATION`, the page drops its session, gets a new one and repeats the call once. Any other non-success answer is shown to the user as the response's `message`.

Screens:

**Quick Quote** (first tab, shown on load).

- Fields: VIN (up to 17 characters) with a "Decode" button, Driver Name, Date of Birth, License Number, Client ID.
- "Decode" is enabled once the VIN has five characters. It shows Year, Make, Model and a "Decoded" badge. This decode is done by the page itself, with its own table; it does not call the API and can differ from the vehicle the API decodes (CST-R32).
- "Get Quote" is enabled when all five fields are filled. It sends `POST /v1/coastal/quotes/quick` with `vin`, `driver_name`, `driver_dob`, `driver_license`, `client_id`.
- Result: a "Quote Result" heading with the status badge, the annual premium with semi-annual and monthly amounts, the Quote ID and the Client ID. A failure shows the error message.

**Compare & Customize** (second tab).

- Fields: a quote id box ("Enter quote ID to customize") and five selectors, with these choices and defaults:

  | Selector | Choices | Default |
  | :--- | :--- | :--- |
  | Bodily Injury | 25/50, 50/100, 100/300, 250/500, 500/500 | 50/100 |
  | Property Damage | 25000, 50000, 100000, 250000 | 50000 |
  | Collision Deductible | 250, 500, 1000, 2500 | 500 |
  | Comprehensive Deductible | 100, 250, 500, 1000 | 250 |
  | Uninsured Motorist | 25/50, 50/100, 100/300, 250/500 | 50/100 |

- "Recalculate" is enabled when the quote id is filled. It sends `POST /v1/coastal/quotes/{id}/recalculate` with `{ "coverages": [...] }` built from the five choices.
- Result: "Original Premium" and "Adjusted Premium" side by side, with the difference labelled increase, savings or no change. An unknown quote shows the error message.

**Bind & Go** (third tab).

- Fields: Quote ID, Effective Date, and a Payment Plan choice of Annual (default), Semi-Annual or Monthly, each with a price shown as "--" when unknown.
- "Bind Now" is enabled when quote id and effective date are filled. It sends `POST /v1/coastal/quotes/{id}/bind` with `effective_date` and `payment_plan`, and on success `GET /v1/coastal/policies/{policy_id}/id-card` for the new policy.
- Result: "Policy bound successfully!" with a "Confirmed" badge, Policy ID, Status, Effective Date, Expiration Date and Bound At, followed by an insurance ID card showing Policy Number, Status, Effective, Expires and, when the card was fetched, Insured and Vehicle. A failure of the bind shows the error message; a failure of the card fetch is ignored.

What a browser user must be able to complete:

- **CST-R46** Load the portal in strict mode and use any screen without ever handling a token: the page performs the handshake of CST-R14 to CST-R16 by itself and recovers from a lost session (CST-R45).
- **CST-R47** Get an instant quote from a VIN and driver details and see its quote id, status and premiums (CST-R31 to CST-R36).
- **CST-R48** Choose different limits and deductibles for a quote and see the adjusted premium next to the original (CST-R37, CST-R38).
- **CST-R49** Bind an assessed quote with an effective date and payment plan, see the new policy's id and dates, and see its ID card (CST-R39 to CST-R42).

## State machines

**Quote** (`status` / `bind_status`):

| From | Event | To |
| :--- | :--- | :--- |
| (none) | submit without `quote_id`, or quick quote | `assessed` / `unbound` |
| `quoted` / `unbound` | submit with `quote_id` | `assessed` / `unbound` |
| `quoted` / `unbound` | time travel past `valid_until` | `expired` / `unbound` |
| `assessed` / `unbound` | bind | `bound` / `bound` |
| any other status | submit with `quote_id` | `409` |
| `bound` | bind | `409` |
| not `assessed`, not bound | bind | `400` |

An `assessed` quote does not expire. `bound` is final.

**Policy status**: `active` from binding; `active` to `expired` by time travel only (CST-R53). Seed policies may also be `cancelled` or `pending`, which nothing changes.

**ID card**: absent, then created by the first read (CST-R42), then fixed.

## Facts that depend on seed data

- **CST-R50** `POST /sim/reset` (optional body `{ "seed_mode": "realistic" | "clean" }`, default from `SEED_MODE`, else `realistic`; any value other than `clean` loads the realistic set) drops and recreates the three tables and loads seed data from `data/seed/` or `data/seed-clean/`. `POST /sim/seed` with `base: "empty"` recreates the tables and loads nothing before inserting the rows given in the request. `id_cards` is always empty after a reset.
- **CST-R51** Seed mapping.
  - Policies: every entry of `policies.json` whose `carrier_code` is `CSTL`, columns copied, `coverages` JSON-encoded.
  - Quotes: every entry of `results` in `quotes.json` whose `carrier_code` is `CSTL` becomes a row. `quote_id`, `premium_annual`, `premium_monthly`, `coverages`, `deductibles`, `decline_reason`, `valid_until` come from the result; `request_id`, `client_id`, `policy_type`, `submitted_at` from the enclosing request. A result whose status is `bound` becomes `status` `bound`, `bind_status` `bound`, `bound_at` equal to `submitted_at`, and `policy_id` the first Coastal policy in file order that belongs to the same client and is `active` (null when there is none). Every other result, whatever its status in the file, becomes `status` `assessed`, `bind_status` `unbound`. All rows get `risk_score`, `risk_tier` and `risk_factors` from their quote id (CST-R21 to CST-R23) and `assessed_at` equal to `submitted_at`. `premium_semi_annual` and the vehicle and driver columns are null.
- **CST-R52** Facts the tests pin. The two sets have the same quotes and the same policy ids for this carrier and differ in one policy, `POL-PA-2026-000030`:

  | Fact | Value |
  | :--- | :--- |
  | Quotes | 8: 7 `assessed` / `unbound`, 1 `bound` / `bound` |
  | Policies | 10: 8 `active`, 1 `cancelled`, 1 `pending` |
  | `QT-001-CSTL` | client `CLI-003`, `personal_auto`, annual 1020, monthly 89, score 80, `preferred`, recommendation `approve` |
  | `QT-002-CSTL` | annual 2780, score 51, `standard`, recommendation `review` |
  | `QT-005-CSTL` | `bound`, policy `POL-PA-2025-002301` |
  | `QT-014-CSTL` | `assessed` although declined in the seed file; premiums null |
  | `POL-PA-2025-002103` | client `CLI-003`, `2026-05-15` to `2026-11-15`, `active` |
| `POL-PA-2026-000030` | realistic: `premium_current` 680, three coverages (`bodily_injury` 15000/30000, `property_damage` 5000, `collision` deductible 2000); clean: `premium_current` 1250, five coverages |

## Simulated clock

- **CST-R53** `POST /sim/time-travel` (body `{ "days": <number> }` or `{ "target_date": <ISO date> }`; neither or invalid gives `400 VALIDATION_ERROR`) moves the shared simulated clock and then, for this service:
  - every quote with `status` `quoted` and a `valid_until` date earlier than the simulated date becomes `expired`
  - every policy with `status` `active` and an `expiration_date` earlier than the simulated date becomes `expired`, and its `updated_at` becomes the simulated time

  It answers `200` with `{ "status": "ok", "service": "carrier-coastal", "simulated_time", "days_advanced", "transitions": { "quotes_expired": <count>, "policies_expired": <count> } }`. Dates equal to the simulated date do not expire.
- **CST-R54** API operations follow the shared simulated clock (`getSimulatedNow()`, `nextSimulatedEpochMs()`, anchored at `2026-10-14T12:00:00.000Z` unless `SIMULATED_TODAY` overrides it): monotonic epoch-millisecond ids, `submitted_at`, `assessed_at`, `bound_at`, `issued_at` and the driver's age advance with `/sim/time-travel`. Portal session and bootstrap cookie lifetimes continue to use 3600s of wall-clock time. Reset and seed return the simulated clock to `2026-10-14T12:00:00.000Z` (`clock_offset_ms` = 0).

## Simulation control plane and request log

- **CST-R55** The service mounts the shared control plane without authentication: `GET /sim/snapshot`, `POST /sim/reset`, `POST /sim/seed`, `POST /sim/time-travel`, `POST /sim/chaos`, `GET /sim/status` (`{ "status": "ok", "service": "carrier-coastal", "simulated_time", "clock_offset_ms", "chaos": { "enabled", "error_rate", "status_code", "latency_ms" }, "modality_mode" }`, where `modality_mode` is `MODALITY_MODE` or `"permissive"` by default), `GET /sim/trace`.
- **CST-R56** Chaos applies to `/v1/*` only: `POST /sim/chaos` takes `{ "enabled" (boolean, required), "error_rate" (0 to 1), "status_code", "latency_ms" }` and answers `200` with `{ "status": "ok", "service": "carrier-coastal", "chaos": { "enabled", "error_rate", "status_code", "latency_ms" } }`. With `{ "enabled": true, "error_rate": 1 }` every `/v1/*` request is answered with the configured status (default `503`) and `{ "error_code": "SERVICE_UNAVAILABLE", ... }` without running. `/health`, `/auth/*`, `/sim/*` and the UI are not affected. Reset and seed turn chaos off.
- **CST-R57** Request log. Every `/v1/*` request is recorded as a span and returned by `GET /sim/trace` in OTLP JSON form, under resource attribute `service.name` = `carrier-coastal`. A span's `url.full` and `server.port` use the canonical port 3006 whatever port the process listens on. Reset and seed clear the log.

## Runtime contract

What the rest of the repository relies on when it starts the service. The package manifest ([`services/carrier-coastal/package.json`](../services/carrier-coastal/package.json)) is part of the durable set and names the entry points, so a rebuild must put its code where the manifest looks for it.

- **CST-R58** Entry points. The manifest's `start` script (`bun run src/index.ts`) starts the HTTP service, which also serves the built page from `services/carrier-coastal/public/` (CST-R43), and its `seed` script (`bun run src/seed.ts`) runs the seed script. The HTTP service listens on the port named by `PORT`, default 3006. The module `src/index.ts` has a default export `{ port, fetch }` and a named export `app` whose `fetch(request)` answers a request without a socket; the conformance harness uses `app` when it cannot bind a port.
- **CST-R59** Database. The service keeps its tables in one SQLite file: the `file:` URL in `DATABASE_URL` when that is set; otherwise `carrier-coastal.db` in the directory named by `EVERGREEN_DATA_DIR`; otherwise `services/carrier-coastal/data/carrier-coastal.db`. A missing directory is created. Starting the service does not create or fill the tables; `POST /sim/reset`, `POST /sim/seed` and the seed script do (CST-R50).
- **CST-R60** Seed script. Running the `seed` script drops and recreates the three tables in the database of CST-R59, loads the data set named by `SEED_MODE` (`clean`; unset or any other value means realistic) with the same mapping as a reset, and exits with status 0. A running service on the same database sees the result at once.
- **CST-R61** Access log. Every request the HTTP service answers is written to standard output as one line of JSON with `timestamp`, `method`, `path`, `status`, `duration_ms` and `correlation_id` (the value of CST-R12), plus `query` when the request had a query string (personal data masked by the shared package) and `user_agent` when the request sent one.

## Known gaps

All OpenAPI-vs-service contract disagreements (items 1–4) and portal UI payload mismatches (items 7–9) have been resolved and verified by `tests/conformance/carrier-coastal/`:

1. **Validation status (resolved).** [`carrier-coastal.yaml`](carrier-coastal.yaml) documents `400` (`BadRequest`) for validation errors (including binding an unassessed quote), matching CST-R13.
2. **Portal session (resolved).** `GET /auth/portal-session` (`200` `PortalSessionResponse` and `403` `PORTAL_BOOTSTRAP_REQUIRED`) and strict-mode `403 MODALITY_VIOLATION` responses are documented in [`carrier-coastal.yaml`](carrier-coastal.yaml). `POST /oauth/token` and `/sim/*` remain shared platform control routes outside the carrier OpenAPI spec.
3. **Schema alignment (resolved).** `CoastalQuoteAssessed` makes `deductibles` and `submitted_at` optional and accepts any `policy_type` string; `RecalculateResponse.original_premium.{annual,monthly}` are nullable (CST-R27, CST-R38).
4. **Root server path (resolved).** `/health`, `/auth/dev-token`, and `/auth/portal-session` declare path-item `servers: [{ url: http://localhost:3006 }]` so they resolve at the root while `/v1/coastal/*` resolves under `/v1`.

Intentional simulation simplifications (kept as specified):

5. Dates are not checked. Binding with an `effective_date` that is not a date succeeds and stores a meaningless `expiration_date`; `payment_plan` has no effect (CST-R40).
6. Ids come from the clock in milliseconds; two creations in the same millisecond collide on the primary key and the second fails with `500`. Malformed JSON returns `400 VALIDATION_ERROR` via the shared `errorHandler`. Reading an ID card is a `GET` that writes a row (CST-R42).
7. **Quick Quote screen (resolved).** The shipped page sends `driver_license` matching CST-R35 and reads nested `premium.annual`, `premium.semi_annual` and `premium.monthly` returned by CST-R36.
8. **Compare & Customize screen (resolved).** The shipped page sends `{ "coverages": [...] }` matching CST-R37 and extracts `.annual` from `original_premium` and `adjusted_premium` objects returned by CST-R38. Legacy flat bodies without a `coverages` array remain ignored by the API.
9. **Bind & Go screen (resolved).** The shipped page derives plan breakdown estimates from `premium_current` when `premium_annual` is absent on the bind response and reads `card_data.insured_name` on the ID card response.
10. The page's API client has a quote look-up call (`GET /v1/coastal/quotes/{id}`) that no screen uses and the API does not implement. That path, like any unknown `GET` under `/v1/coastal` sent with a valid token, falls through to the UI page and returns `200` HTML rather than a JSON `404`.
11. The quick quote's risk score is generated via the deterministic episode PRNG (`simRandom()`, reset on `/sim/reset` and `/sim/seed`), so sequential calls in an episode vary across `[50, 84]` while identical trajectories from a reset state are reproducible (CST-R34).

HTTP-conformance boundary (interactive DOM rendering is verified separately in browser/e2e suites):

12. Visual rendering, button enable/disable states, the page's local VIN decode, and runtime session renewal/retry loops execute in the browser. The conformance suite proves that the page and its JS/CSS assets are served, verifies the shipped bundle contains the fixed route, header, payload, and screen markers of CST-R45 to CST-R49, and executes the exact handshake and API payloads over HTTP in strict mode.
13. Browser cookie jar handling (`HttpOnly`, `SameSite=Strict`) is tested via `Set-Cookie` and `Cookie` headers over HTTP.
14. CST-R46 to CST-R49 API journeys are verified over HTTP in strict mode using the fixed payloads shipped by the page.
15. Wall-clock 3600s expiry of cookies and sessions is not waited for.

Strict mode, `EVERGREEN_SCORER_SECRET` and `CARRIER_LATENCY_MS` are tested on extra instances started with those variables. When the suite runs against an already deployed service these extra instances are not available.
