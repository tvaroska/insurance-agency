| Model | Harness | Learning mechanism | `pass@1` | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |
| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |
| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |
| `gemini-4-hydrogen` | Inspect + LangChain | Domain skill (SOP) | 75.0% (0.84 mean) | n/a (k=1) | 0/6 sys · 0/12 judg | 20.0% | 0.40 (10%) | n/a | $0.229 |
| `gemini-4-hydrogen` | Inspect + LangChain | None (zero-shot) | 65.0% (0.79 mean) | n/a (k=1) | 0/6 sys · 0/12 judg | 25.0% | 0.50 (15%) | n/a | $0.280 |
