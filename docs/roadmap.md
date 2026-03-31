# Privy/gym — Roadmap

**Last Updated:** 2026-03-31

## Strategic Overview

High-level priorities and feature areas for the Evergreen Insurance API Gym.

---

## Feature Areas

### Evaluation System

**Status:** In Progress (Sprint 1)
**Priority:** P0
**Progress:** 85%

Goals:
- Scorer with output + trace evaluation (done)
- 15 benchmark scenarios (15/15 implemented, 218 total cases)
- Multi-turn conversation scenarios (planned, P1)
- Cost & latency scoring dimension (planned, P2)

### Infrastructure

**Status:** Planned
**Priority:** P2
**Progress:** 0%

Goals:
- PostgreSQL migration for concurrent agent evaluation
- Connection pooling and multi-agent support

---

## Release Plan

### v0.1.0 — Scorer MVP (done)

- Scorer CLI with output + trace evaluation
- 4 scenarios implemented (01, 04, 07, 08)
- GenAI semconv trace parser
- Clean + realistic seed variants

### v0.2.0 — Full Scenario Coverage

- All 15 scenarios implemented
- Unit + integration tests for evaluators
- Multi-turn conversation variants (P1)

### v0.3.0 — Efficiency & Scale

- Cost & latency evaluation dimension
- PostgreSQL migration (AMS first)
- Concurrent agent evaluation support

---

**Updated by:** /wreplan command
