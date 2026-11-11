| Model | Harness | Learning mechanism | `pass@1` | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |
| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |
| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |
| `gemini-3.8-flash` | Inspect + LangChain | Domain skill (SOP) | 69.0% [59.4, 77.2] | 60.2% | 1/30 sys · 5/60 judg | 35.0% | 0.09 (7%) | n/a | $0.058 |
| `DeepSeek-V4.1-Flash` | Inspect + LangChain | None (zero-shot) | 59.0% [49.2, 68.1] | 39.2% | 0/30 sys · 5/60 judg | 39.0% | 0.22 (9%) | -1.1 pp | $0.033 |
| `gemini-3.8-flash` | Inspect + LangChain | None (zero-shot) | 58.0% [48.2, 67.2] | 47.1% | 5/30 sys · 16/60 judg | 37.0% | 0.39 (10%) | -21.1 pp | $0.064 |
| `claude-sonnet-5-5` | Inspect + LangChain | None (zero-shot) | 55.0% [45.2, 64.4] | 45.8% | 0/30 sys · 14/60 judg | 50.0% | 0.00 (0%) | -20.0 pp | $0.120 |
