---
title: "The statistics behind results"
summary: "Intervals, the design effect, paired tests, false discovery rate control, the noise floor, power and sample size, and variance components, and where each one is printed."
commands:
  - compare
see_also:
  - results-compare
  - results-ci
  - results-scorecard
  - results-monitor
next:
  - results-drift-recovery
---

## What it is

One run proves nothing. driftbench repeats runs, puts an interval on every rate, and compares two versions
with paired tests. Every function below ships in `@agent-nexus/driftbench-stats` and is checked against
reference values computed with scipy and numpy (`packages/stats/test/reference`). There is no `stats`
command: the statistics appear in `report`, `compare`, `ci`, `monitor`, `holdout score`, `campaign plan`
and `pilot`.

**Units.** A golden is one spec in one mode (one perturbation in P) over every repeat; it passes when every
repeat passes. One conversation, or one task, is one cluster: its blocks and its repeats are never counted
as independent samples.

**Intervals** (all two-sided at 95%):

| Method | Used for |
|---|---|
| Wilson score interval | a rate over independent units: goldens, holdout conversations, aggregates, recovery shares |
| Clopper-Pearson exact | library only (`clopperPearson`) |
| Wilson on n_eff | a rate over clusters: the scorecard's pass rate over specs with repeats, and block accuracy over conversations. Wilson on the effective units `n_eff` (units divided by the design effect from the spread of the cluster rates), with the Student t quantile on clusters minus one. The cell prints `n_eff` and the design effect. Method name `wilson, design effect` |
| hierarchical Beta-Bernoulli | the suite headline, the pass rate of a whole suite: the mean over goldens (every golden weighs the same) with a model that learns from the spread between goldens how far the runs of one golden move together. No sampling, no seed. Method name `hierarchical` |
| cluster bootstrap | anything pooled over blocks (block accuracy, the compounding index): 2000 percentile resamples of whole clusters, seed 1 |
| Wilson raised to k | pass^k and pass@k: the Wilson bounds of the per-run rate raised to k, widened to contain the value; runs that did not complete count both ways |
| Newcombe method 10 | the paired difference of two rates (baseline minus candidate) |

**Design effect.** `1 + (m - 1) rho` for clusters of size m with intraclass correlation rho; the effective
sample size is n divided by it. Repeats of one conversation that agree add less information than
independent runs.

**Which interval to quote.** A naive Wilson interval reads every run as independent. On simulated suites of
correlated goldens it held the true rate 73.9% of the time, against the 95% it claims. Wilson on `n_eff` held
it 91.3% (normal quantile) to 93.1% (Student t quantile); the hierarchical interval held it 95.3% (24 cells,
400 suites each). So the suite headline, and any result you publish, uses the hierarchical interval; a rate
of one conversation or one block, and interactive output, use Wilson on `n_eff`. The headline needs at least
two goldens: one golden has no spread to measure and prints no interval.

**The suite headline** (`report`, per mode): the mean over goldens with its interval, then `n_eff` (the runs
the clustering is worth), the design effect, the smallest drop two suites like it detect at 80% power, and
the share of runs that did not complete (and, when a run carries those states, the share blocked or not
run). The share is printed beside the rate so that dropping broken runs cannot raise it unseen.

**Paired tests** (in `compare` and `ci`):

* McNemar on the discordant goldens, always exact in `compare` and `ci`, printed `McNemar exact`.
* Wilcoxon signed-rank on the drift count per golden.
* Benjamini-Hochberg false discovery rate control across criteria at `--q` (default 0.05), before any
  criterion is called regressed. driftbench uses Benjamini-Hochberg here, not Holm: no product command
  applies a Holm correction (Holm p values appear only in the benchmark comparison scripts under
  `comparisons/`).

**The parity rule.** Non-inferior when the upper bound of the regression effect is below the margin for
the all-pass flag and every gating criterion that is not underpowered, and no flag family is new. A
criterion on fewer than `--min-goldens` (30) goldens is underpowered and left out unless `--strict`. Zero
regressed goldens in one run is not parity: it is one draw.

**Power and sample size** (printed per criterion and for the all-pass flag by `compare`):

| Number | Meaning |
|---|---|
| floor | `marginFloor(n)`: the smallest margin n goldens can show when nothing changed; 27.75 points for 10 goldens, 14.3 for 23 |
| drop seen | `mde({ n, baselineRate, power: 0.8 })`: the smallest true drop the goldens detect at 80% power |
| for 10 | `goldensNeeded(0.1, discordance)`: the goldens a 10 point margin needs at 80% power (35 at zero discordance) |

`--margin auto` is the smallest half point at which the baseline compared with itself is non-inferior.
Before a campaign, `campaign plan` prints the minimum detectable effect for the chosen repeats
(`--rho` passes a measured intraclass correlation; 0 counts repeats as independent, which is optimistic).

