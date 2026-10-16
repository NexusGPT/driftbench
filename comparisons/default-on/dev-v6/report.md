# Combined exploratory development comparison

exploratory development iteration v6 after inspecting v5 results; never held-out confirmation.
One recorded decision per item and variant. Returned ties, blocks and unparsed answers count wrong. Transport errors and missing recordings are missing.
Diagnostic only: false.
Holm family: 44 unique predeclared cells, including unmeasured cells at p=1.

## Primary evidence: new product versus shipped default

Both use identical Haiku API model and frozen transport settings.

| Dataset | Comparator | Matched | Correct new / comparator | W/L | Raw p | Holm p | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| judgebench-pilot20 | shipped-default | 20/20 | 16 / 17 | 2/3 | 1 | 1 | TIE |
| mmeval-pilot20 | shipped-default | 20/20 | 16 / 16 | 1/1 | 1 | 1 | TIE |
| judgebench-recipe-dev150 | shipped-default | 150/150 | 123 / 109 | 16/2 | 0.00131226 | 0.0498657 | WIN |
| rubricbench-pilot20 | shipped-default | 20/20 | 16 / 15 | 2/1 | 1 | 1 | TIE |
| verify-practice120 | shipped-default | 120/120 | 89 / 59 | 32/2 | 6.93835e-08 | 3.05288e-06 | WIN |
| verify-dev95 | shipped-default | 95/95 | 58 / 31 | 29/2 | 4.62867e-07 | 1.94404e-05 | WIN |
| writing-dev30 | shipped-default | 30/30 | 13 / 14 | 1/2 | 1 | 1 | TIE |
| writing-practice203 | shipped-default | 0/203 | 0 / 0 | 0/0 | 1 | 1 | NOT MEASURED |
| inspect-fact-practice120 | shipped-default | 120/120 | 120 / 117 | 3/0 | 0.25 | 1 | TIE |
| inspect-qa-practice120 | shipped-default | 120/120 | 120 / 117 | 3/0 | 0.25 | 1 | TIE |
| inspect-panel-practice120 | shipped-default | 120/120 | 118 / 103 | 17/2 | 0.000728607 | 0.0284157 | WIN |
| inspect-borderline-practice96 | shipped-default | 96/96 | 96 / 96 | 0/0 | 1 | 1 | TIE |
| deepeval-relevancy-v3-120 | shipped-default | 120/120 | 118 / 110 | 10/2 | 0.0385742 | 1 | TIE |
| deepeval-knowledge-v3-120 | shipped-default | 120/120 | 120 / 120 | 0/0 | 1 | 1 | TIE |
| inspect-panel-practice240 | shipped-default | 240/240 | 234 / 203 | 35/4 | 3.35316e-07 | 1.44186e-05 | WIN |

## unverified historical (lane report)

Every comparator in this table is **unverified historical (lane report)**. No matched physical settings are claimed.

| Dataset | Comparator | Matched | Correct new / comparator | W/L | Raw p | Holm p | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| judgebench-pilot20 | promptfoo | 20/20 | 16 / 19 | 1/4 | 0.375 | 1 | TIE |
| judgebench-pilot20 | ledger | 20/20 | 16 / 19 | 0/3 | 0.25 | 1 | TIE |
| mmeval-pilot20 | promptfoo | 20/20 | 16 / 16 | 1/1 | 1 | 1 | TIE |
| mmeval-pilot20 | ledger | 20/20 | 16 / 14 | 3/1 | 0.625 | 1 | TIE |
| judgebench-recipe-dev150 | driftbench | 150/150 | 123 / 124 | 8/9 | 1 | 1 | TIE |
| judgebench-recipe-dev150 | promptfoo | 150/150 | 123 / 113 | 15/5 | 0.0413895 | 1 | TIE |
| judgebench-recipe-dev150 | deepeval | 150/150 | 123 / 119 | 13/9 | 0.523467 | 1 | TIE |
| judgebench-recipe-dev150 | inspect | 150/150 | 123 / 110 | 15/2 | 0.00234985 | 0.0822449 | TIE |
| judgebench-recipe-dev150 | langfuse | 150/150 | 123 / 105 | 22/4 | 0.000533521 | 0.0213408 | WIN |
| judgebench-recipe-dev150 | langwatch | 150/150 | 123 / 119 | 11/7 | 0.480682 | 1 | TIE |
| rubricbench-pilot20 | promptfoo | 20/20 | 16 / 14 | 3/1 | 0.625 | 1 | TIE |
| rubricbench-pilot20 | pair-ledger | 20/20 | 16 / 16 | 1/1 | 1 | 1 | TIE |
| verify-practice120 | driftbench-fable-commit | 120/120 | 89 / 103 | 2/16 | 0.00131226 | 0.0498657 | LOSS |
| verify-dev95 | driftbench-fable-commit | 94/95 | 58 / 73 | 3/18 | 0.00148964 | 0.053627 | TIE |
| writing-dev30 | promptfoo | 30/30 | 13 / 10 | 3/0 | 0.25 | 1 | TIE |
| writing-dev30 | pair-ledger | 30/30 | 13 / 18 | 0/5 | 0.0625 | 1 | TIE |
| writing-dev30 | reader-first-c50b2dc3 | 30/30 | 13 / 22 | 2/11 | 0.0224609 | 0.741211 | TIE |
| inspect-fact-practice120 | lane-best | 120/120 | 120 / 119 | 1/0 | 1 | 1 | TIE |
| inspect-qa-practice120 | lane-best | 120/120 | 120 / 119 | 1/0 | 1 | 1 | TIE |
| inspect-panel-practice120 | lane-best | 120/120 | 118 / 120 | 0/2 | 0.5 | 1 | TIE |
| deepeval-relevancy-v3-120 | lane-best | 118/120 | 116 / 118 | 0/2 | 0.5 | 1 | TIE |
| deepeval-relevancy-v3-120 | deepeval | 120/120 | 118 / 119 | 1/2 | 1 | 1 | TIE |
| deepeval-knowledge-v3-120 | lane-best | 120/120 | 120 / 120 | 0/0 | 1 | 1 | TIE |
| deepeval-knowledge-v3-120 | deepeval | 120/120 | 120 / 115 | 5/0 | 0.0625 | 1 | TIE |
| inspect-panel-practice240 | inspect-panel-practice240-split-r2 | 240/240 | 234 / 239 | 1/6 | 0.125 | 1 | TIE |
| inspect-panel-practice240 | inspect-panel-practice240-split | 240/240 | 234 / 237 | 2/5 | 0.453125 | 1 | TIE |
| inspect-panel-practice240 | inspect-panel-practice240-theirs | 240/240 | 234 / 240 | 0/6 | 0.03125 | 1 | TIE |
| verify-dev95 | driftbench-v5 | 94/95 | 58 / 77 | 2/21 | 6.60419e-05 | 0.00270772 | LOSS |
| verify-practice120 | driftbench-v5 | 120/120 | 89 / 100 | 4/15 | 0.0192108 | 0.653168 | TIE |

Runner model pins are source evidence only; actual per-call model and CLI/API mix remain unverified where result rows omit them. Neither source request-key scheme binds transport.
Procedures and populations remain separate; no repeated judgments are pooled.
Missing historical decisions remain missing. Verify v5 dev has 94/95 recordings.
Writing practice203 remains planned and unmeasured. Its p-value is 1.
Exact matched IDs, full freeze hashes, comparator source hashes and procedure metadata are in the JSON report.
