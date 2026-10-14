---
title: Judge self-tests
summary: "The four layers that test the judges themselves before their verdicts count: fixture pairs per criterion, calibration against hand labels, the benchmark floors of the shipped judge, and the judges validator ladder; all run offline."
commands:
  - judge check
  - judge run
  - judge calibrate
  - validate
see_also:
  - judging-judge-check
  - judging-judge-run
  - judging-calibration
  - judging-bench-replay
  - judging-bench-floors
  - judging-cassettes
---

## What it is

A judge is a model, and a model can be wrong. driftbench trusts no judge before it passes tests of its own, at four levels:

| Layer | What it tests | Command |
|---|---|---|
| Fixture pairs | Each criterion carries a pass fixture and a fail fixture. A criterion folder is valid only when both exist and differ. A judge or council that does not separate the pair cannot be trusted on that criterion. | `driftbench judge check`, `driftbench judge run` |
| Calibration | Each judge alone must separate the pair in every repeat and agree with hand labels at kappa 0.8 or more. Only then can it own a criterion; an unowned criterion never gates. | `driftbench judge calibrate` |
| Benchmark floors | The shipped default judge, on three models, is scored on 14 fixed slices of fictional cases whose answer is known by construction. A score may never fall below its floor. | `pnpm bench replay --check-floor` |
| The judges validator | A ladder of 20 levels of code tests on the judges package itself: the answer contract under hostile output, cassette replay, the client parsers, evidence quoting, the instruction screen, council majority, cascade, pairwise, calibration, scale. | `driftbench validate judges` |

All four run with no model call: the first three on committed cassettes, the validator on its own fixtures. CI runs the bench replay with `--check-floor`.

## When to use it

* After editing a criterion: `judge check`, then `judge run` on its cassette, then `judge calibrate` if it must gate.
* After changing the judges package (prompt, parser, client, council): `driftbench validate judges` and `pnpm bench replay --slice all --check-floor`.
* To see why a judge is not trusted on a criterion: read its calibration line (`misses: ...`).

## Commands and every option

Each command has its own topic with every option: `judging-judge-check`, `judging-judge-run`, `judging-judge-calibrate`, `judging-bench-replay`, `judging-bench-floors`. `driftbench validate` belongs to the validators area; for judges it is run as:

```
driftbench validate judges [--seed <n> | --seeds <a..b>] [--hidden] [--json] [--check-floor] [--items] [--all-levels] [--blind]
```

| Option | Meaning | Default |
|---|---|---|
| `--seed <n>` | A visible seed. | `1` when no seed is given |
| `--seeds <a..b>` | A range of visible seeds, such as `1..20`. | none |
| `--hidden` | Add the hidden seed derived from `git rev-parse HEAD`. | off |
| `--json` | Print the report as JSON. | off |
| `--check-floor` | Exit 1 when the run is below its floor in `validators/floors.json`, else 0. | off |
| `--items` | Also list the whole bank per family and tier, pass or fail per seed. | off |
| `--all-levels` | Compute every level and list every failing item with its level, family, tier and cause. | off |
| `--blind` | Strip every cause and `Fix:` hint from items. | off |

Without `--check-floor`, the exit code is the level reached.

## Inputs

* Criteria folders with fixture pairs, labels folders, and cassettes (see `judging-criteria`, `judging-calibration`, `judging-cassettes`).
* `benchmarks/` for the bench (see `judging-bench-replay`).
* The validator reads its banks and fixtures under `packages/validators/` and `validators/judges/` (its needs are in `validators/judges/NEEDS.md`).

## Outputs and how to read them

* `judge run`: `separated` or `NOT separated` per criterion.
* `judge calibrate`: `at the bar` or `misses: <reason>` per judge and criterion, and the assignment table.
* `pnpm bench replay --check-floor`: `floor HOLDS` or `floor FAILS` per slice and model.
* `validate judges`: one row per level with its metric, threshold and result per seed; `Level of the run: <k> of 20`; then the failing items of the first failing level, each with its family, tier, source file, cause and a `Fix:` hint. The ladder stops counting at the first failing level.

## Worked example

The fixture pair layer, tested: the Acme council separates every pair.

```sh
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
```

```text
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
separated  checks_before_promising [system1, gating]: pass fixture pass, fail fixture fail
separated  coverage_before_offer [system1, gating]: pass fixture pass, fail fixture fail
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  honest_failure [system2, gating]: pass fixture pass, fail fixture fail
separated  ledger_intact [system2]: pass fixture pass, fail fixture fail
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail
separated  one_question_per_turn [system1]: pass fixture pass, fail fixture fail
separated  plain_language [system1]: pass fixture pass, fail fixture fail
separated  resumes_pending_step [system1, gating]: pass fixture pass, fail fixture fail
separated  sheet_matches_catalog [system1, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
(exit 0)
```

The validator ladder of the judges package on seed 1. It takes minutes and its last level measures speed, so its exit code depends on the machine; it is not run by the help test:

```text
$ driftbench validate judges --seed 1
Validator judges (ladder version 2)
Level  Name                                                          Metric                                   Threshold  seed 1
1      the seven levels of version 1                                 items of v1 passing / 37 items           >= 1       1 pass
2      the answer contract under hostile output                      items of contract passing / 48 items     >= 1       1 pass
(16 more lines)
19     calibration coverage and skewed prevalence                    items of calibration passing / 42 items  >= 1       1 pass
20     the same operations at 10 and 100 times the input             items of scale passing / 26 items        >= 1       0.961538 FAIL (1)
Level per seed: 1 = 19
Level of the run: 19 of 20, the minimum over 1 seed.
Floor: 0. At or above the floor.
The floor 7 belongs to ladder version 1; version 2 has no floor yet.
Items of the first failing level:
  Seed 1, level 20 scale (the same operations at 10 and 100 times the input), 1 item:
    family scale (1):
      scale/prompt-100000-entries  [tier 3]  [packages/judges/src/prompt.ts]  the fastest of three runs took 6249 ms, budget 6000 ms. Fix: Keep the operation linear in its input.
(exit 19)
```

Levels 1 to 19 pass. Level 20 measures speed on a 100000-entry prompt against a 6000 ms budget, so its result depends on the machine; here it took 6249 ms. The run took about five minutes.

The floor layer is shown in `judging-bench-replay`.

## Common errors

* `NOT separated` in `judge run`. The council cannot tell the pass fixture from the fail fixture. Read the round log under the line; sharpen the rubric or the pictures, or check that the cassette holds recordings for these requests.
* `misses: separates the fixture pair 2 of 3 times` in `judge calibrate`. The judge is unstable on that criterion; it cannot own it.
* `floor FAILS` in `pnpm bench replay --check-floor` (exit 1). A judges change lost accuracy, or the recordings are stale (`re-record needed`).
* A validator level that fails (exit code below 20). Read the listed items; each names the source file, the cause and a fix. A speed level can fail on a slow or busy machine: run it again before acting.
