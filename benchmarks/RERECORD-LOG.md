# Bench re-record log

## 2026-10-15: default-on-v7 client settings, haiku output room

The default-on-v7 change (PR 371) changes the client settings of every recorded model, so all 42 recordings (14 slices for haiku, gpt-6-luna and gemini-3.5-flash-lite) were recorded again. The first run was diagnosis only: nothing was committed and no floor changed.

In that first run, 8 haiku answers stopped at the recorder's output limit of 1,024 tokens. Haiku 5.5 thinks by default, and its thinking is drawn from the same limit as the answer, so these answers ended before their JSON closed and scored as inconclusive:

| Slice | Case |
|---|---|
| fresh-reference | fresh-reference-023, fresh-reference-077 |
| map-reference | map-langfuse-reference-052, map-langfuse-reference-088, map-langfuse-reference-172 |
| map-rubric | map-promptfoo-rubric-145 |
| planted-verify | verify-bank-000/clean, verify-bank-090/defect |

The haiku recorder (`benchmarks/record.ts`) now uses the default judge's output room, `outputRoom` from `@agent-nexus/driftbench-judges` (answer budget plus thinking room), instead of its own limits of 1,024 and 4,096 tokens. This fixes an instrument limit, not a judgement: the prompt, parser and criteria are unchanged. The 14 haiku slices are recorded again with the fixed recorder, and both runs are reported below.

| Slice | Floor | First run (1,024 limit) | Second run (output room) |
|---|---|---|---|
| fresh-reference | 189/192 | 188 | 190 |
| fresh-rubric | 188/192 | 192 | 191 |
| hard-factuality | 119/120 | 118 | 118 |
| hard-goal | 106/120 | 120 | 120 |
| hard-pii | 118/120 | 120 | 120 |
| hard-rubric | 117/120 | 120 | 120 |
| heldout-factuality | 71/72 | 70 | 70 |
| heldout-goal | 65/72 | 72 | 72 |
| heldout-pii | 72/72 | 72 | 70 |
| heldout-rubric | 71/72 | 72 | 72 |
| map-reference | 173/180 | 174 | 176 |
| map-rubric | 156/156 | 152 | 153 |
| planted-rubric | 117/120 | 119 | 119 |
| planted-verify | 189/190 | 188 | 189 |

Second run: no haiku answer stopped at its limit (the largest used 1,757 output tokens). Four slices stay below their floor (hard-factuality, heldout-factuality, heldout-pii, map-rubric); their changed cases are judgement errors, several of them unstable between the two runs. The floors are an owner decision.

Owner ruling, 2026-10-16: "Ok lower in this specific case". The four haiku floors are set to the second run's scores: hard-factuality 118/120 (was 119), heldout-factuality 70/72 (was 71), heldout-pii 70/72 (was 72), map-rubric 153/156 (was 156). The earlier floors move to the floor history. Every other floor is unchanged, and all 42 recordings hold their floors in `pnpm bench replay --slice all --check-floor`.
