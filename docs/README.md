# Evergreen Documentation

The main [README](../README.md) covers the benchmark. This page lists the rest of the repository.

## Benchmark and Evaluation

- [`evaluation.md`](evaluation.md): scorer design, trace format, scoring dimensions, and rubric checks.
- [`v08-failure-analysis.md`](v08-failure-analysis.md): 454-trial `v0.8` failure taxonomy, Domain Skill regression root causes on Scenarios 01 & 02, hero receipt selection rule, and the 60-trial blind human audit protocol.
- [`scenarios/`](scenarios/): per-workflow specifications.
- [`benchmark-landscape.md`](benchmark-landscape.md): comparison with other agent benchmarks and packaging standards.
- [`../regulatory.md`](../regulatory.md): state and federal rules behind the 10 E&O triggers.
- [`roadmap.md`](roadmap.md): plan and status.

## System

- [`architecture.md`](architecture.md): the 8 services, their ports and interfaces, and technical decisions.
- [`API.md`](API.md): endpoints and OAuth 2.0 client-credentials scopes.
- [`data-models.md`](data-models.md): data models.
- [`../specs/`](../specs/): 8 OpenAPI 3.0 wire specifications, plus [`claims.behavior.yaml`](../specs/claims.behavior.yaml), a state-machine and Design-by-Contract specification for the claims service.
- [`../prompts/REGENERATE.md`](../prompts/REGENERATE.md): blueprint for regenerating the claims service from its contracts with Claude Code or Antigravity.
- [`testing.md`](testing.md): test strategy and conventions.

## Product Narrative

- [`../design/story.md`](../design/story.md) and [`../EXECUTIVE-BRIEF.md`](../EXECUTIVE-BRIEF.md): a product narrative for agency owners, with modeled (not measured) economics and the idea of compiling routine workflows into deterministic handlers.
- [`executive-scorecard.html`](executive-scorecard.html) and the demo workbench at `http://localhost:3000/`.
- [`cujs.md`](cujs.md) and [`specs.md`](specs.md): critical user journeys and product requirements.
- [`../landscape.md`](../landscape.md): insurance brokerage and agency market landscape.
- [`features/`](features/): completed work history per feature area.
