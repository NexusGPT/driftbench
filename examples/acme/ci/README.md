# driftbench ci on the Acme sales assistant

`driftbench ci` runs a spec suite on a candidate target, pairs it golden by golden with a baseline campaign, and gates. Fictional data only: the Acme Telecom example agent, no secret, no paid model.

```
driftbench ci --specs <path> --target <adapter[:agent]> --baseline <store file | campaign id> \
  --store <file> [--margin <points|auto>] [--min-goldens 30] [--strict] [--mode F] [--repeats n] [--budget-usd usd] [--faults <path>] \
  [--route <tag=target>]... [--process-command <command>] [--flag <family>]... [--out driftbench-ci.json] [--cache] [--json]
```

## What it decides

`ci` runs the candidate campaign, then compares it with the baseline by `compareCampaigns` of `@agent-nexus/driftbench-report`: the rule `driftbench compare` applies. On the same pair of campaigns, the two commands give the same verdict and the same exit code.

| Exit | Verdict | compare's verdict | When |
|---|---|---|---|
| 0 | `parity` | non-inferior | The all-pass flag and every gating criterion that is not underpowered have a 95% upper bound below the margin, and no flag family fires on the candidate where it did not on the baseline. |
| 1 | `regression` | regressed | There is evidence of a drop: a new flag, a criterion the false discovery rate control keeps, or the all-pass McNemar test below 0.05 with more goldens regressed than improved. |
| 1 | `not-shown-non-inferior` | unproven | No evidence of a drop, but an interval is wider than the margin. This is too few goldens, never a regression. |
| 1 | `incomplete` | none | A candidate cell did not run (stopped by the budget, or pending). |
| 2 | none | none | Bad input: a margin outside (0, 100), an unknown baseline, a fault target without `--faults`, no golden in common. |

- **The unit is the golden**: one spec in one mode (and perturbation), every repeat of it. A golden passes when every repeat passes. Repeats are never counted as independent pairs.
- **Every gating criterion counts**, not only the all-pass flag, unless it is underpowered: decided on fewer than `--min-goldens` goldens (default 30). An underpowered criterion is reported and left out of the parity test, because its interval cannot be narrow. `--strict` puts it back. New flags always gate, and so does an underpowered criterion whose regression the false discovery rate control keeps.
- **The margin defaults to `auto`**: the smallest half point at which the baseline compared with itself is non-inferior. The table prints it and what sets it. Above 15 points it warns that the suite is too small for a tight gate.
- **The flag families** default to `safety`, `forbidden` and `pii`, as in `compare`. `--flag` replaces the list.
- **The smallest margin** the table prints is the all-pass upper bound when every pair passes on both sides. A margin below it can never show parity with this many goldens: add goldens, not repeats.
- **The cache is off** by default, so every cell runs the agent. `--cache` replays cached runs.
- **The baseline** is read before the candidate runs. A file path is a store, and its latest campaign is the baseline. Anything else is a campaign id in `--store`.

## Run it locally

```
pnpm -s driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops \
  --store .driftbench/ci.db --campaign baseline
pnpm -s driftbench ci --specs examples/acme/golden/specs --target fault:control-sales-identity --faults examples/acme/faults \
  --route flow:price-sheet=process:acme-ops --baseline baseline --store .driftbench/ci.db
pnpm -s driftbench ci --specs examples/acme/golden/specs --target fault:x3-skips-recap --faults examples/acme/faults \
  --route flow:price-sheet=process:acme-ops --baseline baseline --store .driftbench/ci.db
pnpm -s driftbench ci --specs examples/acme/golden/specs --target function:acme-sales --faults examples/acme/faults \
  --route flow:price-sheet=fault:ops-x1-wrong-price --baseline baseline --store .driftbench/ci.db
```

The route keeps the price-sheet task specs on the ops agent. A fault of the ops agent is a candidate through the route, as in the last command: the conversations stay on the sales agent.

Measured 2026-10-12 with the defaults:

| Suite | Auto margin | Identity control | Faults |
|---|---|---|---|
| `examples/acme/golden/specs`, 10 goldens | 28 points, with the warning that the suite cannot show parity under 15 points | `parity`, exit 0, for both the sales and the ops identity control | exit 1 on 12 faults: d4, x1, x3, x4, x5 `regression`; d2, d6, d8, d9 and ops-x1, ops-x4, ops-x5 `not-shown-non-inferior`. x2 and ops-d6 read parity: the ten do not catch them |
| `examples/acme/gated/specs`, 193 goldens | 7.5 points, set by `guards`; `cards` and the criteria only the 24 task specs read underpowered | `parity`, exit 0, for both controls | all thirteen scored faults, the four ops faults included through the route: `regression`, exit 1. x2 reads parity |

With `--strict --margin 30`, the identity control on the 10-golden suite reads `not-shown-non-inferior`, the rule before the minimum existed.

## In GitHub Actions

`action/action.yml` at the repository root is a composite action around the command. Inputs: `specs`, `target`, `baseline`, `store`, `margin` (default `auto`), `min-goldens` (default 30), `strict`, `repeats`, `mode`, `budget-usd`, `faults`, `route` (one `tag=target` per line), `report-path`, `working-directory`, `driftbench` (the command that runs the CLI). Outputs: `verdict` and `report-path`. The step exits with the CLI exit code, so any verdict but parity fails the job.

`driftbench-ci.yml` in this folder is a complete workflow. Copy it to `.github/workflows/`. It checks out the pull request's base and head, runs the baseline campaign on the base, runs the action on the head, and uploads the summary. Both steps pass `--route flow:price-sheet=process:acme-ops`: the suite holds price-sheet tasks for the ops agent, and without the route `--target function:acme-sales` runs them on the chat agent, where they fail (171 of 195 cells pass instead of 195).

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

## A campaign declared in a file

[`campaign.yaml`](campaign.yaml) is a project config: its `campaign:` key holds the settings of `driftbench campaign run`, each the flag it names, and a flag on the command line wins. From the repository root:

```
pnpm driftbench campaign run --config examples/acme/ci/campaign.yaml --store acme.db
```

It runs the six conversation specs on `function:acme-sales` in modes T and F, two repeats: 24 cells. `driftbench ci --config examples/acme/ci/campaign.yaml` takes the modes and repeats from the same file, and scores its `aggregates`. The key is described on the [running](../../../docs/running.md#the-campaign-key) page.
