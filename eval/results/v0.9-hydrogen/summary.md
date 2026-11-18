| Model | Harness | Learning mechanism | `pass@1` | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |
| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |
| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |
| `gemini-4-hydrogen` | Inspect + LangChain | Domain skill (SOP) | 80.0% [63.0, 94.0] | 75.1% | 0/30 sys · 0/60 judg | 15.0% | 0.23 (5%) | -15.0 pp | $0.224 |
| `gemini-4-hydrogen` | Inspect + LangChain | None (zero-shot) | 68.0% [49.0, 84.0] | 58.4% | 0/30 sys · 1/60 judg | 22.0% | 0.42 (11%) | -27.0 pp | $0.257 |
