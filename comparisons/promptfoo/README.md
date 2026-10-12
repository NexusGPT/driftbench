# promptfoo comparison: reproducible rows

Scripts, case sets and recordings behind the promptfoo table rows, from this repository. Run from the repository root.

| Row | Command | Paid |
|---|---|---|
| 31 Trajectory: goal success | `npx tsx comparisons/promptfoo/goal-success/compare.mts` (reads the recorded judgments) | no |
| 31, regenerate the cases | `npx tsx comparisons/promptfoo/goal-success/make-cases.mts > comparisons/promptfoo/goal-success/cases.json` | no |
| 31, re-record the judges | `npx tsx comparisons/promptfoo/goal-success/judge.mts haiku` and `... sonnet` (claude command; CLAUDE_BIN overrides the command) | yes, about 0.05 USD in total |

The cases are fictional, generated from a fixed seed. The judges see the reply only, as an output-only rubric grades a block; the comparison does not test a judge that also reads the trace.

## Rows 26 and 28

| Row | Command | Paid |
|---|---|---|
| 26 Function-call validity | `npx tsx comparisons/promptfoo/function-call/measure.mts` (promptfoo's assertion is vendored verbatim under `function-call/vendor/`) | no |
| 28 Tool sequence diagnosis | `npx tsx comparisons/promptfoo/trajectory/measure.mts` (promptfoo's reason text is quoted from `src/assertions/trajectory.ts`) | no |
