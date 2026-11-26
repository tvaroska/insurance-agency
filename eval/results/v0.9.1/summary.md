| Model | Harness | Learning mechanism | `pass@1` | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |
| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |
| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |
| `gemini-4-hydrogen` | Inspect + LangChain | Domain skill (SOP) | 66.0% [46.0, 85.0] | 65.0% | 2/25 sys · 8/55 judg | 23.0% | 0.23 (5%) | -29.0 pp | $0.224 |
| `gemini-4-hydrogen` | Inspect + LangChain | None (zero-shot) | 55.0% [35.0, 75.0] | 51.6% | 6/25 sys · 5/55 judg | 34.0% | 0.42 (11%) | -35.0 pp | $0.255 |
| `claude-sonnet-5-5` | Inspect + LangChain | None (zero-shot) | 45.0% [26.0, 64.0] | 38.3% | 5/25 sys · 8/55 judg | 25.0% | 0.01 (1%) | -35.0 pp | $0.153 |
| `DeepSeek-V4.1-Flash` | Inspect + LangChain | None (zero-shot) | 42.0% [27.0, 57.0] | 22.9% | 15/25 sys · 14/55 judg | 43.0% | 0.67 (11%) | -18.0 pp | $0.038 |
