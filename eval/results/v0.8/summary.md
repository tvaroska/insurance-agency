| Model | Harness | Learning mechanism | `pass@1` | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |
| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |
| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |
| `gemini-3.8-flash` | Inspect + LangChain | Domain skill (SOP) | 69.0% [52.0, 86.0] | 60.2% | 1/30 sys · 5/60 judg | 27.0% | 0.09 (7%) | n/a | $0.405 |
| `DeepSeek-V4.1-Flash` | Inspect + LangChain | None (zero-shot) | 59.0% [43.0, 75.0] | 39.2% | 0/30 sys · 5/60 judg | 27.0% | 0.22 (9%) | -1.1 pp | $0.073 |
| `gemini-3.8-flash` | Inspect + LangChain | None (zero-shot) | 58.0% [39.0, 76.0] | 47.1% | 5/30 sys · 16/60 judg | 29.0% | 0.39 (10%) | -21.1 pp | $0.449 |
| `claude-sonnet-5-5` | Inspect + LangChain | None (zero-shot) | 55.0% [36.0, 74.0] | 45.8% | 0/30 sys · 14/60 judg | 26.0% | 0.00 (0%) | -20.0 pp | $0.111 |
