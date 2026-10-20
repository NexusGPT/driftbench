# The estate chain, proved by one test

The question is how the whole estate flow fits together. This page answers it with a test, not with prose.

The test is [`packages/cli/test/estate-chain.test.ts`](../packages/cli/test/estate-chain.test.ts). It runs the chain on the fictional Northwind fixture. Thirteen steps run in order. They follow a prompt to its ids and tests. Then a change of the prompt selects tests, and only those run. Each step reads the file the step before wrote. No step calls a model.

Every hand-off is checked by an id or a hash that both steps must agree on. A hand-off that breaks fails the test and names the step.

When a step fails, read the table from the top. The first `NO` row is the broken step. Later `NO` rows can be fallout, because each step reads the files of the steps before it.

## Run it

```
pnpm exec vitest run packages/cli/test/estate-chain.test.ts --reporter=verbose
```

The run calls no model and needs no key. Step 6 is the longest step. It makes 146 runs of the stand-in command. The test works in a temporary folder and removes it at the end. Step 10 prints a table with one row per step. Each row gives the input file, the output file, the id or hash that ties them, and whether the step is verified. A step that fails shows `NO` in that table.

## The chain

The commands run from the repository root. They write into a scratch folder, which git ignores. The test runs the same commands through the CLI entry point, with absolute paths. For some of them it adds `--json`, to read the result as data. That changes only how the result is printed.

```
W=_captures/chain
F=examples/estates/fixture
V2=examples/estates/fixture-v2
FAKE=$F/live/fake
mkdir -p $W
```

In step 6, `$SPECS` stands for the 16 complete live specs that name the gate and ask the invoice question. The test runs 57 more, described in the table.

```
SPECS=$(grep -rl -- "^      - gate.invoice-reconcile.read-references-matching-rules-md-before$" $W/generated/specs/live)
```

