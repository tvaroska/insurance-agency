# Privy/gym — Product Specs

Requirements and acceptance criteria organized by feature area.

---

## Multi-Turn Conversation Scenarios

### Requirements

- Conversation simulator provides scripted user responses keyed to agent question patterns
- Response engine is template-based (no LLM) for deterministic reproducibility
- At least 3 scenarios have multi-turn variants (FNOL with incomplete info, ambiguous client identity, multi-policy endorsement with corrections)
- Trace evaluator scores: question relevance, turn count vs budget, information extraction completeness
- Turn budget defined per scenario variant (min/max turns); penalties for both over-asking and under-asking
- Conversation history passed to output evaluator for end-state verification

### Acceptance Criteria

- [ ] Conversation simulator accepts scenario config and returns responses for ≥10 question patterns
- [ ] At least 1 Easy, 1 Medium, 1 Hard scenario has a multi-turn variant
- [ ] Scorer produces turn-efficiency score alongside existing trace/output scores
- [ ] Agent that asks 0 clarifying questions on ambiguous input scores lower than one that asks relevant questions
- [ ] Deterministic: same agent trace replayed twice produces identical scores

## Cost & Latency Evaluation

### Requirements

- Token counts extracted from GenAI semconv spans (`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`)
- Wall-clock time calculated from trace span envelope (first start → last end)
- LLM invocation count from `gen_ai.operation.name` spans
- Per-scenario efficiency budgets: max tokens, max latency, max LLM calls
- Configurable cost model (price per token per model)
- Report includes cost breakdown table and latency percentiles

### Acceptance Criteria

- [ ] Scorer extracts token usage from GenAI traces and includes in report
- [ ] Cost estimate calculated using configurable per-model pricing
- [ ] Efficiency score penalizes agents exceeding token/latency/call budgets
- [ ] Report markdown includes cost and latency sections

## PostgreSQL Migration

### Requirements

- AMS service migrated from SQLite to PostgreSQL as first phase
- Docker Compose includes PostgreSQL container with health check
- Seed data loaded via SQL migration scripts (not baked into image)
- Reset via volume removal: `docker compose down -v && docker compose up`
- Connection pooling supports concurrent agent evaluation
- All existing AMS tests pass against PostgreSQL

### Acceptance Criteria

- [ ] AMS service starts against PostgreSQL in Docker Compose
- [ ] `bun test` in services/ams passes with PostgreSQL backend
- [ ] Seed data loads correctly in both clean and realistic modes
- [ ] Two concurrent agents can write to AMS without SQLite lock errors
- [ ] Reset to seed state works via `docker compose down -v && up`
