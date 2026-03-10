# Data Models

This document contains Mermaid ER diagrams for the database schemas across all services in the insurance platform. Each service maintains its own SQLite database. Cross-service references (e.g., `client_id`, `policy_id`) are soft references rather than enforced foreign key constraints.

Key columns are shown per table to keep diagrams readable; refer to the source schema files for the complete column list.

---

## AMS Service

Agency Management System -- clients, policies, coverages, endorsements, commissions, and tasks.

```mermaid
erDiagram
    %% Key columns shown
    clients {
        int id PK
        text first_name
        text last_name
        text email
        text phone
        text address_state
        text status
        text created_at
    }
    policies {
        text policy_id PK
        int client_id FK
        text carrier_code
        text policy_type
        text effective_date
        text expiration_date
        real premium_current
        text status
    }
    coverages {
        int id PK
        text policy_id FK
        text type
        real limit
        real deductible
    }
    endorsements {
        text endorsement_id PK
        text policy_id FK
        text change_type
        real premium_delta
        text status
        text effective_date
    }
    commissions {
        text commission_id PK
        text policy_id FK
        text carrier_code
        text transaction_type
        real gross_amount
        real commission_rate
        text status
    }
    tasks {
        int id PK
        text title
        text status
        text priority
        text assigned_to
        int related_client_id
        text related_policy_id
    }

    clients ||--o{ policies : "has"
    policies ||--o{ coverages : "includes"
    policies ||--o{ endorsements : "has"
    policies ||--o{ commissions : "earns"
    clients ||--o{ tasks : "related to"
```

---

## Rater Service

Quoting engine -- manages quote requests, carrier responses, and carrier appetite configuration.

```mermaid
erDiagram
    %% Key columns shown
    quote_requests {
        text request_id PK
        int client_id
        text policy_type
        text effective_date
        text status
        json risk_data
        text submitted_at
    }
    carrier_quotes {
        text quote_id PK
        text request_id FK
        text carrier_code
        text carrier_name
        text status
        real premium_annual
        text decline_reason
        text valid_until
    }
    carriers {
        text carrier_code PK
        text carrier_name
        json states
        json policy_types
        text appetite_level
        int min_driver_age
    }

    quote_requests ||--o{ carrier_quotes : "receives"
    carriers ||--o{ carrier_quotes : "provides"
```

---

## CRM Service

Customer Relationship Management -- leads, campaigns, enrollments, and retention risk tracking.

```mermaid
erDiagram
    %% Key columns shown
    leads {
        text lead_id PK
        int client_id
        text first_name
        text last_name
        text source
        text status
        int score
        text assigned_producer
    }
    campaigns {
        text campaign_id PK
        text name
        text type
        text status
        int enrolled_count
        real conversion_rate
    }
    campaign_enrollments {
        text enrollment_id PK
        text campaign_id FK
        int client_id
        text trigger_reason
        int sequence_step
        text enrolled_at
    }
    retention_risks {
        int client_id PK
        text client_name
        int risk_score
        real rate_increase_pct
        int policies_count
        text recommended_action
        text assigned_producer
    }

    campaigns ||--o{ campaign_enrollments : "contains"
```

---

## ECM Service

Enterprise Content Management -- document storage, e-signature envelopes, and marketing assets.

```mermaid
erDiagram
    %% Key columns shown
    documents {
        text document_id PK
        int client_id
        text document_type
        text filename
        text mime_type
        int file_size_bytes
        text status
        text upload_date
    }
    envelopes {
        text envelope_id PK
        int client_id
        json document_ids
        json signers
        text status
        text message
        text created_at
    }
    marketing_assets {
        text asset_id PK
        text name
        text category
        text mime_type
        text url
        int version
    }
```

---

## Comm Service

Communications -- messages across channels, webhook subscriptions, and delivery tracking.

```mermaid
erDiagram
    %% Key columns shown
    messages {
        text message_id PK
        int client_id
        text direction
        text channel
        text subject
        text body
        text timestamp
        text status
    }
    webhooks {
        text webhook_id PK
        text url
        json events
        text secret
        int active
        text created_at
    }
    webhook_deliveries {
        text delivery_id PK
        text webhook_id FK
        text event_id
        text event_type
        text status
        int attempts
        int response_status
    }

    webhooks ||--o{ webhook_deliveries : "triggers"
```

---

## Claims Service

Claims processing -- claims intake, adjuster assignment, document uploads, and timeline events.

