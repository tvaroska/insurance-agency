| Model | Harness | Learning mechanism | `pass@1` | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |
| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |
| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |
| `gemini-3.8-flash` | Inspect + LangChain | None (zero-shot) | 66.7% (0.68 mean) | n/a (k=1) | 0/1 sys · 1/3 judg | 16.7% | 0.00 (0%) | +33.3 pp | $0.068 |
| `claude-sonnet-5-5` | Inspect + LangChain | None (zero-shot) | 50.0% (0.62 mean) | n/a (k=1) | 0/1 sys · 1/3 judg | 50.0% | 0.00 (0%) | +16.7 pp | $0.079 |
| `DeepSeek-V4.1-Flash` | Inspect + LangChain | None (zero-shot) | 33.3% (0.53 mean) | n/a (k=1) | 1/1 sys · 1/3 judg | 66.7% | 0.00 (0%) | +0.0 pp | $0.010 |
