| Model | Harness | Learning mechanism | `pass@1` | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |
| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |
| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |
| `gemini-3.8-flash` | Inspect + LangChain | Domain skill (SOP) | 75.0% (0.87 mean) | n/a (k=1) | 0/6 sys · 0/12 judg | 20.0% | 0.15 (10%) | n/a | $0.360 |
| `claude-sonnet-5-5` | Inspect + LangChain | None (zero-shot) | 65.0% (0.78 mean) | n/a (k=1) | 0/6 sys · 1/12 judg | 15.0% | 0.00 (0%) | n/a | $0.186 |
| `DeepSeek-V4.1-Flash` | Inspect + LangChain | None (zero-shot) | 60.0% (0.80 mean) | n/a (k=1) | 0/6 sys · 1/12 judg | 30.0% | 0.80 (15%) | n/a | $0.035 |
| `gemini-3.8-flash` | Inspect + LangChain | None (zero-shot) | 55.0% (0.75 mean) | n/a (k=1) | 0/6 sys · 2/12 judg | 25.0% | 1.10 (20%) | n/a | $0.539 |