| Step | Command | Tied to the other steps by | What the test asserts |
|---|---|---|---|
| 1. Scan | `pnpm -s driftbench estate scan $F --runtime claude-code --pointer --cassette $F/cassette.jsonl --out $W/map.yaml` (exit 1: the recorded labeler gave answers the checks refused, and each is listed) | The map hash. | The count line (atoms, read by code, split by the model, edges) matches the file. Every atom id starts with its kind and is used once. Every provenance hash recomputes from the file, the span and the quote. Every quote is in the estate file at its span. The map hash recomputes from the atom hashes and the edges. The map equals `$F/map.yaml` except for its root and its time. |
| 2. Approve | `pnpm -s driftbench estate approve $W/map.yaml --all --to $W/approved.yaml` | The map hash is the same before and after. | The two counts in the output (80 approved now, 47 already approved) equal the flags in `map.yaml`. The approved map differs from the scanned map in the `approved` flags only. The ids, quotes, edges and map hash are the same. A second `estate approve` on the new file says all 125 atoms are approved. The map equals `$F/approved.yaml` except for its root and its time. |
| 3. Space map | `pnpm -s driftbench estate map $W/approved.yaml --to $W/space.yaml --agent northwind` | `version` of the space map is the start of the map hash. | The version is the first 12 characters of the map hash. Every value of every `atoms.<kind>` dimension is an approved axis atom of the approved map, filed under its own kind. No approved axis atom is missing (93 today). The count line matches the file. The space map equals `$F/space.yaml`. |
| 4. Plan | `pnpm -s driftbench estate plan $W/approved.yaml --space $W/space.yaml --out $W/plan.yaml` | `mapHash` and `spaceHash` in the plan. | `mapHash` is the approved map hash. `spaceHash` is the content hash of `space.yaml`. `plan.summary.json` repeats both. Every row names approved atoms of the map. Every cell value exists in the space map, and an `atoms.<kind>` value is an atom of that kind. The rows and the summary equal those of `$F/plan.yaml`. |
| 5. Generate | Approve the rows: `pnpm -s driftbench estate plan approve $W/plan.yaml --all`. Generate: `pnpm -s driftbench estate generate --map $W/approved.yaml --plan $W/plan.yaml --out $W/generated --phrases $F/phrases.yaml --sessions $F/sessions/index.yaml` | `mapHash`, `atoms` and `planRow` in each test. | All rows are approved first. Every test, complete or not, names only atom ids of the approved map. It carries the full map hash. Its `planRow` is a row of the plan, and it holds the atoms, the test type, the mode and the cell of that row. The static and unit tests carry the same three fields. The generator folds exactly equivalent specs into one representative, which lists the rows it stands for in `equivalence.planRows`. Each listed row is a plan row and is folded once. The test does not trust that label. It proves each fold from the plan. The folded row has the atoms, test type, mode and cell of the representative's row. The representative is a complete spec. The test generates the folded row alone, from a plan that holds only it. That spec is complete, and its blocks and rules equal the representative's. A row that fails the proof does not count as covered. The test also lists a row under two specs it is not equivalent to, one complete and one incomplete. The proof must reject both. The written specs plus the proved folded rows are exactly the plan rows. The report counts equal the files in the folders. The command exits 1 because some specs are incomplete. |
| 6. Mutate and run | Mutate: `pnpm -s driftbench estate mutate $W/approved.yaml --atom gate.invoice-reconcile.read-references-matching-rules-md-before --delete --to $W/mutant`. Run: `pnpm -s driftbench estate run $SPECS --estate $F --runtime claude-code --command $FAKE/claude.mjs --set-env "FAKE_MANIFEST=$PWD/$FAKE/manifest.json" --store $W/original.db --map $W/approved.yaml --states $F/live/states/library.json --judge claude:haiku --judge-command $F/live/fake/judge.cjs --judge-budget 1`. Run again with `--estate $W/mutant`, `--store $W/mutant.db` and no `--map`. | The map hash pins each run. The atom id picks the specs. | The mutant record names the atom. Its original map hash is the approved map hash. Its own map hash differs. Only `CLAUDE.md` differs from the estate, and only on that line. The plan and phrase bank of the original map are refused for the mutant map, with exit 2 and nothing written. The stand-in holds recorded alternatives for two asks, keyed on the line of the gate (`Read references/matching-rules.md before matching any line.`). None plays on the original. Both play on the mutant. The test runs 73 specs on the original, pinned to the approved map hash, and on the mutant, pinned to both hashes. They are 16 specs that name the gate or its reference and carry a changed ask, and 57 others: specs that share a changed ask and controls of other test types. On the original, the 16 pass. On the mutant, the 16 fail on the check that the file `matching-rules.md` is read (the stream without the read plays). The other 57 specs give the same result on both estates, failing checks included. Some of them fail on both estates, by design. They are the 2 planted faults of the recorded streams. They are also the specs that need an act the recorded stream of the invoice ask never makes: the dispatch of the ledger auditor, a read of the currency table and the declared `Bash` tool. The judged specs are decided by the stand-in judge of the fixture, which passes them. |
| 7. Diff | `pnpm -s driftbench estate diff $W/approved.yaml $V2/map.yaml --old-guards $V2/maintain/guard-state.v1.yaml --out $W/diff.json` | `old.hash` in the diff is the approved map hash. | The new hash is the version 2 map hash. The semantic changes are the route `an-ask-to-plan-the-delivery` and the instruction `tell-the-user-about-a-late`. 24 atoms moved. The counts are 2 added, 1 removed, 1 white space, 2 semantic, 1 restated. The before and after provenance of the instruction equal the atoms of the two maps. The file equals `$V2/maintain/diff.json` except for the old path, the old read time and the new path. |
| 8. Impact | `pnpm -s driftbench estate impact $W/diff.json --tests $V2/tests --out $W/impact.json`. Then the same with `--tests $W/generated/specs --out $W/impact-generated.json`. | The atom ids in `metadata.estate.atoms`, and the two hashes of the diff. | On the version 1 tests: regenerate 4, re-approve 2, retire 1, new 2. The exit code is 1, since four items wait for a person. Each regenerated test names a changed atom in `metadata.estate.atoms`, for the reason given. On the generated specs, the regenerated and retired sets equal what a scan of `metadata.estate.atoms` predicts. The re-approval of the instruction lists the specs that name it (16 today). Specs that name only the respaced rule stay out. |
| 9. Radius | Edit the line of R7 in the standing file: `sed 's/late by more than two days/late by more than one day/' $F/CLAUDE.md > $W/estate-v2/CLAUDE.md`. Derive the change: `pnpm -s driftbench radius auto --prompt $F/CLAUDE.md $W/estate-v2/CLAUDE.md --map $W/approved.yaml --source CLAUDE.md --from-version northwind-v1 --to-version northwind-v2 --out $W/change.yaml`. Then: `pnpm -s driftbench radius $W/generated/specs --change $W/change.yaml` | The edited prompt, the quote of the atom in the approved map, and `metadata.estate.atoms` in each spec. | `radius auto` derives the manifest from the edit. Every change in it is a prompt change that names the atom `instruction.standing.tell-the-user-about-a-late`, and none is global. The radius is not the whole suite. If it were, the test would fail and print the reason the command gives. Every block of a spec that names the instruction is direct, for that atom. Every other block is out (16 of 1355 blocks are in today). The specs in the radius are the specs that impact names in step 8. |
| 10. Campaign v1 | In process, with the stand-in as the agent: `campaign run <the specs of step 6 and every live spec that names R7> --target claude-code:northwind --agent-version northwind-v1 --campaign c-v1 --store $W/campaigns.db --no-cache --concurrency 1` | The agent version label, and the stored run of each spec. | One run per spec, none carried. The stand-in answers one call per block sent. Each verdict, with its failing checks, equals the verdict that step 6 read on the same specs and the same estate. |
| 11. Subset run | In process, on the edited estate of step 9: the same campaign with `--agent-version northwind-v2 --campaign c-v2 --change $W/change.yaml --from c-v1` | The change manifest derived in step 9, the atom id in it, and the stored runs of `c-v1`. | (a) The specs run fresh are exactly the specs that step 9 put in the radius, and the stand-in answers exactly their blocks. (b) Their verdicts are the ones step 6 predicted. The specs that carry a changed ask are red on the check that the reply says `late`. The outside-trigger control is green. The stand-in plays its recorded alternative when the quote is gone. So it reads this edit as it reads step 6. (c) Every other spec is carried from `c-v1`, not run. Its stored blocks are the same. Its verdict equals the one of `c-v1` and the one step 6 measured. (d) The stored campaign and its report name the changes of the manifest, which are `prompt:instruction.standing.tell-the-user-about-a-late`. They also give the manifest hash, the cells in the radius and the cells carried. Each cell of the subset is in the radius for that atom. |
| 12. No-rule edit | Turn the line endings of the standing file from LF to CRLF. `pnpm -s driftbench radius auto --prompt $F/CLAUDE.md $W/estate-crlf/CLAUDE.md --map $W/approved.yaml --source CLAUDE.md --from-version northwind-v1 --to-version northwind-v2 --out $W/change-crlf.yaml`. Then `radius` over the generated suite, and the campaign `--agent-version northwind-v2 --campaign c-v1-crlf --change $W/change-crlf.yaml --from c-v1` in process | A new agent version for an edit that changes no word, and the stored runs of `c-v1`. | The derived manifest has no change, though the version label is new. The radius over the whole suite holds no block, and every block is outside it. The campaign runs no cell: all 75 specs are carried from `c-v1` with their stored blocks, and the stand-in is called 0 times. The stored campaign names no change and 0 fresh cells. |
| 13. Table | `pnpm exec vitest run packages/cli/test/estate-chain.test.ts --reporter=verbose` | The `yes` in each row. | The table has one row for each of steps 1 to 12. Every row says `yes`. One `NO` fails the test. |

