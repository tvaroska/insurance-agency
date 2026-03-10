# Evergreen Insurance Platform — API Reference

**Version:** 1.4.0
**Base URLs:** See per-service sections below

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Common Patterns](#2-common-patterns)
3. [Agency Management System (AMS)](#3-agency-management-system-ams)
4. [Comparative Rater](#4-comparative-rater)
5. [Communication Hub (MCP)](#5-communication-hub-mcp)
6. [CRM & Marketing Automation](#6-crm--marketing-automation)
7. [Document & Content Management (ECM)](#7-document--content-management-ecm)
8. [Claims Service](#8-claims-service)
9. [Mock Carrier Portals](#9-mock-carrier-portals)
10. [Webhook Events](#10-webhook-events)
11. [Integration Flows](#11-integration-flows)

---

## 1. Authentication

OAuth 2.0 with scoped JWT tokens. Each service exposes a token endpoint at `POST /oauth/token`.

### Token Endpoint (Client Credentials)

```
POST http://localhost:{port}/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={client_id}
&client_secret=dev-secret
```

**Pre-configured clients:**

| Client ID | Scopes | Use Case |
|-----------|--------|----------|
| `agent-full` | All scopes across all services | Full agent testing |
| `agent-csr` | Service subset (read + limited write) | CSR-role testing |
| `agent-readonly` | Read-only scopes | Read-only agent testing |

**Example:**

```bash
curl -X POST http://localhost:3000/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=agent-full \
  -d client_secret=dev-secret
# Returns: { "access_token": "eyJ...", "token_type": "bearer", "expires_in": 3600 }
```

### Self-Signed JWT Bypass (Dev Only)

Any JWT signed with HS256 / secret `dev-secret` is accepted by all services. Include `sub` and `scope` claims:

```json
{ "sub": "dev-agent", "scope": "ams:clients:read ams:policies:read", "exp": 1893456000 }
```

### Using the Token

Include the bearer token in every request:

```
Authorization: Bearer <access_token>
```

Scope enforcement is real — missing scopes return 403.

### Scopes by Service

| Service | Scopes |
|---------|--------|
| AMS | `ams:clients:read`, `ams:clients:write`, `ams:policies:read`, `ams:policies:endorsements`, `ams:accounting:read`, `ams:tasks:write` |
| Rater | `rater:quotes:create`, `rater:quotes:read`, `rater:quotes:bind`, `rater:carriers:read` |
| Comm Hub | `comm:messages:read`, `comm:messages:send`, `comm:calls:read`, `comm:webhooks:manage` |
| CRM | `crm:leads:read`, `crm:leads:write`, `crm:campaigns:enroll`, `crm:analytics:read` |
| ECM | `ecm:documents:read`, `ecm:documents:upload`, `ecm:envelopes:create`, `ecm:assets:read`, `ecm:acord:read` |
| Claims | `claims:read`, `claims:write`, `claims:assign`, `claims:documents` |

---

## 2. Common Patterns

### Cursor-Based Pagination

All list endpoints use cursor-based pagination. Pass `limit` (1–100, default 25) and an opaque `cursor` value from the previous page.

**Response fields:**
- `has_more` (boolean) — Whether additional pages exist
- `next_cursor` or `cursor` (string, nullable) — Pass as the `cursor` parameter for the next page; null when `has_more` is false

### Error Response Schema

All error responses use a common envelope:

```json
{
  "error_code": "VALIDATION_ERROR",
  "message": "One or more fields failed validation.",
  "correlation_id": "corr-12345678-abcd-efgh-ijkl-mnopqrstuvwx",
  "details": [
    {
      "field": "effective_date",
      "message": "Effective date must be in the future.",
      "code": "out_of_range"
    }
  ]
}
```

**Standard error codes:** `VALIDATION_ERROR`, `AUTH_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`

### Correlation IDs

Every request is assigned a unique correlation ID (returned in error responses and `5xx` responses). Include this when contacting support.

---

## 3. Agency Management System (AMS)

**Base URL:** `http://localhost:3000`

The system of record for client, policy, endorsement, commission, and task data.

### 3.1 `GET /clients` — List Clients

Retrieve a paginated list of client records with optional filters. Results ordered by `last_name` ascending.

**Scope:** `ams:clients:read`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter: `active`, `inactive`, `prospect` |
| `last_name` | string | Case-insensitive prefix search |
| `household_id` | uuid | Filter by household |
| `limit` | integer | 1–100 (default 25) |
| `cursor` | string | Pagination cursor |

**Response (200):**

```json
{
  "data": [
    {
      "id": "c9a1f2e3-4b56-7d89-0abc-def123456789",
      "first_name": "Sarah",
      "last_name": "Chen",
      "dob": "1987-04-15",
      "email": "sarah.chen@example.com",
      "phone": "+15035551234",
      "address": {
        "street": "742 Evergreen Terrace, Apt 2B",
        "city": "Springfield",
        "state": "IL",
        "zip": "62704"
      },
      "driver_license_number": "D400-1234-5678",
      "occupation": "Software Engineer",
      "marital_status": "married",
      "household_id": "hh-00a1b2c3-d4e5-6789-abcd-ef0123456789",
      "preferred_contact_method": "email",
      "preferred_contact_time": "weekday mornings before 10 AM PST",
      "status": "active",
      "created_at": "2023-06-12T14:23:45Z",
      "updated_at": "2025-11-03T09:17:22Z"
    }
  ],
  "pagination": {
    "limit": 25,
    "cursor": null,
    "next_cursor": "eyJpZCI6ImQ4YjJlM2Y0In0=",
    "has_more": true
  }
}
```

**Error Codes:** 400, 401, 403, 500

### 3.2 `GET /clients/{id}/policies` — List Client Policies

Retrieve all policies for a client, ordered by `effective_date` descending.

**Scope:** `ams:policies:read`

**Path Parameters:** `id` (uuid) — Client ID

**Query Parameters:** `policy_type`, `status`, `limit`, `cursor`

**Response (200):**

```json
{
  "data": [
    {
      "policy_id": "POL-PA-2024-001847",
      "client_id": "c9a1f2e3-4b56-7d89-0abc-def123456789",
      "carrier_code": "SMIT",
      "policy_type": "personal_auto",
      "effective_date": "2024-07-01",
      "expiration_date": "2025-07-01",
      "premium_current": 1842.00,
      "premium_prior": 1764.00,
      "status": "active",
      "coverages": [
        { "type": "bodily_injury", "limit": 250000.00, "deductible": 0 },
        { "type": "property_damage", "limit": 100000.00, "deductible": 0 },
        { "type": "collision", "limit": 0, "deductible": 500.00 },
        { "type": "comprehensive", "limit": 0, "deductible": 250.00 }
      ],
      "created_at": "2024-06-15T10:30:00Z",
      "updated_at": "2025-01-08T16:45:12Z"
    }
  ],
  "pagination": { "limit": 25, "has_more": false }
}
```

**Error Codes:** 400, 401, 403, 404, 500

### 3.3 `POST /policies/{id}/endorsements` — Request Policy Endorsement

Submit a mid-term change request. Policy must be `active` or `pending`.

**Scope:** `ams:policies:endorsements`

**Path Parameters:** `id` (string) — Policy ID (e.g., `POL-PA-2024-001847`)

**Request Body:**

```json
{
  "effective_date": "2025-03-15",
  "change_type": "add_vehicle",
  "changes": {
    "vehicle": {
      "year": 2024,
      "make": "Toyota",
      "model": "RAV4",
      "vin": "JTMRWRFV0RD123456"
    },
    "usage": "commute",
    "annual_mileage": 12000
  },
  "notes": "Client purchased new vehicle; replacing 2018 Civic on the policy."
}
```

**Change Types:** `add_coverage`, `remove_coverage`, `modify_coverage`, `add_vehicle`, `remove_vehicle`, `add_driver`, `remove_driver`, `address_change`, `other`

**Response (201):** Returns the created `Endorsement` object with `endorsement_id`, `premium_delta`, and `status: "pending_review"`.

**Error Codes:** 400, 401, 403, 404, 409 (policy cancelled/expired), 500

### 3.4 `GET /accounting/commissions` — Fetch Commission Data

Paginated commission records with optional filters.

**Scope:** `ams:accounting:read`

**Query Parameters:** `carrier_code`, `transaction_type`, `status`, `effective_date_from`, `effective_date_to`, `producer_id`, `limit`, `cursor`

**Response (200):**

```json
{
  "data": [
    {
      "commission_id": "COM-2025-018743",
      "policy_id": "POL-PA-2024-001847",
      "carrier_code": "SMIT",
      "transaction_type": "new_business",
      "gross_amount": 276.30,
      "net_amount": 193.41,
      "commission_rate": 0.15,
      "effective_date": "2024-07-01",
      "payment_date": "2024-08-15",
      "status": "paid",
      "producer_id": "agt-44a1b2c3-d4e5-6789-abcd-ef0123456789",
      "created_at": "2024-07-02T08:00:00Z"
    }
  ],
  "pagination": { "limit": 25, "has_more": false }
}
```

**Error Codes:** 400, 401, 403, 500

### 3.5 `PATCH /tasks/{id}` — Update a Task

Partially update an internal workflow task (renewal follow-up, remarketing, etc.).

**Scope:** `ams:tasks:write`

**Path Parameters:** `id` (uuid) — Task ID

**Request Body:**

```json
{
  "status": "in_progress",
  "priority": "high",
  "assigned_to": "usr-55a1b2c3-d4e5-6789-abcd-ef0123456789",
  "due_date": "2025-06-10"
}
```

**Updatable Fields:** `status` (open/in_progress/blocked/completed/cancelled), `priority` (low/medium/high/urgent), `assigned_to`, `due_date`, `description`

**Response (200):** Returns the full updated `Task` object.

**Error Codes:** 400, 401, 403, 404, 409, 500

---

## 4. Comparative Rater

**Base URL:** `http://localhost:3001`

Multi-carrier quoting engine for real-time premium comparison, binding, and carrier appetite queries.

### 4.1 `POST /quotes/request` — Submit Multi-Carrier Quote

Accepts client demographics and risk data, fans the request out to eligible carriers.

**Scope:** `rater:quotes:create`

**Request Body:**

```json
{
  "policy_type": "personal_auto",
  "effective_date": "2026-04-01",
  "client": {
    "first_name": "Margaret",
    "last_name": "Thornton",
    "date_of_birth": "1984-06-15",
    "address": { "street": "742 Evergreen Terrace", "city": "Springfield", "state": "IL", "zip": "62704" },
    "email": "m.thornton@example.com",
    "phone": "+12175551234"
  },
  "drivers": [
    {
      "first_name": "Margaret",
      "last_name": "Thornton",
      "date_of_birth": "1984-06-15",
      "license_number": "T550-1234-5678",
      "license_state": "IL",
      "gender": "female",
      "marital_status": "married",
      "years_licensed": 18,
      "violations": []
    }
  ],
  "vehicles": [
    {
      "vin": "1HGCV1F34PA012345",
      "year": 2025,
      "make": "Honda",
      "model": "Accord",
      "trim": "EX-L",
      "usage": "commute",
      "annual_miles": 12000,
      "ownership": "owned",
      "garaging_zip": "62704"
    }
  ],
  "requested_coverages": [
    { "coverage_type": "bodily_injury", "per_person_limit": 250000, "per_occurrence_limit": 500000 },
    { "coverage_type": "property_damage", "per_occurrence_limit": 100000 },
    { "coverage_type": "collision", "deductible": 500 },
    { "coverage_type": "comprehensive", "deductible": 250 }
  ]
}
```

**Response (202):**

```json
{
  "request_id": "qr_8f3a9b2c",
  "status": "pending",
  "created_at": "2026-03-10T14:32:00Z",
  "estimated_completion": "2026-03-10T14:34:00Z",
  "carriers_queried": 5
}
```

The `Location` header contains the URL to poll for results.

**Error Codes:** 400, 401, 403, 500

### 4.2 `GET /quotes/{request_id}/results` — Poll for Quote Results

Returns carrier responses for a previously submitted quote request.

**Scope:** `rater:quotes:read`

**Status Values:**
- `pending` — Waiting for carrier responses
- `partial` — Some carriers responded
- `completed` — All carriers responded
- `expired` — Request older than 30 days

**Response (200):**

```json
{
  "request_id": "qr_8f3a9b2c",
  "status": "completed",
  "policy_type": "personal_auto",
  "effective_date": "2026-04-01",
  "carriers": [
    {
      "carrier_code": "CSTL",
      "carrier_name": "Coastal Star Insurance",
      "quote_id": "qt_a1b2c3d4",
      "status": "quoted",
      "premium_annual": 1842.00,
      "premium_monthly": 159.50,
      "coverages": [ ... ],
      "valid_until": "2026-04-10T23:59:59Z"
    },
    {
      "carrier_code": "HRTF",
      "carrier_name": "The Hartford",
      "quote_id": null,
      "status": "declined",
      "premium_annual": null,
      "decline_reason": "Driver 2 has a moving violation within the last 36 months."
    }
  ]
}
```

**Error Codes:** 401, 403, 404, 500

### 4.3 `POST /quotes/{quote_id}/bind` — Bind a Quoted Policy

Finalizes a policy with the selected carrier. Idempotent on `quote_id`.

**Scope:** `rater:quotes:bind`

**Request Body:**

```json
{
  "quote_id": "qt_a1b2c3d4",
  "payment_method": "eft",
  "payment_plan": "monthly",
  "producer_id": "prod_9283",
  "producer_license_number": "IL-1234567",
  "insured_signature_collected": true,
  "insured_signature_date": "2026-03-12",
  "down_payment_collected": true,
  "down_payment_amount": 159.50
}
```

**Response (201):**

```json
{
  "policy_id": "POL-CSTL-2026-0041827",
  "quote_id": "qt_a1b2c3d4",
  "carrier_code": "CSTL",
  "carrier_name": "Coastal Star Insurance",
  "effective_date": "2026-04-01",
  "expiration_date": "2027-04-01",
  "premium_annual": 1842.00,
  "bind_status": "bound",
  "bound_at": "2026-03-12T10:45:22Z",
  "policy_documents_url": "http://localhost:3001/policies/POL-CSTL-2026-0041827/documents"
}
```

**Error Codes:** 400, 401, 403, 404, 409 (already bound), 500

### 4.4 `GET /carriers/appetite` — Query Carrier Appetite

Returns carriers and their willingness to write specific risk types.

**Scope:** `rater:carriers:read`

**Query Parameters:** `state`, `policy_type`, `risk_category` (preferred/standard/non_standard), `limit`, `cursor`

**Response (200):**

```json
{
  "data": [
    {
      "carrier_code": "CSTL",
      "carrier_name": "Coastal Star Insurance",
      "states": ["IL", "IN", "WI", "OH", "MI"],
      "policy_types": ["personal_auto", "homeowners", "umbrella"],
      "risk_categories": ["preferred", "standard", "non_standard"],
      "appetite_level": "high",
      "min_driver_age": 16,
      "max_vehicles": 8,
      "accepts_sr22": true
    }
  ],
  "has_more": true,
  "next_cursor": "eyJjIjoiTlROVyJ9",
  "total_count": 5
}
```

**Appetite Levels:** `high` (actively marketing), `medium` (selective), `low` (limited circumstances)

**Error Codes:** 400, 401, 403, 500

---

## 5. Communication Hub (MCP)

The Communication Hub is exposed as an **MCP (Model Context Protocol) server** rather than a REST API. AI agents interact with it through tool calls.

### Transport Configuration

| Transport | Use Case | Configuration |
|-----------|----------|---------------|
| **stdio** | Local development | Start the MCP server process directly; communicate via stdin/stdout |
| **SSE** | Remote / Kubernetes | Connect to `http://comm-mcp:3001/sse` for Server-Sent Events transport |

### 5.1 Tool: `get_inbox`

Retrieve messages from the inbox with optional filters.

**Input Schema:**

```json
{
  "channel": "email | sms | phone | whatsapp",
  "direction": "inbound | outbound",
  "read": false,
  "client_id": "cli_3e4f5a6b-7c8d-9e0f-1a2b-3c4d5e6f7a8b",
  "since": "2026-02-17T00:00:00Z",
  "until": "2026-02-18T00:00:00Z",
  "limit": 25,
  "cursor": "eyJpZCI6Im1zZ18xYTJiM2M0ZCJ9"
}
```

All parameters are optional.

**Output:** Paginated list of messages, each containing:
- `message_id`, `client_id`, `direction`, `channel`
- `subject` (email only, null for other channels)
- `body`, `from`, `to`, `timestamp`, `read`
- `attachments[]` — file_name, content_type, size_bytes, url (pre-signed, valid 1 hour)

### 5.2 Tool: `send_message`

Send an outbound message via email, SMS, or WhatsApp.

**Input Schema:**

```json
{
  "to": "+15559876543",
  "channel": "sms",
  "subject": "Your policy renewal confirmation",
  "body": "Hi James, your life insurance application has been approved!",
  "template_id": "tmpl_approval_notification",
  "attachments": [
    {
      "file_name": "policy_summary.pdf",
      "content_type": "application/pdf",
      "content_base64": "<base64-encoded content>"
    }
  ]
}
```

Required: `to`, `channel`, `body`. The `subject` field is required for email, ignored for other channels. Attachments supported for email and WhatsApp only (max 10 MB per file).

**Output:** `message_id`, `status` (queued), `channel`

### 5.3 Tool: `get_transcript`

Fetch a call transcript with sentiment analysis and extracted topics.

**Input Schema:**

```json
{
  "call_id": "call_d4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a"
}
```

**Output:**

```json
{
  "call_id": "call_d4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a",
  "client_id": "cli_3e4f5a6b-7c8d-9e0f-1a2b-3c4d5e6f7a8b",
  "agent_name": "Sarah Mitchell",
  "duration_seconds": 487,
  "transcript_text": "[00:00] Agent: Thank you for calling Evergreen Insurance...\n[00:05] Client: Hi Sarah, I'm calling because we just had a baby...",
  "sentiment": "positive",
  "topics": ["life event - new baby", "coverage increase", "term life policy"],
  "timestamp": "2026-02-16T11:22:33Z"
}
```

Transcript text is formatted with `[MM:SS]` timestamps and speaker labels for LLM consumption.

### 5.4 Tool: `manage_webhook`

Subscribe to or unsubscribe from real-time communication events.

**Input Schema (subscribe):**

```json
{
  "action": "subscribe",
  "url": "http://localhost:3002/hooks/evergreen",
  "events": ["message.received", "message.delivered", "message.failed", "call.completed", "call.missed"]
}
```

**Event Types:** `message.received`, `message.delivered`, `message.failed`, `call.completed`, `call.missed`

**Output (subscribe):**

```json
{
  "webhook_id": "whk_a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "url": "http://localhost:3002/hooks/evergreen",
  "events": ["message.received", "message.delivered", "message.failed", "call.completed", "call.missed"],
  "secret": "whsec_k7m9p2r4t6v8x0z1b3d5f7h9j1l3n5q",
  "active": true,
  "created_at": "2026-02-18T10:15:30Z"
}
```

Webhook payloads are signed with HMAC-SHA256 using the subscription `secret`. The signature is sent in the `X-Evergreen-Signature` header. Delivery retries with exponential back-off up to 5 times.

---

## 6. CRM & Marketing Automation

**Base URL:** `http://localhost:3002`

Manages the sales funnel, lead lifecycle, campaign enrollment, and retention risk analytics.

### 6.1 `GET /leads/scoring` — Get Scored Leads

Returns leads ranked by engagement score (descending).

**Scope:** `crm:leads:read`

**Query Parameters:** `min_score` (0–100, default 0), `status`, `source`, `assigned_producer`, `limit`, `cursor`

**Lead Statuses:** `new`, `contacted`, `qualified`, `proposal_sent`, `closed_won`, `closed_lost`
**Lead Sources:** `referral`, `web`, `cold_call`, `partner`, `event`

**Response (200):**

```json
{
  "data": [
    {
      "lead_id": "lead_8f3a12c4",
      "client_id": "cli_90210abc",
      "first_name": "Margaret",
      "last_name": "Thornton",
      "email": "m.thornton@example.com",
      "phone": "+1-503-555-0147",
      "source": "web",
      "status": "qualified",
      "score": 87,
      "assigned_producer": "prod_44e1bc90",
      "tags": ["high-value", "auto-and-home"],
      "last_activity_date": "2026-02-15",
      "created_at": "2025-11-03T09:22:00Z",
      "updated_at": "2026-02-15T14:08:33Z"
    }
  ],
  "pagination": { "limit": 25, "has_more": true }
}
```

**Error Codes:** 400, 401, 403, 500

### 6.2 `PATCH /leads/{id}` — Update Lead Status

Partial update of lead status, score, tags, notes, or assigned producer.

**Scope:** `crm:leads:write`

**Request Body:**

```json
{
  "status": "proposal_sent",
  "score": 91,
  "tags": ["high-value", "auto-and-home", "proposal-q1-2026"],
  "notes": "Sent bundled auto + home proposal. Follow up by 2026-02-25.",
  "assigned_producer": "prod_44e1bc90"
}
```

**Response (200):** Returns the full updated `Lead` object.

**Error Codes:** 400, 401, 403, 404, 409, 500

### 6.3 `POST /campaigns/{id}/enroll` — Enroll Client in Campaign

Add a client to a nurture sequence or campaign.

**Scope:** `crm:campaigns:enroll`

**Request Body:**

```json
{
  "client_id": "cli_90210abc",
  "trigger_reason": "Client expressed interest in converting term to whole life during annual review.",
  "metadata": {
    "current_policy": "pol_term20_8821",
    "coverage_amount": 500000,
    "term_remaining_years": 12
  }
}
```

**Campaign Types:** `nurture`, `retention`, `cross_sell`, `welcome`

**Response (201):**

```json
{
  "enrollment_id": "enr_a7f29c01",
  "campaign_id": "camp_life_pivot_2026",
  "client_id": "cli_90210abc",
  "enrolled_at": "2026-02-18T10:30:00Z",
  "sequence_step": 1
}
```

**Error Codes:** 400, 401, 403, 404, 409 (already enrolled), 500

### 6.4 `GET /analytics/retention-risk` — Get Retention Risk Clients

Retrieve at-risk clients with churn risk scores and recommended actions.

**Scope:** `crm:analytics:read`

**Query Parameters:** `min_risk_score` (0–100, default 50), `assigned_producer`, `limit`, `cursor`

**Response (200):**

```json
{
  "data": [
    {
      "client_id": "cli_3321feed",
      "client_name": "Sandra Kowalski",
      "risk_score": 82,
      "factors": {
        "rate_increase_pct": 14.5,
        "months_since_contact": 9,
        "email_open_rate": 0.04,
        "policies_count": 1
      },
      "recommended_action": "Schedule personal outreach call. Single-policy client with significant rate increase and no recent engagement. Offer multi-policy discount."
    }
  ],
  "pagination": { "limit": 25, "has_more": true }
}
```

**Error Codes:** 400, 401, 403, 500

---

## 7. Document & Content Management (ECM)

**Base URL:** `http://localhost:3003`

Document storage, e-signature envelope orchestration, compliance auditing, and marketing asset delivery.

### 7.1 `POST /documents/upload` — Upload a Document

Store a new scan, signed form, or policy document. Files are virus-scanned asynchronously.

**Scope:** `ecm:documents:upload`
**Content-Type:** `multipart/form-data`

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | Yes | The document file (PDF, JPEG, PNG, TIFF) |
| `client_id` | uuid | Yes | Client who owns this document |
| `document_type` | string | Yes | One of: `signed_application`, `id_verification`, `coi`, `dec_page`, `endorsement`, `cancellation_notice`, `welcome_kit` |
| `description` | string | No | Description (max 500 chars) |
| `tags` | string[] | No | Freeform tags |

**Response (201):**

```json
{
  "document_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "filename": "ho_application_signed.pdf",
  "mime_type": "application/pdf",
  "upload_date": "2025-07-20T11:05:33Z",
  "status": "uploaded"
}
```

**Error Codes:** 400, 401, 403, 409, 500

### 7.2 `GET /documents/{client_id}/audit` — Audit Client Documents

Returns all documents for a client with a compliance verdict. Missing or expired documents are flagged.

**Scope:** `ecm:documents:read`

**Response (200):**

```json
{
  "client_id": "b2f7c8a1-49d3-4e6a-8c15-7a3d9e2b1f04",
  "documents": [
    {
      "document_id": "d4e5f6a7-1234-5678-9abc-def012345678",
      "document_type": "signed_application",
      "filename": "signed_application_2025-06-15.pdf",
      "status": "signed",
      "signer_name": "Amara Osei",
      "signed_date": "2025-06-16T09:10:22Z"
    }
  ],
  "compliance_status": "missing_documents",
  "missing_documents": [
    {
      "document_type": "id_verification",
      "required_by": "2025-08-01T23:59:59Z",
      "reason": "State law requires a government-issued photo ID on file before binding coverage."
    }
  ]
}
```

**Compliance Statuses:** `compliant`, `missing_documents`, `expired_documents`

**Error Codes:** 400, 401, 403, 404, 500

### 7.3 `POST /envelopes/create` — Create Signature Envelope

Generate a DocuSign-style e-signature request. Each signer receives an email with a secure link. Envelopes expire after 30 days.

**Scope:** `ecm:envelopes:create`

**Request Body:**

```json
{
  "client_id": "b2f7c8a1-49d3-4e6a-8c15-7a3d9e2b1f04",
  "document_ids": ["d4e5f6a7-1234-5678-9abc-def012345678"],
  "signers": [
    { "name": "Amara Osei", "email": "amara.osei@example.com", "role": "policyholder" },
    { "name": "David Chen", "email": "david.chen@evergreen-ins.com", "role": "agent" }
  ],
  "message": "Please review and sign your homeowners policy application.",
  "redirect_url": "http://localhost:3003/signing-complete"
}
```

**Response (201):** Returns the created `Envelope` object with `envelope_id`, signer statuses, and `expiration_date`.

**Envelope Statuses:** `created`, `sent`, `viewed`, `signed`, `completed`, `declined`, `expired`

**Error Codes:** 400, 401, 403, 404, 409, 500

### 7.4 `GET /assets/marketing` — List Marketing Assets

Retrieve approved marketing collateral (PDFs, Welcome Kits, flyers). Sorted by `published_date` descending.

**Scope:** `ecm:assets:read`

**Query Parameters:** `category` (welcome_kit/flyer/comparison_template/social_media), `limit`, `cursor`

**Response (200):**

```json
{
  "data": [
    {
      "asset_id": "fa12bc34-de56-7890-ab12-cd34ef567890",
      "name": "Homeowners Welcome Kit - 2025 Edition",
      "description": "Comprehensive welcome package including coverage summary, claims process overview, and emergency contacts.",
      "category": "welcome_kit",
      "mime_type": "application/pdf",
      "url": "http://localhost:3003/assets/welcome-kit-homeowners-2025-v3.pdf",
      "version": "3.1.0",
      "published_date": "2025-04-01T00:00:00Z"
    }
  ],
  "pagination": { "has_more": true }
}
```

**Error Codes:** 400, 401, 403, 500

### 7.5 `GET /documents/acord/{form_type}` — Generate ACORD PDF Form

Generate an ACORD-style PDF form populated with data from the AMS and Claims services.

**Scope:** `ecm:acord:read`

**Path Parameters:** `form_type` — `90` (Personal Auto Application), `80` (Homeowners Application), or `35` (Loss Notice)

**Query Parameters:**
- `policy_id` — Required for forms 90 and 80. Must match the expected policy type.
- `claim_id` — Required for form 35. The claim's policy and client data are fetched automatically.

**Response (200):** Binary PDF with `Content-Type: application/pdf`

**Example:**

```bash
# Generate Personal Auto Application
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3003/documents/acord/90?policy_id=POL-PA-2025-001847"

# Generate Homeowners Application
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3003/documents/acord/80?policy_id=POL-HO-2025-000312"

# Generate Loss Notice
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3003/documents/acord/35?claim_id=CLM-2025-000001"
```

**Error Codes:** 400 (invalid form_type, missing params, wrong policy type), 401, 403, 404 (policy/claim not found), 500

---

## 8. Claims Service

**Base URL:** `http://localhost:3007`

Full claims lifecycle management: FNOL intake, adjuster assignment, investigation, reserve tracking, settlement/denial, document management, and activity timelines.

**Status Lifecycle:** `reported` → `assigned` → `investigating` → `reserved` → `settled` | `denied`

### 8.1 `POST /claims/fnol` — File First Notice of Loss

Create a new claim from initial loss report.

**Scope:** `claims:write`

**Request Body:**

```json
{
  "policy_id": "POL-PA-2025-001847",
  "client_id": "CLI-001",
  "claim_type": "auto_collision",
  "loss_date": "2026-01-15",
  "loss_description": "Rear-ended at intersection.",
  "loss_location": "Main St & 5th Ave, Chicago, IL"
}
```

**Claim Types:** `auto_collision`, `auto_comprehensive`, `property_damage`, `theft`, `liability`, `medical`, `fire`, `water`, `weather`

**Response (201):** Returns the created `Claim` object with `claim_id`, `status: "reported"`, and `reported_date`.

**Error Codes:** 400 (validation — missing fields, future loss_date, invalid type), 401, 403

### 8.2 `GET /claims` — List Claims

Paginated claim listing with filters, ordered by `created_at` descending.

**Scope:** `claims:read`

**Query Parameters:** `client_id`, `policy_id`, `status`, `claim_type`, `date_from`, `date_to` (loss_date range), `limit`, `cursor`

**Response (200):**

```json
{
  "data": [
    {
      "claim_id": "CLM-2026-000001",
      "policy_id": "POL-PA-2025-001847",
      "client_id": "CLI-001",
      "claim_type": "auto_collision",
      "status": "investigating",
      "loss_date": "2026-01-15",
      "reported_date": "2026-01-15",
      "loss_description": "Rear-ended at intersection.",
      "reserve_amount": 8500.00,
      "adjuster_id": "ADJ-001",
      "created_at": "2026-01-15T14:30:00Z",
      "updated_at": "2026-02-01T10:00:00Z"
    }
  ],
  "pagination": { "limit": 25, "has_more": false }
}
```

### 8.3 `GET /claims/{claim_id}` — Claim Detail

Returns full claim with adjuster info, timeline, and documents.

**Scope:** `claims:read`

**Error Codes:** 404

### 8.4 `PATCH /claims/{claim_id}` — Update Claim

Update status, reserves, settlement, or notes. Status transitions are validated (forward-only).

**Scope:** `claims:write`

**Request Body:**

```json
{
  "status": "reserved",
  "reserve_amount": 15000.00,
  "notes": "Contractor estimate received."
}
```

**Error Codes:** 400 (invalid transition, negative amounts), 404

### 8.5 `POST /claims/{claim_id}/assign` — Assign Adjuster

Assign an adjuster to a claim. Validates adjuster is active and below capacity.

**Scope:** `claims:assign`

**Request Body:** `{ "adjuster_id": "ADJ-001" }`

**Error Codes:** 400 (inactive adjuster, capacity exceeded), 404

### 8.6 `GET /claims/{claim_id}/timeline` — Claim Timeline

Chronological activity log (status changes, assignments, documents, reserve changes).

**Scope:** `claims:read`

### 8.7 `POST /claims/{claim_id}/documents` — Upload Document

Upload claim document metadata (police reports, photos, estimates, etc.).

**Scope:** `claims:documents`

**Document Types:** `police_report`, `medical_records`, `photos`, `estimate`, `correspondence`, `other`

### 8.8 `GET /adjusters` — List Adjusters

Returns adjusters with open claim counts, filterable by `specialty` and `active` status.

**Scope:** `claims:read`

---

## 9. Mock Carrier Portals

Two simulated carrier portals provide web interfaces and backing APIs for underwriting and quoting workflows.

### 8.1 Summit Fire & Casualty Portal (`carrier-summit`)

Simulates the Summit Fire & Casualty carrier portal.

#### `GET /summit/quotes/{quote_id}` — Quote Lookup

Retrieve details of a submitted quote from the Summit Fire & Casualty underwriting system.

**Response:**

```json
{
  "quote_id": "qt_e5f6g7h8",
  "carrier": "Summit Fire & Casualty",
  "status": "quoted",
  "premium_annual": 2104.00,
  "underwriting_tier": "standard",
  "effective_date": "2026-04-01",
  "valid_until": "2026-04-10T23:59:59Z"
}
```

#### `POST /summit/underwriting/{quote_id}/decision` — Underwriting Decision Simulation

Submit or retrieve an underwriting decision for a quote.

**Response:**

```json
{
  "quote_id": "qt_e5f6g7h8",
  "decision": "approved",
  "conditions": ["Annual mileage verification required within 30 days"],
  "decided_at": "2026-03-11T09:00:00Z"
}
```

**Decision Values:** `approved`, `approved_with_conditions`, `referred`, `declined`

#### `GET /summit/policies/{policy_id}/documents` — Policy Document Download

Download policy documents (dec page, ID cards, binder).

### 8.2 Coastal Star Insurance Portal (`carrier-coastal`)

Simulates the Coastal Star Insurance carrier portal.

#### `POST /coastal/quotes/submit` — Quote Submission

Submit risk data for a Coastal Star Insurance-specific quote.

**Request:** Client demographics, driver/vehicle info, coverage requests.

**Response:**

```json
{
  "quote_id": "qt_a1b2c3d4",
  "carrier": "Coastal Star Insurance",
  "status": "quoted",
  "premium_annual": 1842.00,
  "premium_monthly": 159.50,
  "created_at": "2026-03-10T14:33:00Z"
}
```

#### `GET /coastal/quotes/{quote_id}/risk-assessment` — Risk Assessment Display

View the risk assessment factors that influenced the quote.

**Response:**

```json
{
  "quote_id": "qt_a1b2c3d4",
  "risk_tier": "preferred",
  "factors": [
    { "factor": "driving_record", "impact": "favorable", "detail": "No violations in 5 years" },
    { "factor": "credit_score", "impact": "favorable", "detail": "Tier 1 credit" },
    { "factor": "vehicle_safety", "impact": "neutral", "detail": "Standard safety rating" }
  ]
}
```

#### `POST /coastal/quotes/{quote_id}/bind` — Bind Confirmation

Confirm binding of a Coastal Star Insurance quote. Returns policy number and confirmation details.

**Note:** Both carrier portals simulate realistic response delays (configurable latency) to train agents to handle asynchronous carrier workflows.

---

## 10. Webhook Events

### Communication Hub Events

Events delivered to subscribed webhook endpoints. Each payload is wrapped in an envelope with `event_id` (idempotency key), `event_type`, `timestamp`, and `data`.

#### `message.received`

Fired when an inbound message arrives.

```json
{
  "event_id": "evt_11111111-2222-3333-4444-555555555555",
  "event_type": "message.received",
  "timestamp": "2026-02-18T13:45:22Z",
  "data": {
    "message_id": "msg_aaaa1111-bbbb-cccc-dddd-eeee2222ffff",
    "client_id": "cli_3e4f5a6b-7c8d-9e0f-1a2b-3c4d5e6f7a8b",
    "direction": "inbound",
    "channel": "email",
    "subject": "Billing question - policy AG-2025-98712",
    "body": "Hello, I was charged twice for my February premium...",
    "from": "robert.alvarez@example.com",
    "to": "billing@evergreen-ins.com",
    "read": false,
    "attachments": []
  }
}
```

#### `message.delivered`

Fired when an outbound message is confirmed delivered.

```json
{
  "event_id": "evt_22222222-3333-4444-5555-666666666666",
  "event_type": "message.delivered",
  "timestamp": "2026-02-18T13:46:05Z",
  "data": {
    "message_id": "msg_b4c5d6e7-f8a9-0b1c-2d3e-4f5a6b7c8d9e",
    "channel": "sms",
    "status": "delivered",
    "delivered_at": "2026-02-18T13:46:05Z"
  }
}
```

#### `message.failed`

Fired when an outbound message fails to deliver.

```json
{
  "event_id": "evt_33333333-4444-5555-6666-777777777777",
  "event_type": "message.failed",
  "timestamp": "2026-02-18T14:01:33Z",
  "data": {
    "message_id": "msg_cccc3333-dddd-eeee-ffff-aaaa4444bbbb",
    "channel": "email",
    "status": "bounced",
    "failure_reason": "Recipient mailbox full (552 5.2.2)",
    "failed_at": "2026-02-18T14:01:33Z"
  }
}
```

#### `call.completed`

Fired when a recorded call ends and the transcript is ready. `data` contains the full `CallTranscript` object.

#### `call.missed`

Fired when an incoming call is missed or goes to voicemail.

```json
{
  "event_id": "evt_55555555-6666-7777-8888-999999999999",
  "event_type": "call.missed",
  "timestamp": "2026-02-18T08:15:00Z",
  "data": {
    "call_id": "call_f6a7b8c9-d0e1-2f3a-4b5c-6d7e8f9a0b1c",
    "client_id": "cli_9a0b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d",
    "caller_number": "+15553216789",
    "called_number": "+18005550199",
    "ring_duration_seconds": 22,
    "voicemail": true,
    "voicemail_transcript": "Hi, this is Patricia Holmes, policy number HO-2024-55123..."
  }
}
```

### CRM Events

#### `lead.status_changed`

```json
{
  "event_id": "evt_d3c1aee0-4f5a-4b3e-9a12-1c2d3e4f5a6b",
  "event_type": "lead.status_changed",
  "occurred_at": "2026-02-18T10:14:57Z",
  "data": {
    "lead_id": "lead_8f3a12c4",
    "previous_status": "qualified",
    "new_status": "proposal_sent",
    "changed_by": "prod_44e1bc90"
  }
}
```

#### `lead.score_updated`

```json
{
  "event_id": "evt_b7e91024-8823-4cc1-a0f3-99ab12cd34ef",
  "event_type": "lead.score_updated",
  "occurred_at": "2026-02-12T11:30:00Z",
  "data": {
    "lead_id": "lead_c29e44d1",
    "previous_score": 62,
    "new_score": 74,
    "reason": "Opened 3 emails, clicked quote link, visited pricing page."
  }
}
```

#### `campaign.enrollment_completed`

```json
{
  "event_id": "evt_19fa3b0c-67d2-4e9a-b1c4-abcdef012345",
  "event_type": "campaign.enrollment_completed",
  "occurred_at": "2026-03-20T08:00:00Z",
  "data": {
    "enrollment_id": "enr_a7f29c01",
    "campaign_id": "camp_life_pivot_2026",
    "client_id": "cli_90210abc",
    "outcome": "converted",
    "completed_at": "2026-03-20T08:00:00Z"
  }
}
```

---

## 11. Integration Flows

Step-by-step API call sequences for each training scenario.

### 10.1 The Pivot Agent (Cross-Sell)

A client calls about a claim; the agent detects a cross-sell opportunity.

```
1. Comm Hub   → get_transcript(call_id)
                 Extract topics and sentiment from the call transcript.
                 Identify life event (e.g., "new baby") suggesting coverage gap.

2. AMS        → GET /clients?last_name={name}
                 Look up the client record.

3. AMS        → GET /clients/{id}/policies
                 Review existing coverages. Confirm no life insurance policy.

4. CRM        → POST /campaigns/{id}/enroll
                 Enroll client in the "Life Insurance Pivot" nurture campaign.

5. Comm Hub   → send_message(channel=email)
                 Send personalized cross-sell email with coverage options.

6. CRM        → PATCH /leads/{id}
                 Update lead status to "contacted" and add tags.
```

### 10.2 The Coverage Verification Agent

Agent checks whether a client's coverages meet state minimums and lender requirements.

```
1. ECM        → GET /documents/{client_id}/audit
                 Retrieve all client documents and compliance status.

2. AMS        → GET /clients/{id}/policies
                 Get the client's current policy details and coverage limits.

3. AMS        → GET /clients/{id}/policies?policy_type=personal_auto
                 Check auto liability limits against state minimums.

4. Rater      → GET /carriers/appetite?state={state}&policy_type=homeowners
                 Identify carriers willing to write additional coverage if needed.

5. Rater      → POST /quotes/request
                 Submit quote request for increased coverage if below minimums.

6. Rater      → GET /quotes/{request_id}/results
                 Poll for carrier responses (repeat until completed).
```

### 10.3 The Retention Agent

Agent detects at-risk clients and proactively re-shops to prevent churn.

```
1. CRM        → GET /analytics/retention-risk?min_risk_score=70
                 Get high-risk clients.

2. AMS        → GET /clients/{id}/policies
                 For each at-risk client, retrieve current policy details.
                 Calculate premium increase percentage (premium_current vs premium_prior).

3. Rater      → POST /quotes/request
                 Submit client data for multi-carrier re-quote.

4. Rater      → GET /quotes/{request_id}/results
                 Poll until completed. Compare new quotes vs current premium.

5. ECM        → GET /assets/marketing?category=comparison_template
                 Pull the "Price Comparison" template.

6. CRM        → PATCH /leads/{id}
                 Update client status to "Retention In-Progress".

7. Comm Hub   → send_message(channel=email)
                 Send comparison with cheaper options to the client.
```

### 10.4 The Content Auditor Agent

Agent monitors new leads and sends appropriate Welcome Kits.

```
1. CRM        → GET /leads/scoring?status=new
                 Check for newly created leads.

2. AMS        → GET /clients/{id}/policies
                 Determine which lines of business the new lead has.

3. ECM        → GET /assets/marketing?category=welcome_kit
                 Fetch the correct Welcome Kit based on policy type
                 (e.g., "Homeowners Welcome Kit" vs "Auto Welcome Kit").

4. Comm Hub   → send_message(channel=email)
                 Send the Welcome Kit PDF to the new lead.

5. CRM        → PATCH /leads/{id}
                 Update lead status from "new" to "contacted".
                 Add tag "welcome-kit-sent".

6. ECM        → GET /documents/{client_id}/audit
                 Verify the welcome kit delivery is logged and
                 check for any missing compliance documents.
```

### 11.5 The Claims Handler Agent

Agent processes a new claim from FNOL through investigation and settlement.

```
1. Claims    → POST /claims/fnol
                File First Notice of Loss with loss details.

2. Claims    → GET /adjusters?specialty={type}&active=1
                Find available adjuster matching claim type.

3. Claims    → POST /claims/{claim_id}/assign
                Assign adjuster. Status transitions to "assigned".

4. Claims    → POST /claims/{claim_id}/documents
                Upload supporting documents (police report, photos).

5. Claims    → PATCH /claims/{claim_id}
                Update status to "investigating", set reserve amount.

6. Claims    → PATCH /claims/{claim_id}
                After investigation, update to "reserved" or "settled"
                with settlement amount.

7. Comm Hub  → send_message(channel=email)
                Notify client of claim status and next steps.

8. Claims    → GET /claims/{claim_id}/timeline
                Review full activity log for audit trail.
```

---

## References

- [Product Requirements Document](PRD.md)
- OpenAPI Specs: `specs/ams.yaml`, `specs/rater.yaml`, `specs/comm.yaml`, `specs/crm.yaml`, `specs/ecm.yaml`, `specs/claims.yaml`
