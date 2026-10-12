# promptfoo comparison: reproducible rows

Scripts, case sets and recordings behind the promptfoo table rows, from this repository. Run from the repository root.

| Row | Command | Paid |
|---|---|---|
| 31 Trajectory: goal success | `npx tsx comparisons/promptfoo/goal-success/compare.mts` (reads the recorded judgments) | no |
| 31, regenerate the cases | `npx tsx comparisons/promptfoo/goal-success/make-cases.mts > comparisons/promptfoo/goal-success/cases.json` | no |
| 31, re-record the judges | `npx tsx comparisons/promptfoo/goal-success/judge.mts haiku` and `... sonnet` (claude command; CLAUDE_BIN overrides the command) | yes, about 0.05 USD in total |

The cases are fictional, generated from a fixed seed. The judges see the reply only, as an output-only rubric grades a block; the comparison does not test a judge that also reads the trace.
