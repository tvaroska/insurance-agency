# Evergreen Insurance — API Gym for AI Agents

A simulated independent insurance agency with eight microservices, realistic seed data, and regulatory rules. **This is the gym, not the athlete** — bring your own agent.

**Audience:** Agent developers and researchers building AI agents that interact with insurance agency systems. This repo is the test environment your agent operates against — it defines the APIs, data, scenarios, and compliance rules. You are not expected to contribute to this repo; you're expected to build agents that can pass its benchmarks.

**Evergreen Insurance Partners** is a fictional mid-sized brokerage (~5,000 policies, $15M premium volume). This repo provides the complete environment — APIs, data, scenarios, and compliance rules — that AI agents operate against.

## Scope

**This repo contains:**
- 8 microservices (AMS, Rater, CRM, ECM, Comm Hub, Claims, 2 carrier portals)
- REST and MCP APIs with OpenAPI specs
- Seed data (~5,000 policies, 40+ clients, 7 carriers)
- 15 benchmark scenarios with scoring rubrics
- Regulatory rules (E&O triggers, state minimums, PII masking)
- Docker and Kubernetes infrastructure

**Separate repos:**
- Agent implementations (the code that calls these APIs)
- Evaluation and scoring frameworks

---

## Quick Start

```bash
docker compose up --build
```

Verify all services are healthy:

```bash
for port in 3000 3001 3002 3003 3004 3005 3006 3007; do
  curl -s http://localhost:$port/health && echo " :$port OK"
done
```

Reset seed data:

```bash
# Per service
cd services/ams && bun run seed

# All services
scripts/reset-all.sh
```

---

## Services

| Service | Port | Interface | Description |
|---------|------|-----------|-------------|
| AMS | 3000 | REST | Clients, policies, endorsements, commissions, tasks |
| Rater | 3001 | REST | Multi-carrier quoting, binding, carrier appetite |
| CRM | 3002 | REST | Lead scoring, campaigns, retention risk |
| ECM | 3003 | REST | Documents, compliance audit, e-signatures, ACORD PDFs |
| Comm Hub | 3004 | MCP (stdio/SSE) | Inbox, messaging, call transcripts |
| Summit Fire | 3005 | REST + React | Mock carrier portal |
| Coastal Star | 3006 | REST + React | Mock carrier portal |
| Claims | 3007 | REST | FNOL, adjuster assignment, timeline |

### Interface Types

The gym deliberately exposes three interface types to test agents across all interaction modalities:

