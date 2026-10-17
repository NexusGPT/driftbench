# The estate chain, proved by one test

The question is how the whole estate flow fits together. This page answers it with a test, not with prose.

The test is [`packages/cli/test/estate-chain.test.ts`](../packages/cli/test/estate-chain.test.ts). It runs the chain on the fictional Northwind fixture. Ten steps run in order. Each step reads the file the step before wrote. No step calls a model.

Every hand-off is checked by an id or a hash that both steps must agree on. A hand-off that breaks fails the test and names the step.

## Run it

```
pnpm exec vitest run packages/cli/test/estate-chain.test.ts --reporter=verbose
```

The run takes about a minute. It needs no network and no key. It works in a temporary folder and removes it at the end. Step 10 prints a table with one row per step. Each row gives the input file, the output file, the id or hash that ties them, and whether the step is verified. A step that fails shows `NO` in that table.

## The chain

The commands run from the repository root. They write into a scratch folder, which git ignores. The test runs the same commands through the CLI entry point, with absolute paths. For some of them it adds `--json`, to read the result as data. That changes only how the result is printed.

```
W=_captures/chain
F=examples/estates/fixture
V2=examples/estates/fixture-v2
FAKE=$F/live/fake
mkdir -p $W
```

In step 6, `$SPECS` stands for the 14 complete live specs of the fixture proof, one per test type, taken from `$W/generated/specs/live`. Their names are the list `PROOF` in the test.

| Step | Command | Tied to the other steps by | What the test asserts |
|---|---|---|---|
| 1. Scan | `pnpm -s driftbench estate scan $F --runtime claude-code --replay $F/answers.yaml --out $W/map.yaml` | The map hash. | The count line (atoms, read by code, split by the model, edges) matches the file. Every atom id starts with its kind and is used once. Every provenance hash recomputes from the file, the span and the quote. Every quote is in the estate file at its span. The map hash recomputes from the atom hashes and the edges. The map equals `$F/map.yaml` except for its root and its time. |
| 2. Approve | `pnpm -s driftbench estate approve $W/map.yaml --all --to $W/approved.yaml` | The map hash is the same before and after. | The two counts in the output (57 approved now, 68 already approved) equal the flags in `map.yaml`. The approved map differs from the scanned map in the `approved` flags only. The ids, quotes, edges and map hash are the same. A second `estate approve` on the new file says all 125 atoms are approved. The map equals `$F/approved.yaml` except for its root and its time. |
| 3. Space map | `pnpm -s driftbench estate map $W/approved.yaml --to $W/space.yaml --agent northwind` | `version` of the space map is the start of the map hash. | The version is the first 12 characters of the map hash. Every value of every `atoms.<kind>` dimension is an approved axis atom of the approved map, filed under its own kind. No approved axis atom is missing (92 today). The count line matches the file. The space map equals `$F/space.yaml`. |
| 4. Plan | `pnpm -s driftbench estate plan $W/approved.yaml --space $W/space.yaml --out $W/plan.yaml` | `mapHash` and `spaceHash` in the plan. | `mapHash` is the approved map hash. `spaceHash` is the content hash of `space.yaml`. `plan.summary.json` repeats both. Every row names approved atoms of the map. Every cell value exists in the space map, and an `atoms.<kind>` value is an atom of that kind. The rows and the summary equal those of `$F/plan.yaml`. |
| 5. Generate | Approve the rows: `pnpm -s driftbench estate plan approve $W/plan.yaml --all`. Generate: `pnpm -s driftbench estate generate --map $W/approved.yaml --plan $W/plan.yaml --out $W/generated --phrases $F/phrases.yaml --sessions $F/sessions/index.yaml` | `mapHash`, `atoms` and `planRow` in each test. | All rows are approved first. Every test, complete or not, names only atom ids of the approved map. It carries the full map hash. Its `planRow` is a row of the plan, and it holds the atoms, the test type, the mode and the cell of that row. The static and unit tests carry the same three fields. The rows that have a test are exactly the plan rows (1568 today). The report counts equal the files in the folders. The command exits 1 because some specs are incomplete. |
| 6. Mutate and run | Mutate: `pnpm -s driftbench estate mutate $W/approved.yaml --atom instruction.standing.tell-the-user-about-a-late --invert --to $W/mutant`. Run: `pnpm -s driftbench estate run $SPECS --estate $F --runtime claude-code --command $FAKE/claude.mjs --set-env "FAKE_MANIFEST=$PWD/$FAKE/manifest.json" --store $W/original.db --map $W/approved.yaml --states $F/live/states/library.json`. Run again with `--estate $W/mutant`, `--store $W/mutant.db` and no `--map`. | The map hash pins each run. The atom id picks the specs. | The mutant record names the atom. Its original map hash is the approved map hash. Its own map hash differs. Only `CLAUDE.md` differs from the estate, and only on that line. The runs are pinned to the approved map hash, the mutant run to both hashes. On the original, the 3 specs that name the atom pass. On the mutant, the obligation and its twin fail. The outside-trigger control stays green. The 11 other specs give the same result as before. The plan and phrase bank of the original map are refused for the mutant map, with exit 2 and nothing written. |
| 7. Diff | `pnpm -s driftbench estate diff $W/approved.yaml $V2/map.yaml --old-guards $V2/maintain/guard-state.v1.yaml --out $W/diff.json` | `old.hash` in the diff is the approved map hash. | The new hash is the version 2 map hash. The semantic changes are the route `an-ask-to-plan-the-delivery` and the instruction `tell-the-user-about-a-late`. 24 atoms moved. The counts are 2 added, 1 removed, 1 white space, 2 semantic, 1 restated. The before and after provenance of the instruction equal the atoms of the two maps. The file equals `$V2/maintain/diff.json` except for the old path, the old read time and the new path. |
| 8. Impact | `pnpm -s driftbench estate impact $W/diff.json --tests $V2/tests --out $W/impact.json`. Then the same with `--tests $W/generated/specs --out $W/impact-generated.json`. | The atom ids in `metadata.estate.atoms`, and the two hashes of the diff. | On the version 1 tests: regenerate 4, re-approve 2, retire 1, new 2. The exit code is 1, since four items wait for a person. Each regenerated test names a changed atom in `metadata.estate.atoms`, for the reason given. On the generated specs, the regenerated and retired sets equal what a scan of `metadata.estate.atoms` predicts. The re-approval of the instruction lists the specs that name it (16 today). Specs that name only the respaced rule stay out. |
| 9. Radius | `pnpm -s driftbench radius $W/generated/specs --change $W/change.yaml` | The atom id in the manifest and `metadata.estate.atoms` in each spec. | The radius is not the whole suite. If it were, the test would fail and print the reason the command gives. Every block of a spec that names the instruction is direct, with the reason `prompt:instruction.standing.tell-the-user-about-a-late`. Every other block is out (16 of 1355 blocks are in today). The specs in the radius are the specs that impact names in step 8. |
| 10. Table | `pnpm exec vitest run packages/cli/test/estate-chain.test.ts --reporter=verbose` | The `yes` in each row. | The table has one row for each of steps 1 to 9. Every row says `yes`. One `NO` fails the test. |

