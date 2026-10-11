# driftbench ci on the Acme sales assistant

`driftbench ci` runs a spec suite on a candidate target, pairs it golden by golden with a baseline campaign, and gates. Fictional data only: the Acme Telecom example agent, no secret, no paid model.

```
driftbench ci --specs <path> --target <adapter[:agent]> --baseline <store file | campaign id> \
  --store <file> --margin <points> [--mode F] [--repeats n] [--budget-usd usd] [--faults <path>] \
  [--flag <check>]... [--out driftbench-ci.json] [--cache] [--json]
```

## What it decides

| Exit | Verdict | When |
|---|---|---|
| 0 | `parity` | The upper bound of the 95% interval on the regression effect is below the margin, and no gating flag fires on the candidate where the baseline had none. |
| 1 | `regression` | The upper bound is not below the margin. |
| 1 | `gating` | The effect is within the margin, but a flag check fails on a golden where the baseline's did not. |
| 1 | `incomplete` | A candidate cell did not run (stopped by the budget, or pending). |
| 2 | none | Bad input: a margin outside (0, 100), an unknown baseline, a fault target without `--faults`, no golden in common. |

- **The unit is the golden**: one spec in one mode (and perturbation), every repeat of it. A golden passes when every repeat passes. Repeats are never counted as independent pairs.
- **The effect** is the baseline pass rate minus the candidate pass rate, with the paired Newcombe interval of `nonInferiority` in `@driftbench/stats`.
- **The flag checks** default to `forbidden`, `pii`, `safety` and `guards`: a failure there is an act that must never happen, so it fails the gate whatever the margin. `--flag` replaces the list.
- **The smallest margin** the table prints is the upper bound when every pair passes on both sides. A margin below it can never show parity with this many goldens: add goldens, not repeats.
- **The cache is off** by default, so every cell runs the agent. `--cache` replays cached runs.
- **The baseline** is read before the candidate runs. A file path is a store, and its latest campaign is the baseline. Anything else is a campaign id in `--store`.

## Run it locally

```
pnpm -s driftbench campaign run examples/acme/gated/specs --target function:acme-sales --store .driftbench/baseline.db
pnpm -s driftbench ci --specs examples/acme/gated/specs --target function:acme-sales \
  --baseline .driftbench/baseline.db --store .driftbench/ci.db --margin 5
pnpm -s driftbench ci --specs examples/acme/gated/specs --target fault:x3-skips-recap --faults examples/acme/faults \
  --baseline .driftbench/baseline.db --store .driftbench/ci.db --margin 5
```

The first `ci` call compares the agent with itself: exit 0. The second runs the fault that skips the recap and sends the order without a confirmation: exit 1.

## In GitHub Actions

`action/action.yml` at the repository root is a composite action around the command. Inputs: `specs`, `target`, `baseline`, `store`, `margin`, `repeats`, `mode`, `budget-usd`, `faults`, `report-path`, `working-directory`, `driftbench` (the command that runs the CLI). Outputs: `verdict` and `report-path`. The step exits with the CLI's code, so a regression fails the job.

`driftbench-ci.yml` in this folder is a complete workflow. Copy it to `.github/workflows/`. It checks out the pull request's base and head, runs the baseline campaign on the base, runs the action on the head, and uploads the summary.
