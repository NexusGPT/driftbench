# Combined exploratory development comparison

exploratory development comparison; never held-out confirmation.
One recorded decision per item and variant. Returned ties, blocks and unparsed answers count wrong. Transport errors and missing recordings are missing.
Diagnostic only: false.
Holm family: 44 unique predeclared cells, including unmeasured cells at p=1.

## Primary evidence: new product versus shipped default

Both use identical Haiku API model and frozen transport settings.

| Dataset | Comparator | Matched | Correct new / comparator | W/L | Raw p | Holm p | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| judgebench-pilot20 | shipped-default | 20/20 | 16 / 17 | 2/3 | 1 | 1 | TIE |
| mmeval-pilot20 | shipped-default | 20/20 | 16 / 16 | 1/1 | 1 | 1 | TIE |
| judgebench-recipe-dev150 | shipped-default | 150/150 | 123 / 109 | 16/2 | 0.00131226 | 0.0485535 | WIN |
| rubricbench-pilot20 | shipped-default | 20/20 | 16 / 15 | 2/1 | 1 | 1 | TIE |
| verify-practice120 | shipped-default | 120/120 | 56 / 59 | 13/16 | 0.711071 | 1 | TIE |
| verify-dev95 | shipped-default | 95/95 | 20 / 31 | 3/14 | 0.0127258 | 0.445404 | TIE |
| writing-dev30 | shipped-default | 30/30 | 13 / 14 | 1/2 | 1 | 1 | TIE |
| writing-practice203 | shipped-default | 0/203 | 0 / 0 | 0/0 | 1 | 1 | NOT MEASURED |
| inspect-fact-practice120 | shipped-default | 120/120 | 120 / 117 | 3/0 | 0.25 | 1 | TIE |
| inspect-qa-practice120 | shipped-default | 120/120 | 120 / 117 | 3/0 | 0.25 | 1 | TIE |
| inspect-panel-practice120 | shipped-default | 120/120 | 118 / 103 | 17/2 | 0.000728607 | 0.0276871 | WIN |
| inspect-borderline-practice96 | shipped-default | 96/96 | 96 / 96 | 0/0 | 1 | 1 | TIE |
| deepeval-relevancy-v3-120 | shipped-default | 120/120 | 118 / 110 | 10/2 | 0.0385742 | 1 | TIE |
| deepeval-knowledge-v3-120 | shipped-default | 120/120 | 120 / 120 | 0/0 | 1 | 1 | TIE |
| inspect-panel-practice240 | shipped-default | 240/240 | 234 / 203 | 35/4 | 3.35316e-07 | 1.34126e-05 | WIN |

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
| judgebench-recipe-dev150 | inspect | 150/150 | 123 / 110 | 15/2 | 0.00234985 | 0.0845947 | TIE |
| judgebench-recipe-dev150 | langfuse | 150/150 | 123 / 105 | 22/4 | 0.000533521 | 0.0208073 | WIN |
| judgebench-recipe-dev150 | langwatch | 150/150 | 123 / 119 | 11/7 | 0.480682 | 1 | TIE |
| rubricbench-pilot20 | promptfoo | 20/20 | 16 / 14 | 3/1 | 0.625 | 1 | TIE |
| rubricbench-pilot20 | pair-ledger | 20/20 | 16 / 16 | 1/1 | 1 | 1 | TIE |
| verify-practice120 | driftbench-fable-commit | 120/120 | 56 / 103 | 2/49 | 1.17861e-12 | 4.95017e-11 | LOSS |
| verify-dev95 | driftbench-fable-commit | 94/95 | 20 / 73 | 1/54 | 3.10862e-15 | 1.33671e-13 | LOSS |
| writing-dev30 | promptfoo | 30/30 | 13 / 10 | 3/0 | 0.25 | 1 | TIE |
| writing-dev30 | pair-ledger | 30/30 | 13 / 18 | 0/5 | 0.0625 | 1 | TIE |
| writing-dev30 | reader-first-c50b2dc3 | 30/30 | 13 / 22 | 2/11 | 0.0224609 | 0.763672 | TIE |
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
| verify-dev95 | driftbench-v5 | 94/95 | 20 / 77 | 0/57 | 1.38778e-17 | 6.10623e-16 | LOSS |
| verify-practice120 | driftbench-v5 | 120/120 | 56 / 100 | 3/47 | 3.70832e-11 | 1.52041e-09 | LOSS |

Runner model pins are source evidence only; actual per-call model and CLI/API mix remain unverified where result rows omit them. Neither source request-key scheme binds transport.
Procedures and populations remain separate; no repeated judgments are pooled.
Missing historical decisions remain missing. Verify v5 dev has 94/95 recordings.
Writing practice203 remains planned and unmeasured. Its p-value is 1.
Exact matched IDs, full freeze hashes, comparator source hashes and procedure metadata are in the JSON report.
