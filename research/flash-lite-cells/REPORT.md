# gemini-3.5-flash-lite cells

Audit date: 2026-10-14. Each cell is its own model cell. No Gemini 3.8 Flash number is used or reported (dropped by the owner).
No new run was needed: all five sealed benchmarks already hold a complete flash-lite result for both contestants. This lane made no paid call.

driftbench is the pair/criterion ledger contestant. Verdicts are the preregistered ones. Multiplicity (Holm over the 18-cell family) is pending for every cell.

| Benchmark | Unit and n | driftbench | promptfoo | Difference, wins / losses, p | Verdict | Source file | Requests (answered + failed) | Cap headroom |
|---|---|---|---|---|---|---|---|---|
| JudgeBench | 270 pairs | 215/270, 79.63% | 215/270, 79.63% | 0.00, 26 / 26, p 1 | TIE (pending Holm) | docs/assets/data/sealed/judgebench.json | 1,835 (1,832 first tries + 3 retries) | in total row |
| MM-Eval | 600 pairs | 81.42% | 83.75% | -2.33 points [-4.25, -0.42], 34 / 54, p 0.042 | pending Holm | docs/assets/data/sealed/mm-eval.json | 2,443 (2,435 answered + 8 failed tries, all recovered) | in total row |
| RubricBench | 790 pairs, 1,580 games | 1,276 correct, 80.76% | 1,277 correct, 80.82% | -0.06 points, 110 / 111, p 1 | pending Holm | docs/assets/data/sealed/rubricbench-flash-lite.json | 3,942 unique calls | in total row |
| verify (TEST) | 221 items | 138/221, 62.44% | 127/221, 57.47% | +4.98 points [-2.24, 11.87], 39 / 28, p 0.2215 | TIE (pending Holm) | examples/ledger-verify/REPORT.md on PR 339 (research/ledger-verify) | 2,131 (2,107 answered + 24 transport failures) | in total row |
| writing | 173 pairs, 346 games | 204 correct, 58.96% (44 ties) | 209 correct, 60.40% | -1.45 points, 42 / 47, p 0.672 | pending Holm | docs/assets/data/sealed/writing.json | 1,339 (1,315 settled + 24 network failures before recovery) | in total row |
| Total | | | | | | | 11,690 | 150,000 - 11,690 = 138,310 |

Notes:
- All flash-lite requests of the five cells fall on 2026-10-13 (UTC). Daily-cap headroom is taken against the 150,000 cap given by the lead.
- The same day also holds the separate hard evaluation flash-lite cell (6,560 unique requests, comparisons/ledger-hard/flash-lite). If counted, the day total is 18,250 and the headroom is 131,750.
- Repo dossiers (research/ledger-wp, research/ledger-rb) quote an owner-supplied limit of 10,000 requests per model per day for Gemini. That differs from the 150,000 figure. The flash-lite day total exceeds 10,000 in both countings. The two figures are not reconciled here.
- The verify flash-lite cell is complete on PR 339 (138 vs 127 official, 158 vs 142 audited, replay checks in examples/ledger-verify/lite/). The sealed verify.json on main does not yet contain it; it lands when PR 339 merges.
- Request counts come from the saved call journals on each research branch: judgebench calls.jsonl (start/finish pairs), MM-Eval recordings/calls.jsonl plus the dossier retry record, RubricBench live/calls-*.jsonl, verify lite/receipts/calls.jsonl, writing flash-lite-spend.jsonl (reserve records).
