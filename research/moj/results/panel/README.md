# Cross-family panel experiment

This is a routing experiment on practice data, not evidence of a panel improvement.
The final comparison uses the same 61 unique validation pairs for every row.
The full frozen population and coverage failures remain in `validation.json`.

## Reproduce

From `research/moj`:

```sh
python3 -m unittest moj.test_panel moj.test_reference_first -v
python3 -m moj.panel --offline
python3 -m moj.reference_run --offline --bench hardrows
```

`--offline` reconstructs model decisions from recorded requests and answers, then
compares every metric and decision with the saved result. No network call is made.
`--live` sends only previously unanswered requests. Gemini is currently paused by
`provider-holds.json` at the owner's request; recorded Gemini answers still replay.
Do not remove that hold without the owner's explicit release.

## Design and integration

- `moj.panel.route_item(ctx, config, stage1, fallback)` checks an explicit dataset
  reference before stage 1 or any panel call. A confident reference verdict stops.
  Otherwise stage 1 runs, and only confidence below 0.7 enters the panel.
- Three independent families receive the same short forced-choice prompt in both
  orders: gpt-6-luna, gemini-3.8-flash, and the local Haiku CLI. All request low
  reasoning effort. Luna sends no temperature parameter. Haiku resolves to
  `claude-haiku-5-5` in the saved CLI usage.
- A member's two order answers map back to the original A/B labels. Order
  inconsistency contributes a half vote. Majority voting averages these member
  votes. Agreement is the winning share of the six order votes; it is not a
  calibrated probability of correctness.
- Weighted voting is no-intercept logistic regression, fixed L2=1. Five-fold
  out-of-fold tuning predictions are recorded. Final weights fit the complete
  eligible tuning half, never validation labels. A negative weight is permitted. Folds follow groups.
The exported weighted config is fitted on split v2; older fits are not served.
- The cascade's initial pair is selected on tuning accuracy, then tuning cost.
  A third family is used only on disagreement, order ties, or missing output.
  Cascade costs are counterfactual replay costs using the exact full-panel calls;
  all three members were collected to compare all variants on identical answers.

The four catalogue registrations are appended to `moj/experts.py`. Existing
`moj.score` cannot perform the within-panel weighted vote or reference-first
priority. Use the explicit `entrypoint` in `configs/panel-*.json`, or the isolated
CLI above. The generic collector does not know the frozen low-confidence mask;
`panel` abstains unless `ctx.item['low_confidence']` is explicitly true. The new
runner supplies that flag. Existing shared signals and recordings are untouched.

`clients_s2.py` did not exist when this work started, so `panel_clients.py` contains
minimal clients. It intentionally continues using its own recordings and spend
ledger after the other helper's clients land. Only the three authorized key files
are read, inside the request. Haiku uses the existing local CLI authentication.

## Population and limitations

The initial data snapshot is commit `26469740`. The files contain 168 source rows,
including five repeated mmeval IDs. After verifying duplicate metadata agrees,
each benchmark/id is counted once: 163 unique items, 81 validation items under `moj-split-v2`.
`population-v2.json` freezes the current group split and the original routing mask;
`inputs.json` preserves the routed judge inputs across later dataset expansions.
The original `population.json` is retained as historical split-v1 metadata.
The common baseline cohort contains 61 validation items; 16 are low confidence.
Full-population scores explicitly count missing fallback coverage as failure.
Items without a recorded promptfoo fallback retain explicit missing coverage.
These coverage failures are not panel errors; counts are in `COMPARISON.md`. Matched-cohort results are the fair comparison.

A recorded `s1p` probability is used where available, with low confidence defined
as max(p, 1-p) < 0.7. Otherwise disagreement among recorded baseline order games
marks the item low confidence. Outside the low subset, the recorded `s1p` verdict
or promptfoo fallback is retained. This is explicitly a partial-recording routing
simulation, not a newly collected System-1 pass over every practice item.

There are 26 routed items, with 10 tuning and 16 validation items. Two model
responses violate the exact one-token contract, one in tuning and one in
validation. They are preserved and never asked again. Incomplete panels fail
closed. Weighted fitting therefore uses nine complete tuning panels.

The metric follows the harness: a correct verdict earns 1, an explicit tie earns
0.5, and a missing/invalid answer earns 0. Baselines use the mean of their recorded
order-game scores. The panel uses its aggregate verdict. Intervals are 95 percent
percentile bootstrap intervals over prompt groups, with 10,000 resamples and fixed
seed 20261013. An all-correct or all-wrong cell uses a Wilson interval instead of
a degenerate bootstrap interval. The 16-item subset is too small for a strong
comparative claim. No variant was selected using validation accuracy.

## Cost and safety accounting

Every submission has a durable request hash, request body, answer or safe error,
submission number, and timing. Provider headers and keys are never recorded.
`spend.jsonl` reserves before submission, settles known costs, and retains unknown
reservations. It covers both panel and reference calls under one $10 gate.
Pacing is Luna 8, Gemini 2, Haiku 2, Jev 3 (below the authorized maximum of 8). Returned answers, including malformed
ones, are never repeated. No-answer retries stop after three submissions across
process restarts. Gemini 429 waits are 60, 120, 240 seconds; 402 stops Gemini and
records later skipped requests for deterministic offline replay.

All actual experiment calls succeeded on submission one. Panel cost is estimated
from usage using the existing ledger harness rates: Luna input/cache/output
0.10/0.01/0.50 USD per million tokens; Gemini input/output 0.75/3.75, including
thinking tokens. Haiku uses CLI-reported USD. These are evaluation accounting
rates, not invoices. Existing pairwise baselines omit some costs and call counts.
Unknown total costs remain unknown; `known_usd_per_100` is a lower bound, never a
complete cost. Incremental panel cost is fully recorded and shown separately.
The Jev gateway gives no price: its reserved amount is not a measured charge.

## Evidence motivating the hypotheses

[PoLL](https://arxiv.org/abs/2404.18796) reports a diverse panel outperforming a
large single judge at over seven times lower cost in its evaluated settings.
[Judge design choices](https://arxiv.org/html/2610.05094v1) reports 35 to 37 percent
lower deviation from aggregation in scalar rating tasks and 36.5 percent model
switch disagreement on ambiguous classification items. Those are motivation,
not predicted effect sizes for these practice pairs. The supplied research cards,
particularly Card 17, also record counterexamples where a single member wins.
