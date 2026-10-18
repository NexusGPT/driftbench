# Factual audit research variant

`ours-audit-checked` compares each fact requested by the task against its trusted reference.
It first compares the number of wrong or missing requested facts. Unsupported
additional factual claims break a tie in requested-fact coverage. The complete
prompt is `AUDIT_SYSTEM` in `audit.ts`.

The variant uses the same two-order agreement protocol as the existing judges.
It requests a fact audit before the verdict, checks exact values and units, and
keeps partially correct answers comparable. A winner must agree across both
candidate orders. A primary tie triggers a structured fact audit in both orders.
The code computes the relative winner from those fact rows, so the fallback
model cannot confuse the winner with its pass/fail label. A fallback disagreement,
invalid output or failed call remains a tie. `ours-audit` is the primary-only ablation.

Only task, reference and candidate texts enter the prompt. Item IDs, generator
error counts and labels do not enter it. No length preference or product-specific
parser determines the winner. The competitor's template and the production judge
stay unchanged.

## Run and replay

Run from the repository root:

```sh
node --import tsx comparisons/langwatch/pairwise/measure.mts ours-audit-checked --model haiku --set hard.json --concurrency 1 --cap-usd 0.50
node --import tsx comparisons/langwatch/pairwise/measure.mts ours-audit-checked --model haiku --set set.json --concurrency 1 --cap-usd 0.50
node --import tsx comparisons/langwatch/pairwise/measure.mts ours-audit-checked --model haiku --set hard.json --concurrency 1 --cap-usd 0 --replay-only
node --import tsx comparisons/langwatch/pairwise/measure.mts ours-audit-checked --model haiku --set set.json --concurrency 1 --cap-usd 0 --replay-only
python3 comparisons/langwatch/pairwise/score.py
pnpm exec vitest run --config comparisons/langwatch/pairwise/vitest.config.ts --maxWorkers=2
```

Each model call is recorded in `recorded/audit-calls.jsonl`. Its SHA-256 cache key
includes the full user prompt, system prompt, model and CLI settings. Resume
replays matching calls. `--cap-usd` limits fresh spend for that invocation, with
a reservation for each call. Recorded historical spend plus new calls must also
fit the task's cumulative 8 USD budget. Missing replay entries stop a replay
without a model call.

The pair record is saved after every completed pair, including reasoning and
the keys of both calls. `spentUsd` includes replayed call costs for comparable
cost per item; `freshSpendUsd` reports only this invocation's new costs. Errors
without metering receive a conservative charge equal to the call reservation.
The score table counts missing pairs against the full set and shows coverage.

## Scope of the evidence

These are synthetic telecom fact sets. The hard set is the tuning set requested
in the brief. The easy set checks regressions after the prompt is frozen. Neither
is an independent real-world evaluation of the proposed policy.

The hard-set generator counts a long fluent answer's availability error, while
its prose also contains unsupported claims. Requested-fact priority therefore
needs to stay explicit. This variant does not implement a universal rule that
adds every unsupported extra to every wrong requested fact. A different rubric
may require different severity or completeness weights.

The replayed shipped losses and their item IDs are in `losses.md`. Final measured
scores and costs are in `recorded/results.md`.

## Measured Haiku results

| Variant | Set | Correct | Ties | Recorded USD / 100 pairs |
|---|---|---|---|---|
| ours | hard.json | 106/120 | 14 | 0.052081 |
| ours | set.json | 120/120 | 0 | 0.029976 |
| theirs | hard.json | 119/120 | 1 | 0.039216 |
| theirs | set.json | 120/120 | 0 | 0.040487 |
| ours-audit | hard.json | 119/120 | 1 | 0.078805 |
| ours-audit | set.json | 110/120 | 10 | 0.058450 |
| ours-audit-checked | hard.json | 120/120 | 0 | 0.079854 |
| ours-audit-checked | set.json | 120/120 | 0 | 0.065072 |

All rows cover the full set. Cost uses the recorded historical cost attributable
to each pair, including replayed calls. The two audit variants share primary
recordings, so their costs must not be added to obtain billed spend. The checked
procedure uses the same frozen prompts on both sets.