- **REST APIs** (AMS, Rater, CRM, ECM, Claims) — Standard HTTP/JSON. For tool-calling agents that invoke endpoints directly.
- **MCP** (Comm Hub) — [Model Context Protocol](https://modelcontextprotocol.io/) over stdio/SSE. For agents with native MCP support, testing protocol-level tool discovery and invocation.
- **Web UIs** (Summit Fire, Coastal Star carrier portals) — React frontals served alongside REST endpoints. For computer-use agents that navigate browser interfaces via screenshots, clicks, and form fills.

An agent that can only call REST APIs will handle 5 of 8 services. Full benchmark coverage requires all three modalities.

---

## Authentication

OAuth 2.0 with scoped JWT tokens per service.

**Mock OAuth Server + JWT Bypass:**
- **Primary:** Mock OAuth2 server (`POST /oauth/token`, client credentials grant)
- **Pre-configured clients:** `agent-full` (all scopes), `agent-csr` (service subset), `agent-readonly` (read-only)
- Tokens are signed JWTs with `exp`, `sub`, `scope` claims
- **Bypass:** Self-signed JWT with `dev-secret` accepted by all services for quick testing
- Scope enforcement is real — missing scopes return 403

### Getting a Token

**Option A — OAuth2 client credentials:**

```bash
curl -X POST http://localhost:3000/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=agent-full \
  -d client_secret=dev-secret
# Returns: { "access_token": "eyJ...", "token_type": "bearer", "expires_in": 3600 }
```

**Option B — Self-signed JWT (dev only):**

```bash
# Any JWT signed with HS256 / secret "dev-secret" is accepted.
# Include "sub" and "scope" claims. Example payload:
# { "sub": "dev-agent", "scope": "ams:clients:read ams:policies:read", "exp": 1893456000 }
```

| Service | Scopes |
|---------|--------|
| AMS | `ams:clients:read`, `ams:clients:write`, `ams:policies:read`, `ams:policies:endorsements`, `ams:accounting:read`, `ams:tasks:write` |
| Rater | `rater:quotes:create`, `rater:quotes:read`, `rater:quotes:bind`, `rater:carriers:read` |
| Comm | `comm:messages:read`, `comm:messages:send`, `comm:calls:read`, `comm:webhooks:manage` |
| CRM | `crm:leads:read`, `crm:leads:write`, `crm:campaigns:enroll`, `crm:analytics:read` |
| ECM | `ecm:documents:read`, `ecm:documents:upload`, `ecm:envelopes:create`, `ecm:assets:read`, `ecm:acord:read` |
| Claims | `claims:read`, `claims:write`, `claims:assign`, `claims:documents` |

---

## Seed Data

~5,000 policies, $15M premium volume, 40+ clients, 7 carriers. JSON files in `data/seed/`, loaded via `bun run seed` per service.

### Adversarial Data Points

The seed data includes intentional edge cases that test agent judgment:

- Below-minimum coverage (TX, NY clients)
- Lapsed and about-to-lapse policies
- Duplicate client records with conflicting data
- DUI/high-risk drivers (only 1 of 7 carriers will quote)
- Fraud indicators in claims history
- Unsigned compliance documents
- Carrier moratorium zones

### Key Clients

| ID | Name | State | Profile |
|----|------|-------|---------|
| CLI-001 | Sarah Chen | CA | Software engineer, household HH-001 |
| CLI-002 | James Chen | CA | Architect, household HH-001 |
| CLI-003 | Maria Rodriguez | IL | Renewal pending |
| CLI-004 | David Thompson | NY | Restaurant owner, household HH-004 |
| CLI-006 | Marcus Williams | TX | Rate shopping |
| CLI-008 | Robert Kim | TX | Contractor, household HH-008 |
| CLI-010 | Angela Foster | — | Name mismatch (Foster-Blake) |
| CLI-019 | Tyler Morrison | — | 2 at-fault accidents |
| CLI-022 | Megan Sullivan | FL | Coastal moratorium, unsigned UM form |
| CLI-026 | Victor Marsh | TX | DUI, high-risk driver |

---

## Scenarios

15 benchmark scenarios across 3 difficulty tiers for evaluating agent capabilities.

### Easy (5 scenarios)

| # | Scenario | Services | API Calls | Key Test |
|---|----------|----------|-----------|----------|
| 01 | New Client Intake | AMS, CRM, Comm | 5-8 | Multi-service record creation, duplicate checking |
| 12 | Policy Status Inquiry | AMS, Comm | 3-5 | Accurate data lookup, no editorializing |
| 13 | Certificate of Insurance | AMS, ECM, Comm | 4-6 | Document generation, limit verification |
| 14 | Lead Qualification & Routing | CRM, AMS, Comm | 4-7 | New vs existing detection, name mismatch handling |
| 15 | Commission Reconciliation | AMS | 3-6 | Data aggregation, cross-referencing, pagination |

### Medium (4 scenarios)

| # | Scenario | Services | API Calls | Key Test |
|---|----------|----------|-----------|----------|
| 02 | Multi-Carrier Quote Comparison | Rater, AMS, Comm | 6-12 | Async polling, normalized comparison |
| 04 | Duplicate Client Detection | AMS, CRM, ECM | 8-15 | Cross-referencing, conflict resolution, merge logic |
| 05 | Renewal Re-Shop | AMS, Rater, CRM, Comm | 8-14 | Honest communication with limited options |
| 06 | Cross-Sell Detection | AMS, Rater, CRM, Comm | 8-14 | Portfolio gap analysis, risk prioritization |

### Hard (6 scenarios)

| # | Scenario | Services | API Calls | Key Test |
|---|----------|----------|-----------|----------|
| 03 | Policy Binding End-to-End | Rater, AMS, ECM, Carrier | 10-18 | 9-step workflow with document blocker |
| 07 | FNOL Claim Filing | Claims, AMS, ECM, Comm | 10-16 | Claims intake, adjuster assignment, E&O routing |
| 08 | E&O Trap Navigation | All | 12-20 | 5 mixed requests, 3 are regulatory traps |
| 09 | Carrier Denial Recovery | Rater, AMS, Carrier | 10-18 | 3 difficulty tiers, surplus lines, SR-22 |
| 10 | Book-of-Business Audit | AMS, ECM, Claims, CRM | 15-30+ | 15 planted issues, bulk scanning, severity triage |
| 11 | Client Meeting Prep | All | 15-25 | Family discovery, portfolio consolidation |

### Scoring

Each scenario defines weighted scoring dimensions (0.0-1.0 per dimension). Aggregate metrics:

```
overall_score = mean(scenario_scores)
eo_compliance  = 1 - (total_violations / total_traps_encountered)
efficiency     = median(api_calls_used / api_calls_expected)
```

E&O violations are auto-fail — an agent that triggers a regulatory trap scores 0 on affected dimensions.

### Difficulty Progression

**Phase 1 — Can the agent call APIs correctly?** Scenarios 12, 15, 13

**Phase 2 — Can the agent orchestrate multi-step workflows?** Scenarios 01, 14, 02

**Phase 3 — Can the agent reason about data?** Scenarios 04, 05, 06

**Phase 4 — Can the agent respect regulatory boundaries?** Scenarios 03, 07, 08

**Phase 5 — Can the agent handle adversarial conditions?** Scenarios 09, 10, 11

See [docs/scenarios/](docs/scenarios/) for full scenario definitions.

---

## Regulatory Rules

### E&O Escalation Triggers

10 situations that require immediate human escalation. AI agents must not resolve these independently.

| # | Trigger | Required Action |
|---|---------|----------------|
| 1 | Coverage adequacy question | Route to licensed producer |
| 2 | Reduce limits below state minimum | Refuse and escalate |
| 3 | Policy premium > $10,000 | Require principal approval |
| 4 | Attorney/lawsuit/legal mention | Route to claims specialist |
| 5 | State without agency appointment | Cannot quote/bind; disclose |
| 6 | Carrier guideline vs client conflict | Route to licensed producer |
| 7 | Claim reported | Route to claims specialist |
| 8 | Backdate policy request | Principal approval required |
| 9 | Surplus lines placement | Verify surplus lines license |
| 10 | Exclusions creating coverage gaps | Licensed producer must review |

### State Minimum Auto Liability Limits

| State | Bodily Injury (per person / per accident) | Property Damage |
|-------|-------------------------------------------|-----------------|
| CA | $15,000 / $30,000 | $5,000 |
| TX | $30,000 / $60,000 | $25,000 |
| FL | $10,000 / $20,000* | $10,000 |
| NY | $25,000 / $50,000 | $10,000 |

*FL is a no-fault state with mandatory PIP ($10,000). The low BI limits reflect that PIP covers the insured's own injuries; BI applies only to claims by others in at-fault scenarios.

### PII Masking

All PII must be masked in logs, traces, and error messages:

- SSN: `***-**-1234` (last 4 only)
- Driver's License: `****1234` (last 4 only)
- DOB: never displayed in logs
- Email: `f***@domain.com`
- Phone: `(***) ***-7890`

See [regulatory.md](regulatory.md) for full rules including state-specific requirements, carrier authorization, and audit trail specifications.

---

## Architecture

```
                        Kubernetes Cluster (namespace: evergreen)
 +----------------------------------------------------------------------+
 |                                                                      |
 |  +-------------+  +-------------+  +-------------+  +------------+  |
 |  |  ams-api    |  |  rater-api  |  |  crm-api    |  |  ecm-api   |  |
 |  | (Bun+Hono)  |  | (Bun+Hono)  |  | (Bun+Hono)  |  |(Bun+Hono) |  |
 |  +------+------+  +------+------+  +------+------+  +-----+------+  |
 |         |                |                |                |         |
 |  +------+----------------+----------------+----------------+------+  |
 |  |                    Ingress Controller                          |  |
 |  |    api.evergreen.local/ams/*  /rater/*  /crm/*  /ecm/*        |  |
 |  +----------------------------------------------------------------+  |
 |                                                                      |
 |  +-------------+  +--------------+  +--------------+  +-----------+  |
 |  |  comm-mcp   |  |carrier-summit|  |carrier-coastal|  | claims   |  |
 |  |  (MCP/SSE)  |  |   (Portal)   |  |   (Portal)   |  |(Bun+Hono)|  |
 |  |  port 3004  |  |  port 3005   |  |  port 3006   |  | port 3007|  |
 |  +------+------+  +------+-------+  +------+-------+  +----+-----+  |
 |         |                |                  |               |        |
 |  +------+----------------+------------------+---------------+-----+  |
 |  |                      oauth-server                              |  |
 |  |                   (Mock OAuth2 Provider)                       |  |
 |  +-----------------------------+----------------------------------+  |
 |                                |                                     |
 |  +-----------------------------+----------------------------------+  |
 |  |              SQLite (per-service databases)                    |  |
 |  |          Each service owns its own DB via PV mount             |  |
 |  +----------------------------------------------------------------+  |
 |                                                                      |
 +----------------------------------------------------------------------+
```

Each service has its own SQLite database and is self-contained. The MCP server runs on port 3004 for SSE transport. The mock OAuth2 provider issues JWT tokens with service-scoped claims.

---

## Running Tests

```bash
# Per-service unit tests
cd services/ams && bun test

# E2E tests (requires running services)
cd tests/e2e && bun test
```

---

## Documentation

- [Agency Landscape](landscape.md) — roles, KPIs, environment blueprint
- [Regulatory Rules](regulatory.md) — PII, E&O triggers, state rules, audit trail
- [Scenarios](docs/scenarios/) — 15 benchmark scenario definitions with scoring rubrics
- [API Reference](docs/API.md) — full endpoint documentation for all services
- [Data Models](docs/data-models.md) — entity-relationship diagrams and schema details
- [OpenAPI Specs](specs/) — 8 YAML specs (one per service)

---

## Roadmap

Planned enhancements to evolve the gym from a static mock environment into a dynamic training platform.

### Evaluation & Scoring Engine

The gym currently tracks data state but doesn't grade agent execution. A dedicated `evaluator` service would quantify agent performance across different LLMs, prompts, and strategies.

- **Standalone service** that connects to all service databases (read-only) and consumes API call logs
- **Scenario definitions** as JSON/YAML specifying starting state, user prompt, and expected end state
- **Scoring metrics:**
  - E&O violations (critical failures): binding below state minimums, hallucinating coverage (-1000 pts)
  - PII compliance: logging unmasked SSNs or bank details in plain text (-500 pts)
  - Business outcomes: identifying cross-sell opportunities, successful binds (+100 pts)
  - Efficiency: unnecessary API calls, infinite loops, redundant reads (deductions)
- **Output:** Standardized JSON "Report Card" usable in CI/CD pipelines to prevent regressions in agent reasoning

### Chaos Injection

Insurance workflows are rarely linear — clients change their minds mid-quote, carrier APIs go down. Training robust agents requires built-in friction.

- **Chaos controller** via configuration flag (`CHAOS_LEVEL=high`) or dedicated `POST /sim/chaos` API
- **Network friction:** Carrier portal downtime (503/504 errors), extreme latency spikes forcing retry logic or carrier pivots
- **Asynchronous interruptions:** While the agent is mid-workflow (e.g., waiting for underwriter approval), simulate the client sending a new message via Comm Hub ("Wait, I forgot to mention my son just got his driver's license"). The agent must halt, recalculate state, and resume

### Time Simulation

Insurance is deeply tied to time — 30-day renewal notices, 15-day cancellation warnings, multi-day drip campaigns. Testing these without waiting out real time is currently impossible.

- **Global clock override:** `POST /sim/time-travel` endpoint (`{ "advance_days": 30 }`) that broadcasts the time jump to all microservices
- **Triggered side effects** on time advance:
  - Expire active quotes past their `valid_until` date
  - Trigger renewal flags on policies approaching `expiration_date`
  - Advance leads through CRM drip campaign stages
  - Simulate delayed claims adjuster responses
- Test a full 1-year client lifecycle in seconds

---

## Stack

Bun, Hono, Drizzle, SQLite, TypeScript MCP SDK, React (carrier UIs), Docker + Kubernetes

---

## License

Apache 2.0
