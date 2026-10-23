# Harbor / Terminal-Bench 2.0 Adapter (`eval/harbor/`)

Packages the **20 Evergreen Insurance API Gym scenarios** (253 total task cases across seed variants and 5 prompt difficulty tiers) into the [**Harbor / Terminal-Bench 2.0**](https://harborframework.com) task standard (`task.yaml` + `docker-compose.harbor.yaml` + `tests/test_outputs.py`).

This enables zero-code benchmarking of container and CLI-based agent harnesses (**Claude Code, OpenHands, Codex CLI, Goose, Aider**) directly against the 8 Evergreen microservices.

---

## 1. Directory Layout

```text
eval/harbor/
├── export-harbor.ts             # Generates tasks-manifest.json, compose, and task directories
├── docker-compose.harbor.yaml   # Shared 8-service + harbor-agent container topology
├── tasks-manifest.json          # Full catalog of all 253 task cases across 20 scenarios
├── tasks/
│   ├── 01-realistic-natural/
│   │   ├── task.yaml
│   │   └── tests/
│   │       └── test_outputs.py  # Invokes `bun eval/score.ts` and asserts E&O + score
│   └── ... (01..20 representative tasks by default; all 253 with `--all`)
└── __tests__/
    └── harbor.test.ts
```

---

## 2. Generating Harbor Task Definitions

```bash
# Export full manifest (253 tasks) + 20 representative scenario directories (<id>-realistic-natural):
bun eval/harbor/export-harbor.ts

# Export all 253 task directories:
bun eval/harbor/export-harbor.ts --all

# Export to a custom directory:
bun eval/harbor/export-harbor.ts --out-dir /tmp/harbor-evergreen --all
```

---

## 3. Running CLI & Container Harnesses with `harbor run`

### 3.1 Claude Code (`claude-code`)

```bash
harbor run \
  --dataset-path eval/harbor/tasks \
  --agent claude-code \
  --model gemini-3.8-flash \
  --n-concurrent 4 \
  --output-dir eval/runs/harbor-claude-code
```

### 3.2 OpenHands (`openhands`)

```bash
harbor run \
  --dataset-path eval/harbor/tasks \
  --agent openhands \
  --model gemini-4-argon \
  --n-concurrent 4 \
  --output-dir eval/runs/harbor-openhands
```

### 3.3 Codex CLI (`codex`)

```bash
harbor run \
  --dataset-path eval/harbor/tasks \
  --agent codex \
  --model gemini-3.8-flash \
  --task-id 08-realistic-natural \
  --output-dir eval/runs/harbor-codex
```

### 3.4 Block Goose (`goose`)

```bash
harbor run \
  --dataset-path eval/harbor/tasks \
  --agent goose \
  --model gemini-3.8-flash \
  --task-id 16-realistic-natural \
  --output-dir eval/runs/harbor-goose
```

### 3.5 Aider (`aider`)

```bash
harbor run \
  --dataset-path eval/harbor/tasks \
  --agent aider \
  --model gemini-3.5-flash-lite \
  --task-id 01-realistic-natural \
  --output-dir eval/runs/harbor-aider
```

---

## 4. Verification & Reward Hook (`tests/test_outputs.py`)

During Harbor's isolated verification phase, `pytest` runs `tests/test_outputs.py`, which:
1. Invokes `bun eval/score.ts --traces <trace_path> --scenario <id> --seed <seed> --case <case_id>`.
2. Writes structured partial-credit metrics (`score`, `trace_score`, `output_score`, `eo_compliant`, `api_calls`) to `/tmp/harbor-reward.json` (or `$HARBOR_REWARD_FILE`).
3. Enforces hard E&O regulatory compliance (`assert report["overall"]["eoCompliant"] is True`) and passing threshold (`HARBOR_PASS_THRESHOLD`, default `0.70`).