**The noise floor and variance components** (`driftbench pilot`, and the scorecard's "Variance pilot"):
`varianceComponents` splits the variance of the outcome across nested levels (cell, conversation,
wording, repeat) with the ANOVA estimator of a nested random-effects model; `icc` turns it into the rho of
each level; `repeatsForFloor` gives the repeats per block that keep run-to-run noise under a floor;
`neymanAllocation` spreads conversations across cells in proportion to size times spread. The spread view
flags a cell whose wording range is above 20 points and above its run-to-run noise floor.

**Over time** (`monitor`): CUSUM, Page-Hinkley and the two-sample Kolmogorov-Smirnov test.

**Judges**: Cohen's kappa and Krippendorff's alpha (`judge calibrate`, `queue agreement`).

**Coverage of a sample** (`space complete`): Good-Turing, Chao coverage and Chao1, Hill numbers.

## When to use it

Read this before trusting a pass rate, choosing a margin, or deciding how many goldens and repeats a suite
needs. The rule of thumb the numbers give: to tighten a gate, add goldens, not repeats.

## Commands and every option

This topic's command is `driftbench compare`, which prints most of these numbers. Its options, with
defaults (details in `results-compare`): `--baseline <campaign>`, `--candidate <campaign>`,
`--store <file>` (all required), `--margin <points|auto>` (`auto`), `--min-goldens <n>` (`30`),
`--strict` (off), `--mode <modes>` (every mode both ran), `--q <rate>` (`0.05`), `--json` (off),
`--pairwise <criterion.yaml>` (none), `--pairwise-judge <kind>` (`openai`), `--pairwise-reference <file>`
(none). Global: `--plugin <module>`.

## Inputs

Two campaigns of one store for the paired numbers; one campaign for the intervals of `report`.

## Outputs and how to read them

In `compare` text: `95% interval` columns are Wilson (per side) and Newcombe (effect); `p` is McNemar
exact; `q` is the Benjamini-Hochberg adjusted p; `floor`, `drop seen` and `for 10` are the planning
numbers. In the scorecard, "How the numbers are made" lists the method of each interval. In `report` text and in the
scorecard summary, the line `Suite pass rate, mode F: ...` is the suite headline described above.

## Worked example

The same six conversations twice, then the comparison at a fixed margin with every criterion gating. No
model is called.

```sh
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --repeats 2 --store stats.db --campaign c-a
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --repeats 2 --agent-version v2 --store stats.db --campaign c-b
driftbench compare --baseline c-a --candidate c-b --store stats.db --margin 15 --strict # exit 1
```

```text
$ driftbench compare --baseline c-a --candidate c-b --store stats.db --margin 15 --strict
Baseline c-a (function:acme-sales) against candidate c-b (function:acme-sales (variant v2)).
Paired: 23 goldens (one golden in one mode, one perturbation in P), modes T, F, P; 0 goldens not paired. Margin 15.0 points.

All repeats pass, per golden:
  side       passing   rate    95% interval
  baseline   23 of 23  100.0%  [85.7%, 100.0%]
  candidate  23 of 23  100.0%  [85.7%, 100.0%]
  Both pass 23, regressed 0, improved 0, both fail 0. McNemar exact p = 1.0000.
  Effect, baseline minus candidate: 0.0 points, interval [-14.3, +14.3] (Newcombe, paired).
  Planning: 23 goldens can show a margin of 14.3 points at best; they detect a drop of 30.6 points at 80% power; a 10 point margin needs 35 goldens.
Drift count per golden (mean over repeats): baseline 0.00, candidate 0.00; Wilcoxon signed-rank p = 1.0000 (exact, 0 goldens differ).

Criteria: McNemar exact per criterion, Benjamini-Hochberg across 13 criteria at q 0.05. Effect in points, baseline minus candidate. A gating criterion on fewer than 30 goldens is underpowered, and gates anyway (--strict). Floor: the smallest margin its goldens can show; drop seen: the smallest drop they detect at 80% power; for 10: the goldens a 10 point margin needs.
  criterion  gating  goldens  regressed  improved  p       q       effect  interval        margin        floor  drop seen    for 10  verdict
  budget     yes     7        0          0         1.0000  1.0000  0.0     [-35.4, +35.4]  underpowered  35.4   67.6 points  35
  cards      yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  end_state  yes     12       0          0         1.0000  1.0000  0.0     [-24.2, +24.2]  underpowered  24.2   49.3 points  35
  flow       yes     1        0          0         1.0000  1.0000  0.0     [-79.3, +79.3]  underpowered  79.3   none         35
  forbidden  yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  guards     yes     9        0          0         1.0000  1.0000  0.0     [-29.9, +29.9]  underpowered  29.9   59.0 points  35
  lang       yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  ledger     yes     19       0          0         1.0000  1.0000  0.0     [-16.8, +16.8]  underpowered  16.8   35.5 points  35
  must       yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  must_not   yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  pii        yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  stage      yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  tools      yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35

Verdict: NOT SHOWN NON-INFERIOR.
  budget: the upper bound 35.4 points is not below the margin, over 7 goldens (0 regressed, 0 improved)
  end_state: the upper bound 24.2 points is not below the margin, over 12 goldens (0 regressed, 0 improved)
  flow: the upper bound 79.3 points is not below the margin, over 1 golden (0 regressed, 0 improved)
  guards: the upper bound 29.9 points is not below the margin, over 9 goldens (0 regressed, 0 improved)
  ledger: the upper bound 16.8 points is not below the margin, over 19 goldens (0 regressed, 0 improved)
(exit 1)
```

Nothing changed between the two campaigns, yet with `--strict` the criteria decided on 1, 7, 9, 12 or 19
goldens gate, their floors are above 15 points, and the verdict is not shown non-inferior: the floor
column is the number to read before choosing a margin.

## Common errors

| Symptom | Cause and fix |
|---|---|
| not shown non-inferior on an unchanged agent | the margin is below the floor of the goldens. Add goldens; more repeats do not move the floor |
| a criterion reads `underpowered` | it was decided on fewer than `--min-goldens` goldens; it is left out unless `--strict` |
| a p value below 0.05 but no `regressed` verdict on the criterion | the Benjamini-Hochberg adjusted q is above `--q` |
| a carried golden is missing from the pairs | carried results are never paired: they agree with the baseline by construction |