The change manifest of step 9 is this file. It names the instruction as a prompt change.

```
from: northwind-v1
to: northwind-v2
changes:
  - kind: prompt
    id: instruction.standing.tell-the-user-about-a-late
    note: R7 tells the user after one late day instead of two
```

## One atom through the chain

The rule R7 is the instruction `instruction.standing.tell-the-user-about-a-late`. It says that a shipment late by more than two days must be reported to the user, with a supplier email proposed.

Step 6 inverts it in a copy of the estate. Version 2 of the estate changes it to one day, so step 7 finds it and step 8 regenerates its tests. Step 9 asks which blocks that change can reach. The same 16 specs answer in steps 5, 8 and 9, which shows that the steps agree.

Replay and the unit runner cannot run R7. Replay needs a recorded session, and the three Northwind sessions cover the weekly report only. The unit and static runners cover guards, scripts, invariants and settings. So step 6 uses the stand-in command of the fixture, as [the estate proof](estate.md#unit-live-and-estate-mutants) does. The stand-in plays recorded streams, calls no model and costs nothing.

## Where the real output differs from estate.md

The test asserts the real output. These numbers on [the estate page](estate.md) are older than the fixture.

| Where | The estate page says | The real output |
|---|---|---|
| Scan | 122 atoms, 54 split by the model, 10 prose chunks | 125 atoms, 57 split by the model, 14 prose chunks |
| Space map | 40 instruction atoms, a grid of 1992646656000 cells | 43 instruction atoms, a grid of 2531567001600 cells |
| Plan | 1338 rows: 348 from the contract, 980 pairwise | 1568 rows: 361 from the contract, 1197 pairwise |
| Generate | 1379 rows, 813 complete, 566 incomplete | 1568 rows, 1360 complete, 208 incomplete |
| Diff | 93 atoms unchanged | 96 atoms unchanged |
| Map hashes in the diff | `ab256ba636f4` and `48cac5d0c4c3` | `be2e7a0919cb` and `a5c8cb21f4ae` |
| Committed plan | Byte for byte what `estate plan` writes | True without `--space`. With `--space $W/space.yaml` only the `spaceHash` line differs. |

The `spaceHash` line differs because the committed plan was written without `--space`. It hashes the map's own space map, whose agent name is `estate`. The chain hashes the file of step 3, whose agent name is `northwind`.

## What the test does not prove

* It does not show that a model follows the estate. The stand-in plays recorded streams, and a person who played the model wrote the recorded scan answers.
* It does not run `estate unit` or `estate static`. They have their own tests.
* It stops at the radius. It does not rerun the cells in the radius after the change.

See also: [testing an estate](estate.md), [blast radius](concepts/blast-radius.md), [change manifest reference](reference/change.md), [estate files reference](reference/estate-files.md).
