# driftbench ci on the Acme sales assistant

`driftbench ci` runs a spec suite on a candidate target, pairs it golden by golden with a baseline campaign, and gates. Fictional data only: the Acme Telecom example agent, no secret, no paid model.

```
driftbench ci --specs <path> --target <adapter[:agent]> --baseline <store file | campaign id> \
  --store <file> --margin <points> [--mode F] [--repeats n] [--budget-usd usd] [--faults <path>] \
  [--flag <family>]... [--out driftbench-ci.json] [--cache] [--json]
```

## What it decides

`ci` runs the candidate campaign, then compares it with the baseline by `compareCampaigns` of `@driftbench/report`: the rule `driftbench compare` applies. On the same pair of campaigns, the two commands give the same verdict and the same exit code.

| Exit | Verdict | compare's verdict | When |
|---|---|---|---|
| 0 | `parity` | non-inferior | The all-pass flag and every gating criterion have a 95% upper bound below the margin, and no flag family fires on the candidate where it did not on the baseline. |
| 1 | `regression` | regressed | There is evidence of a drop: a new flag, a criterion the false discovery rate control keeps, or the all-pass McNemar test below 0.05 with more goldens regressed than improved. |
| 1 | `not-shown-non-inferior` | unproven | No evidence of a drop, but an interval is wider than the margin. This is too few goldens, never a regression. |
| 1 | `incomplete` | none | A candidate cell did not run (stopped by the budget, or pending). |
| 2 | none | none | Bad input: a margin outside (0, 100), an unknown baseline, a fault target without `--faults`, no golden in common. |

- **The unit is the golden**: one spec in one mode (and perturbation), every repeat of it. A golden passes when every repeat passes. Repeats are never counted as independent pairs.
- **Every gating criterion counts**, not only the all-pass flag. A criterion decided on few goldens has a wide interval. The table names each criterion not shown within the margin and the goldens behind it.
- **The flag families** default to `safety`, `forbidden` and `pii`, as in `compare`. `--flag` replaces the list.
- **The smallest margin** the table prints is the all-pass upper bound when every pair passes on both sides. A margin below it can never show parity with this many goldens: add goldens, not repeats.
- **The cache is off** by default, so every cell runs the agent. `--cache` replays cached runs.
- **The baseline** is read before the candidate runs. A file path is a store, and its latest campaign is the baseline. Anything else is a campaign id in `--store`.

## Run it locally

```
pnpm -s driftbench campaign run examples/acme/gated/specs --target function:acme-sales --store .driftbench/baseline.db
pnpm -s driftbench ci --specs examples/acme/gated/specs --target function:acme-sales \
  --baseline .driftbench/baseline.db --store .driftbench/ci.db --margin 30
pnpm -s driftbench ci --specs examples/acme/gated/specs --target fault:x3-skips-recap --faults examples/acme/faults \
  --baseline .driftbench/baseline.db --store .driftbench/ci.db --margin 5
```

The first `ci` call compares the agent with itself over 134 goldens: parity at 30 points, exit 0. At 5 points the same call reads `not-shown-non-inferior`, exit 1, because the `cards`, `guards` and `must` criteria are decided on too few goldens. The second call runs the fault that skips the recap and sends the order without a confirmation: `regression`, exit 1.

## In GitHub Actions

`action/action.yml` at the repository root is a composite action around the command. Inputs: `specs`, `target`, `baseline`, `store`, `margin`, `repeats`, `mode`, `budget-usd`, `faults`, `report-path`, `working-directory`, `driftbench` (the command that runs the CLI). Outputs: `verdict` and `report-path`. The step exits with the CLI's code, so a regression fails the job.

`driftbench-ci.yml` in this folder is a complete workflow. Copy it to `.github/workflows/`. It checks out the pull request's base and head, runs the baseline campaign on the base, runs the action on the head, and uploads the summary.

## Watching a store over time: `driftbench monitor`

```
driftbench monitor --store <file> --metric pass_rate|cost|latency [--window 20] [--series] [--json]
```

- **The series** is one value per campaign of the store, oldest first by creation time: the share of runs that pass, the mean cost per run, or the mean latency per run. A campaign with no run is left out and named.
- **The in-control level** comes from the first `--window` campaigns. Its sd is the largest of three: the spread of those campaign values, the standard error of each campaign from its own runs, and a floor for the metric. The second keeps a quiet warmup from understating the noise.
- **Three detectors** read the series: a two-sided CUSUM (allowance 0.5 sd, threshold 5 sd), Page-Hinkley (delta 0.5 sd, lambda 5 sd), and a sliding two-sample KS test between the `--window` campaigns before each index and the `--window` from it, each split tested at 0.05 divided by the number of splits.
- **Exit 1 when two of the three alarm**, 0 otherwise, 2 on bad input. One detector alone false-alarms too often on a short warmup, because the in-control mean is itself an estimate.

Measured on 200 synthetic series of 60 campaigns of 20 runs each, pass rate 90% with binomial noise, window 20 (the test `false-alarms on few no-shift series` in `packages/cli/test/monitor.test.ts`, 2026-10-11):

| Series | Count of 200 |
|---|---|
| No shift: at least one detector alarms | 41 |
| No shift: two of three alarm (exit 1) | 16 |
| Drop to 60% at campaign 30: exit 1, and two detectors place it within 3 campaigns | 193 |

These rates hold for that series shape only. A cost or latency series with heavier tails, or fewer runs per campaign, needs its own measurement.