The command line has no built-in `claude-code` target for `campaign run`. So steps 10 and 11 call the same campaign commands in process, with the live adapter of the stand-in as the agent. The commands, the radius and the carry are the ones the command line runs.

The change manifest of step 9 is written by `radius auto`, not by hand. For the edit above it holds one prompt change for each region of the edit ("two" to "one", "days" to "day"). Both name the instruction:

```
from: northwind-v1
to: northwind-v2
changes:
  - kind: prompt
    id: instruction.standing.r7-when-a-shipment-is-late
    note: 'region old:834-837 new:834-837: anchor atoms[instruction.standing.r7-when-a-shipment-is-late] ...'
  - kind: prompt
    id: instruction.standing.r7-when-a-shipment-is-late
    note: 'region old:841-842 new:841-841: anchor atoms[instruction.standing.r7-when-a-shipment-is-late] ...'
```

`radius auto` falls back to the whole suite when it cannot place an edit with certainty. Two edits that were tried are read as ambiguous alignments, and they select every spec. They are the insertion of "do not" in R7 and the change of "two" to "five". The edit of step 9 is not.

## One atom through the chain

The rule R7 is the instruction `instruction.standing.r7-when-a-shipment-is-late`. It says that a shipment late by more than two days must be reported to the user, with a supplier email proposed. Version 2 of the estate changes it to one day, so step 7 finds it and step 8 regenerates its tests. Step 9 asks which blocks that change can reach. The same 16 specs answer in steps 5, 8 and 9, which shows that the steps agree.

