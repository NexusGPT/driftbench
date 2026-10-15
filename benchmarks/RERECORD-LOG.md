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
| fresh-reference | 189/192 | 188 | pending |
| fresh-rubric | 188/192 | 192 | pending |
| hard-factuality | 119/120 | 118 | pending |
| hard-goal | 106/120 | 120 | pending |
| hard-pii | 118/120 | 120 | pending |
| hard-rubric | 117/120 | 120 | pending |
| heldout-factuality | 71/72 | 70 | pending |
| heldout-goal | 65/72 | 72 | pending |
| heldout-pii | 72/72 | 72 | pending |
| heldout-rubric | 71/72 | 72 | pending |
| map-reference | 173/180 | 174 | pending |
| map-rubric | 156/156 | 152 | pending |
| planted-rubric | 117/120 | 119 | pending |
| planted-verify | 189/190 | 188 | pending |