```mermaid
erDiagram
    %% Key columns shown
    adjusters {
        text adjuster_id PK
        text first_name
        text last_name
        text email
        text specialty
        int active
        int max_open_claims
    }
    claims {
        text claim_id PK
        text policy_id
        int client_id
        text claim_type
        text status
        text loss_date
        real reserve_amount
        text adjuster_id FK
    }
    claim_documents {
        text document_id PK
        text claim_id FK
        text document_type
        text file_name
        text file_path
        text uploaded_by
    }
    claim_timeline {
        text event_id PK
        text claim_id FK
        text event_type
        text description
        text old_value
        text new_value
        text created_by
    }

    adjusters ||--o{ claims : "handles"
    claims ||--o{ claim_documents : "has"
    claims ||--o{ claim_timeline : "tracks"
```

---

## Carrier-Summit Service

Summit Fire & Casualty carrier portal -- property-focused quoting, underwriting conditions, policies, and documents.

```mermaid
erDiagram
    %% Key columns shown
    quotes {
        text quote_id PK
        text request_id
        int client_id
        text policy_type
        real premium_annual
        text status
        text underwriting_status
        text inspection_status
    }
    policies {
        text policy_id PK
        int client_id
        text policy_type
        text effective_date
        text expiration_date
        real premium_current
        text status
    }
    policy_documents {
        text document_id PK
        text policy_id FK
        text document_type
        text filename
        int file_size_bytes
        int version
        text supersedes
    }
    underwriting_conditions {
        text condition_id PK
        text quote_id FK
        text condition_type
        text description
        text status
        text resolved_at
    }

    quotes ||--o{ underwriting_conditions : "requires"
    policies ||--o{ policy_documents : "has"
```

---

## Carrier-Coastal Service

Coastal Star Insurance carrier portal -- auto-focused quoting with risk scoring, policies, and ID cards.

```mermaid
erDiagram
    %% Key columns shown
    quotes {
        text quote_id PK
        text request_id
        int client_id
        text policy_type
        real premium_annual
        text status
        text risk_tier
        text bind_status
    }
    policies {
        text policy_id PK
        int client_id
        text policy_type
        text effective_date
        text expiration_date
        real premium_current
        text status
    }
    id_cards {
        text card_id PK
        text policy_id FK
        json card_data
        text issued_at
    }

    policies ||--o{ id_cards : "issues"
```

---

## Cross-Service Relationships

The following diagram illustrates the soft references that link data across service boundaries. These are not enforced foreign keys -- each service owns its own database and references entities in other services by convention.

```mermaid
erDiagram
    %% Soft references across service boundaries

    AMS_clients {
        int id PK
        text name
    }
    AMS_policies {
        text policy_id PK
        int client_id FK
    }
    Rater_quote_requests {
        text request_id PK
        int client_id
    }
    Rater_carrier_quotes {
        text quote_id PK
        text request_id FK
    }
    CRM_leads {
        text lead_id PK
        int client_id
    }
    CRM_campaign_enrollments {
        text enrollment_id PK
        int client_id
    }
    CRM_retention_risks {
        int client_id PK
    }
    ECM_documents {
        text document_id PK
        int client_id
    }
    ECM_envelopes {
        text envelope_id PK
        int client_id
    }
    Comm_messages {
        text message_id PK
        int client_id
    }
    Claims_claims {
        text claim_id PK
        text policy_id
        int client_id
    }
    Summit_quotes {
        text quote_id PK
        int client_id
        text request_id
    }
    Summit_policies {
        text policy_id PK
        int client_id
    }
    Coastal_quotes {
        text quote_id PK
        int client_id
        text request_id
    }
    Coastal_policies {
        text policy_id PK
        int client_id
    }

    AMS_clients ||--o{ AMS_policies : "owns"
    AMS_clients ||--o{ Rater_quote_requests : "client_id"
    AMS_clients ||--o{ CRM_leads : "client_id"
    AMS_clients ||--o{ CRM_campaign_enrollments : "client_id"
    AMS_clients ||--o{ CRM_retention_risks : "client_id"
    AMS_clients ||--o{ ECM_documents : "client_id"
    AMS_clients ||--o{ ECM_envelopes : "client_id"
    AMS_clients ||--o{ Comm_messages : "client_id"
    AMS_clients ||--o{ Claims_claims : "client_id"
    AMS_clients ||--o{ Summit_quotes : "client_id"
    AMS_clients ||--o{ Summit_policies : "client_id"
    AMS_clients ||--o{ Coastal_quotes : "client_id"
    AMS_clients ||--o{ Coastal_policies : "client_id"
    AMS_policies ||--o{ Claims_claims : "policy_id"
    Rater_quote_requests ||--o{ Rater_carrier_quotes : "request_id"
    Rater_quote_requests ||--o{ Summit_quotes : "request_id"
    Rater_quote_requests ||--o{ Coastal_quotes : "request_id"
```
