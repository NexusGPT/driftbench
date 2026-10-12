# Budget selection on Acme

This comparison runs the approved Acme map at budgets 20, 50, 100 and 200, with seed 1. It compares `--t 2 --max N` with `--t 2 --budget N`. The reference agents and planted faults are scripted. No model is called.

## What the numbers count

- Selected rows are the t-wise rows or their budget replacements. Their coverage and balance use the same five dimensions and constrained pool.
- Whole-suite counts use every complete spec under `specs/`, including the other seeders and coverage completion. Incomplete specs are counted separately and are not run.
- A fault is caught when a block passes its machine checks on the reference agent and fails those checks on the faulty agent. Runs use free-running mode, one repeat and the scripted user driver. This is a fault-detection comparison before the validity gate.
- The fixed denominator is 13: the two identity controls are excluded, and `x2-keeps-first-email` is equivalent on the generated suite. The measurement checks that equivalence on each measured sales conversation. Selected rows have no ops tasks, so four of the 13 faults can only be caught by the rest of the suite.
- Balance is measured per allowed value, including values selected zero times. Its fair share is the selected row count divided by the number of allowed values in that dimension. Maximum deviation is the largest absolute difference from that share.

Pairwise mode uses the generator's `--max N` limit. Budget mode replaces only the t-wise selections and leaves the other seeders at their defaults. Task families keep their own `--tasks` count in both modes. Coverage completion can add tests for pairs the selected rows miss. These commands therefore compare the existing CLI modes, not two suites with equal total run costs.

## Reproduce

Run from the repository root with Node and pnpm installed:

```bash
pnpm install --frozen-lockfile
pnpm exec tsx comparisons/budget/measure.ts
```

The script saves its measured records in `comparisons/budget/results.json`. It writes suites, reports and captured command output under `_captures/budget/`. It routes conversations to `function:acme-sales` and tasks to `process:acme-ops`, using `examples/acme/faults` for the planted faults. It checks selected cells against the reported pair coverage and budget counts before scoring.

These are the generation commands the script runs for every budget:

```bash
for N in 20 50 100 200; do
  pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out _captures/budget/pairwise-$N --t 2 --seed 1 --max $N --force
  pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out _captures/budget/budget-$N --t 2 --seed 1 --budget $N --force
done
```

Generation can exit 1 after writing a suite with incomplete specs or a seeder cut. The measurement treats exit 2 as an input error and stops. Partial budget coverage itself does not cause exit 1.

## Verification

The selector tests compare each greedy pick with every available candidate, including picks after full coverage. They also check constraints, repeatability, the pool cap, absent values and numeric bands. A temporary mutation that picked the first shuffled candidate caused coverage-order and balance tests to fail; the selector was restored. A CLI test on a complete map exits 0 with only 3 of 8 pairs covered.

```bash
pnpm exec vitest run packages/generate/test/seed/budget.test.ts packages/generate/test/enumerate/budget.test.ts packages/cli/test/generate.test.ts --maxWorkers=2
pnpm typecheck
pnpm lint
```

Numeric map dimensions remain planned. The exported `slicedLhs` helper is tested but is not called by the generator yet.