Step 6 follows another atom, the gate `gate.invoice-reconcile.read-references-matching-rules-md-before`. It says that the file `references/matching-rules.md` is read before any line is matched. A gate has a check that code decides: the file is read, and read before the act. A plain instruction like R7 has none in its label, so its spec is judged from its own words, and a judge that passes it whatever the estate holds proves nothing about a change. Step 6 deletes the line of the gate in a copy of the estate and shows the specs that name it turn red. Step 9 derives the change from the edit of version 2 and asks which blocks it can reach; steps 10 and 11 run those blocks, with the specs of step 6, against the edited estate.

Replay and the unit runner cannot run the gate. A replay reads a recorded session, and a recorded session does not change when the estate does. The three Northwind sessions cover the weekly report only. The unit and static runners cover guards, scripts, invariants and settings. So step 6 uses the stand-in command of the fixture, as [the estate proof](estate.md#unit-live-and-estate-mutants) does.

The stand-in is a script. It calls no model and costs nothing. It plays a recorded stream for each known ask. For two asks, the manifest holds an alternative stream. It plays when the estate copy no longer holds the line of the gate.

In playback mode, the stand-in reads the changed line through those two alternatives only. So those two asks decide which specs can move. The test reads the rules from the manifest and finds their asks. It runs every spec that carries one of them, whether or not the spec names the gate. A spec that shares a changed ask but does not name the gate gives the same result on both estates.

## The estate page and the real output

The estate page shows the real output of its commands on the fixture, regenerated from the committed cassette. The numbers of both pages are those of one scan, the recorded labels of the pointer reader. They move when the fixture, the label set or a recorded answer changes.

## What the test does not prove

* It does not show that a model follows the estate. The red result of step 6 comes from a recorded alternative in the stand-in's manifest. It shows that the chain picks the right specs and that the run notices the change. It does not show that a model reads the rule.
* The recorded labels are the answers of two real labelers (a choice model and a chat model, five runs). A different recording gives a different map, and a unit the labelers leave out is not in the map.
* It does not run `estate unit` or `estate static`. They have their own tests.
* It stops at the radius. It does not rerun the cells in the radius after the change.

See also: [testing an estate](estate.md), [blast radius](concepts/blast-radius.md), [change manifest reference](reference/change.md), [estate files reference](reference/estate-files.md).
