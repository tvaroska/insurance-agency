# OpenEnv & Prime Intellect `verifiers` RL Gym Control Plane (`eval/openenv/`)

Exposes the **Evergreen Insurance API Gym** as an online Reinforcement Learning and fast-reset evaluation environment compatible with **OpenEnv** (Meta PyTorch + Hugging Face) and **Prime Intellect `verifiers`** (`vf.ToolEnv` / `prime-rl`).

Instead of restarting 8 Docker containers between episodes (~15–30s), `eval/openenv/` uses the `/sim/*` control plane across ports `3000–3007` to reset databases, capture full state snapshots, advance simulated clocks, and inject chaos faults in `<100ms`.

---

## 1. Components

| File | Description |
| :--- | :--- |
| [`client.ts`](client.ts) | TypeScript client for `/sim/reset`, `/sim/snapshot`, `/sim/time-travel`, and `/sim/chaos` across all 8 services (`resetAllServices`, `snapshotAllServices`, `timeTravelAllServices`, `configureChaosAllServices`). |
| [`evergreen_env.py`](evergreen_env.py) | Python `EvergreenGymEnv` (`reset`, `step`, `snapshot`, `time_travel`, `chaos`, `score`) and `EvergreenVerifiersEnv` (`load_environment()`, `get_rubric()`, `rollout()`). |
| [`__tests__/openenv.test.ts`](__tests__/openenv.test.ts) | Unit tests verifying both the TypeScript `/sim/*` client and the Python `EvergreenGymEnv` / `EvergreenVerifiersEnv` classes. |

---

## 2. TypeScript Control Plane Client Usage

```typescript
import {
  resetAllServices,
  snapshotAllServices,
  timeTravelAllServices,
  configureChaosAllServices,
} from "./client";

// 1. Reset all 8 microservices to realistic seed data in <100ms
await resetAllServices("realistic");

// 2. Advance the simulated clock by 30 days to trigger renewal & quote expiration rules
await timeTravelAllServices({ days: 30 });

// 3. Inject 20% 503 chaos faults on carrier portals
await configureChaosAllServices(
  { enabled: true, error_rate: 0.2, status_code: 503, latency_ms: 150 },
  { services: ["summit-fire", "coastal-star"] },
);

// 4. Snapshot all tables across all 8 services for state-diff verification
const snapshot = await snapshotAllServices();
```

---

## 3. Python OpenEnv & `verifiers` RL Rollout Usage

```python
from eval.openenv.evergreen_env import EvergreenGymEnv, load_environment

# Standard Gymnasium / OpenEnv loop
env = EvergreenGymEnv(task_id="16-realistic-natural", max_steps=20)
obs, info = env.reset()
obs, reward, terminated, truncated, step_info = env.step(
    {"service": "ams", "method": "GET", "path": "/v1/clients?last_name=Chen"}
)

# Prime Intellect `verifiers` environment for GRPO / RLOO training
vf_env = load_environment(scenario="16,17,18,19,20", seed="realistic", difficulty="natural")
rubric = vf_env.get_rubric()
```
