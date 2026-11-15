| Model | Harness | Learning mechanism | `pass@1` | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |
| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |
| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |
| `gemini-3.8-flash` | Inspect + LangChain | Domain skill (SOP) | 83.0% [68.0, 95.0] | 73.7% | 3/30 sys · 2/60 judg | 14.0% | 0.10 (2%) | -12.0 pp | $0.490 |
| `gemini-3.8-flash` | Inspect + LangChain | None (zero-shot) | 67.0% [47.0, 84.0] | 58.7% | 1/30 sys · 12/60 judg | 15.0% | 0.20 (9%) | -28.0 pp | $0.476 |
| `claude-sonnet-5-5` | Inspect + LangChain | None (zero-shot) | 66.0% [48.0, 83.0] | 55.0% | 0/30 sys · 5/60 judg | 16.0% | 0.01 (1%) | -9.0 pp | $0.145 |
| `DeepSeek-V4.1-Flash` | Inspect + LangChain | None (zero-shot) | 56.0% [41.0, 71.0] | 31.5% | 0/30 sys · 6/60 judg | 34.0% | 0.67 (11%) | -4.0 pp | $0.039 |
