# Handover: validator generator

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate generator --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 5 |
<!-- level-table:end -->

The bank holds 2033 items in 26 families, ordered in 22 levels; a level passes when every item of it passes on every seed. After journal row 17 (seed 1 only; the other seeds were not re-measured) seed 1 passes levels 1 to 5 and fails level 6 (the validity gate, 4 items). Bank on seed 1: 1551 of 2033 pass (0.763). The level table below is the pre-merge table of the other seeds and is stale until a full sweep (seeds 1 to 20 and hidden) runs.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The lane proposes a floor of 1 for generator, ladder version 2 (a maintainer change after the merge).

## Open items

Failing items per family on seed 1 after row 14: fault-code 20, fault-drift 9, fault-deviation 1, modes 47, perturbation 3, coverage 9, minimality 53, interaction-pair 286, interaction-triple 11, stability 6, scale 11, sequence 2, allocation 4, contrast 4, phrases 3, behaviours 1, adequacy 18, gate 8 (after row 16: gate 4, scale 1). Report, boundary and paths are at 0.

Level 6, the validity gate, 8 items (found with a script that runs `runGate` on the generated suite; see Tools):
- `gate.contrast.then-ignores-edit` (31 blocks, was about 590). Row 15 fixed the transition siblings (a move block records the stage it is said at, and only the data its Then reads). What is left: boundary blocks of one dimension whose Then is the same (an invalid quantity below the minimum and one above the maximum both forbid the call and stay on the stage; true and false of a tool output) and D2 against D5 probes. Equal Thens are correct there; a fix would need the Then to read the value.
- `gate.shortcut.passed-by-first-tool` (8 blocks, gen-boundary-010 to 012 and 3 more): single-turn reads of a tool output value ("tell me whether found comes back as true"). The block has count min 1 and no input, so the first-tool cheater passes.
- `gate.accepted.*` and `gate.killers`: the accepted share follows the two causes above; the six unkilled classes below.

Causes that look blocked by the spec language or the follower (checked, not fixed):
- `X1.field-extra`, `X2.fact-flip`, `X2.fact-invent`, `X4.no-question`, `X4.narrate`, `X3.no-report` (about 400 interaction-pair items plus stable.*, mode.*, minimal.*). A Then can assert named input keys, stage, tool counts and word patterns. It cannot forbid an unnamed extra argument, and the stage check does not apply when no stage was ever reported (`packages/checks/src/checks/stage.ts`). Text facts need a map relation that says what the reply states; the validator's map has none. These need either a spec language addition or a `states` relation in the map.
- `stage=opening` is never placed (cover.* 8 items, allocation.stage.* 4): the first block always moves to intake. A first-turn probe that stays on opening is passed by the constant, echo and copy cheaters (iteration 13 removed them to hold level 5).
- `phrases.personas` and `phrases.behaviours`: a persona or behaviour phrase is a standalone turn whose Then (stay on the stage, no calls) is passed by a reply that does nothing.
- `contrast.write.integer.*`: the follower never sends the write tool an argument, so no Then can tell `units` at-minimum from above-minimum.
- `minimal.*` (53): a conversation repeats its first blocks in every spec, so blocks with the same Then and outcomes group; this is a property of multi-turn specs.
- `mode.T.*`: teacher-forced runs replay a prefix with empty assistant text; the follower fails most later blocks there. Not investigated further.

Known regression to repair: iteration 13 removed the first-turn D9 probe (`fault.D9.inside`, `mode.F.D9_out_of_scope`, about 41 `pair.*+D9.inside` items). `fault.D9.inside` passes on seed 1 now; re-check on a full sweep.

## Decision for the owner: the six unkilled fault classes

These need a public contract change, so nothing is built. Two options, each with the example it unblocks.

Option A, a spec language addition. Two new assertions on a block:
- `tools[].input_closed: true` (the call carries only the keys named in `input`). Example: `X1.field-extra` adds `note: "added by the agent"` to a lookup call; with `input_closed` on the lookup expectation `{ kind: green }` the call `{ kind: green, note: ... }` fails.
- `expect.stage_reported: true` (the runtime must report a stage in this block). Example: `X3.no-report` reports no stage; today `expect.stage` does not apply when no stage was ever reported, so the block passes.
Trade-off: every runner and adapter must implement both; the generator then emits them everywhere, which makes old specs and new specs differ. It does not help the three text classes.

Option B, a `states` relation in the map for what a reply states (the relation already exists in the generator for quoted prices). Example: `{ subject: flow=status-check, stage: check, to: check, must: ["{found}"] }` makes the reply of the lookup turn state the value the tool returned, which kills `X2.fact-flip` (opposite of a yes or no) and `X2.fact-invent`; a `must_not` of narration words kills `X4.narrate`; a question pattern kills `X4.no-question`.
Trade-off: the owner approves one relation per flow, and the validator's rendered map (`packages/validators/.../render.ts`) has none today, so the generator has nothing to read; the follower's reply texts would have to be stated by the map. It leaves `X1.field-extra` and `X3.no-report` open.

Both together kill all six. A alone kills two, B alone kills four.

## Hypotheses tried

Rows 1 to 10 are the pilot (branch `exec/generator-pilot`, merged). Rows 11 to 13 are listed in the journal. Row 14 covers four causes:
- The report states `coverage.measures.*` and `seeders.<seeder>.measures.*` (the validator's definitions: Good-Turing discovery, Chao, Hill, Pielou, t = 3 share, weighted share, required cells, axis values, machine Then share). The 40 `report.*` items pass. Code: `coverageMeasures` in `packages/generate/src/enumerate/generate.ts`.
- A flow phrase opens a path of its flow, in place of the opening move (`choosePhrase(..., opening)` in `scenario.ts`; flow branch in `metamorphicOnPaths`). The metamorphic flow families are complete: `phrases.flows` and `phrases.metamorphic` pass.
- A boundary request that only forbids calls (an invalid value, a write tool asked for early) is said after the walk's first move, and the block expects the conversation to stay on that stage (`turn` in `ScenarioRequest`; boundary seeder). The 13 failing `boundary.*` items pass, and `phrases.data-out` too.
- A single-turn boundary block states the reply language (`paths.lang.boundary` passes).
- Row 15: a transition block's recorded cell now holds the stage it is said at (`saidAt`) and only the data values its Then reads. Gate.accepted.graph, twise, deviation and metamorphic pass.
- Row 16: scale. `cellsOf` in `generate.ts` projects the grid once per map (`gridAt`) and the cover loop reads only the cells a spec reaches (`reachedCells`); the report counts maps up to 4 million cells (the space package refused 277200). Ten times the behaviours: 29 s of CPU for one generation (was 78 s for two); a hundred times completes but takes 384 s of CPU for two against a 60 s budget (`scale.100x.time` still fails).
- Row 17: scale again. A spec is validated as built (`validateSpec`) instead of being parsed back from its YAML text (the parse was 69 percent of `generateSuite` at 30 times), and the coverage share is read from the cached grid (`measuredCoverage`). A hundred times: 170 s of CPU for two generations. What is left at 100 times: stringifying each spec (about 14 percent), coverage of the cover seeder and the report (about 12 percent), the covering array and scenario search, and the validator's own reload of every written file (`loadSpecFile`, about a fifth of the timed window, outside this package). Reaching 60 s needs fewer or smaller specs at that size, not more tuning.
- Tried and reverted: a stable transition phrase per context (no change in then-ignores-edit); letting a requested probe stage skip the first-turn filter (it fixed the Acme cover cells but added 53 constant and echo cheater passes on gen-cover blocks and level 6 got worse, 8 to 10 failing).
- The previous builder's iteration 14 (a second probe of a class at another stage) and 15 (a probe after the last stage; main has its own version) were merged, not journaled separately.

## Next actions

1. Run the full sweep (seeds 1 to 20 and hidden) in the background and write the next journal row from it; the level table is stale.
2. `gate.contrast.then-ignores-edit`: choose one family of pairs (transition siblings) and give the two blocks a different Then or a different cell; measure with the `runGate` script, which takes about 5 minutes.
3. `scale.100x.time`: only a smaller suite at that size gets under 60 s (170 s now, a fifth of it the validator's reload). Needs an owner choice on how many specs a 100 times map may write.
4. Ask the owner whether the spec language may gain a closed-input assertion and a stage-reported assertion; the six unkilled classes depend on it.
5. Handover test on the next third iteration: `pnpm driftbench validate generator --brief --fresh`.

## Validator item defects (logged, not edited)

- `gate.shortcut.passed-by-first-tool` on single-turn tool output reads: the follower returns no argument for a read, so no generator Then separates it from the cheater without an input the map does not give.
- `contrast.write.integer.*`: the follower ignores the write tool's integer argument.
- `fault.X3.no-report`: the check it needs does not exist in `packages/checks`.

## Tools

Gate funnel and fault table on the generated suite: a script with `SeedData(1, {}, ...)`, `data.generated()` and `runGate` as `gated()` does in `packages/validators/src/ladders/generator/bank4.ts` (copy it into `packages/validators/` as `gate.tmp.mts`, never commit it). Items by prefix: a script that calls `evaluate(bankItems().filter(...), data)` as `bank-run.ts` does. `pnpm driftbench validate generator --seed 1` (no `--items`) stops at the first failing level and takes about 6 minutes; `--items` takes about 40.

## Pitfalls

* Never edit the validator or bank (`packages/validators/**`, the rest of `validators/`).
* An echo agent repeats every literal word of the spec's `must` patterns: words alone never kill it.
* Acme items read `examples/acme`. The Acme regeneration waits for three other pull requests; five tests in `test/enumerate/acme.test.ts` fail until it runs. Regenerate with `pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out examples/acme/generated --baseline examples/acme/specs --t 2 --force` then `pnpm -s biome check --write examples`; pinned counts live in `packages/generate/test/enumerate/acme.test.ts` and `test/gate/acme-generated.test.ts`.
* Memory is tight: vitest with `--maxWorkers=2`, bank-run with `--jobs 2`, one sweep at a time, about 25 minutes each.
* Measurements live in `.exec/` (untracked, excluded in the git common dir).

## How to run

```
pnpm driftbench validate generator --seed 1 --items
node --import tsx packages/validators/src/ladders/generator/bank-run.ts .exec/after.json --seeds 1..20 --hidden --jobs 2
node --import tsx packages/validators/src/ladders/generator/bank-row.ts .exec/after.json .exec/row.json --iteration <n> --before .exec/before.json --hypothesis "<text>" --files <a,b> --commit <sha> --tests "<names>" --minutes <n> --model sonnet
pnpm driftbench validate generator --journal .exec/row.json
```

## Fixtures

* Hidden specification per seed: `hiddenSpec(seed)` in `packages/validators/src/ladders/generator/hidden.ts`, rendered by `render.ts`; seed 1 is kept in `packages/validators/fixtures/generator/seed-1/`.
* Rule follower `follower.ts`, faults `faults.ts`, cheaters `cheaters.ts`, items `bank*.ts` and `acme.ts`.

## Spec cap

### Interface and preservation target

`--budget N` still bounds only the budget seeder's t-wise rows. The independent `--spec-cap N` bounds total written specs. `--spec-cap-mode tuples` is the default: preserve every pair, triple and requested-strength tuple reached by the candidate pool. Explicit `--spec-cap-mode pairs` permits reported triple losses. Both modes retain every graph, boundary, deviation, metamorphic and task probe, plus every incomplete spec. Only complete t-wise and cover specs can be trimmed. A cap below the protected count is refused; a cap losing a target tuple exits 1 and lists that tuple.

The full candidate pool remains necessary: a 10x trial with `--budget 256 --t 3` reaches 1,465 pairs, below the uncapped suite's 1,485. The total cap therefore selects after both the existing budget/t-wise seeder and cover seeder. Budget mode remains available independently and composes with the cap. The reported `preserving` size is the deterministic greedy selection's minimum passing limit, not a proof of a globally optimal set cover.

The coverage report now leads with actual axis-map coverage of written complete specs. The candidate t-wise or budget array appears second and is labelled as measured before total-cap selection. `coverage.actual[].uncovered` lists all missed axis tuples; `spec_cap.coverage[].lost` distinguishes new cap losses from pre-existing gaps.

### The 41 uncovered pairs at 10x

Actual uncapped coverage is **1,485 of 1,526 pairs (97.31 percent)**. Every missing pair is one of the behaviours below paired with `stage=opening`. The candidate array's 2,049 of 2,049 triples is a different denominator and does not establish full axis-map coverage.

Cause: the first-turn recovery stays at the initial stage and requires no tool call. The first-turn discriminator rejects that probe. All 41 targeted `coverDraft` attempts reproduce this cause; some alternative paths additionally have no recovery for the requested class. These are alternate path failures for the same pairs, not additional uncovered pairs.

- `B-001`, `B-002`, `B-003`, `B-004`, `B-006`, `B-1000`, `B-1001`
- `B-1003`, `B-1004`, `B-1006`, `B-1007`, `B-1009`, `B-1010`, `B-1012`
- `B-1013`, `B-1016`, `B-1019`, `B-1020`, `B-1021`, `B-1022`, `B-1023`
- `B-1024`, `B-1025`, `B-1027`, `B-1028`, `B-1030`, `B-1031`, `B-1034`
- `B-1036`, `B-1037`, `B-1039`, `B-1040`, `B-1042`, `B-1043`, `B-1044`
- `B-1045`, `B-1046`, `B-1049`, `B-1051`, `B-1052`, `B-1053`

Other causes: **0 pairs**. The complete pair list and per-path reasons are in [generator-cap-opening.json](../../tools/analysis/generator-cap-opening.json).

The guard remains unchanged at `packages/generate/src/seed/scenario.ts:203`; its discriminator is at `scenario.ts:471`. A diagnostic fix at `scenario.ts:223` now names this rejection when an approved opening phrase exists. It no longer incorrectly attributes that case to a missing phrase. The scenario tests retain the positive control where an approved recovery requires a call at the first stage, and add the negative control with an approved phrase but no discriminating recovery.

Next-owner handoff:

- `packages/generate/src/seed/seeders.ts:1553` already tries all opening-compatible classes when a missing pair targets the start stage.
- `packages/generate/src/seed/possible.ts:76` treats these conversational events as possible. Do not remove them from the declared axis denominator to report 100 percent.
- `packages/validators/src/ladders/generator/hidden.ts:379` defines the fictional recoveries; D1, D5, D6 and D9 remain at the pending stage without a required call. `packages/validators/src/ladders/generator/render.ts:301` copies those contracts into the map.
- Closing these pairs needs an approved opening contract and matching follower behaviour that distinguishes an idle or echo reply, followed by a gate check. The prior handover records 53 extra constant/echo passes when the first-turn filter was bypassed. This change preserves that filter and does not invent new map behaviour or modify the validator.

### Candidate cap measurements

Actual uncapped axis-map coverage comes first: at **10x, pairs 1,485/1,526 and triples 8,690/9,162**; at **100x, pairs 13,510/13,946 and triples 83,722/88,542**. The baseline leaves 41 and 436 pairs uncovered respectively. The chosen caps preserve every reached pair, not 100 percent of the declared axis map.

Candidate t-wise array coverage, a separate measurement before the total cap: **10x, 2,049/2,049 triples in 989 rows**; **100x, 19,689/19,689 triples in 9,690 rows**. These figures exclude unreachable candidate combinations and do not replace actual coverage.

Fictional fixture `scaledSpec(1, factor)`, generator seed 1, `t=3`. Each row measures actual written specs, including all 109 protected probes. CPU is process user plus system time for one map load, generation, file write and YAML reload, excluding fault assays. These exploratory measurements use the same cap algorithm (`8ce6daa7`) while the separate report and diagnostic changes were finalized. They exclude the speed branch's optimizations. The committed [measurement script](../../tools/analysis/generator-cap.ts) runs the same comparison at a single version; [raw results](../../tools/analysis/generator-cap-results.json) include tuple denominators, exact caught classes, witnesses, survivor classes and suite hashes.

| Scale | Total cap | Specs written | Pairs kept / uncapped | Triples kept (% uncapped; % axis map) | Faults caught | CPU seconds | Pass |
|---|---:|---:|---:|---|---:|---:|---|
| 10x | none | 3,283 | 1,485 / 1,485 | 8,690 (100.00%; 94.85%) | 44 / 70 | 10.981 | yes |
| 10x | 512 | 512 | 1,287 / 1,485 | 3,935 (45.28%; 42.95%) | 44 / 70 | 4.382 | no: pairs lost |
| 10x | 709 | 709 | 1,484 / 1,485 | 4,680 (53.86%; 51.08%) | 44 / 70 | 5.719 | no: pairs lost |
| 10x | 710 | 710 | 1,485 / 1,485 | 4,684 (53.90%; 51.12%) | 44 / 70 | 4.464 | yes |
| 10x | 4096 | 710 | 1,485 / 1,485 | 4,684 (53.90%; 51.12%) | 44 / 70 | 4.697 | yes |
| 10x | 6126 | 710 | 1,485 / 1,485 | 4,684 (53.90%; 51.12%) | 44 / 70 | 4.191 | yes |
| 10x | 6127 | 710 | 1,485 / 1,485 | 4,684 (53.90%; 51.12%) | 44 / 70 | 4.340 | yes |
| 100x | none | 32,067 | 13,510 / 13,510 | 83,722 (100.00%; 94.56%) | 44 / 70 | 97.489 | yes |
| 100x | 512 | 512 | 4,188 / 13,510 | 9,999 (11.94%; 11.29%) | 44 / 70 | 25.105 | no: pairs lost |
| 100x | 709 | 709 | 6,158 / 13,510 | 14,727 (17.59%; 16.63%) | 44 / 70 | 23.786 | no: pairs lost |
| 100x | 710 | 710 | 6,164 / 13,510 | 14,742 (17.61%; 16.65%) | 44 / 70 | 23.220 | no: pairs lost |
| 100x | 4096 | 4,096 | 11,479 / 13,510 | 36,251 (43.30%; 40.94%) | 44 / 70 | 28.263 | no: pairs lost |
| 100x | 6126 | 6,126 | 13,509 / 13,510 | 43,752 (52.26%; 49.41%) | 44 / 70 | 34.579 | no: pairs lost |
| 100x | 6127 | 6,127 | 13,510 / 13,510 | 43,755 (52.26%; 49.42%) | 44 / 70 | 37.499 | yes |

Choose **710 at 10x** and **6,127 at 100x**, explicitly with `--spec-cap-mode pairs`. Each keeps every reached pair and catches exactly the same 44 fault classes as the uncapped suite. Each limit one lower loses a reached pair. These are the smallest passing limits for this deterministic greedy selection, not a global-minimum claim. Larger tested limits at 10x stop after the same 710 useful specs; they do not fill spare capacity with redundant specs.

At 10x, the chosen cap trims **719 t-wise specs and 1,854 cover specs**. At 100x it trims **7,063 t-wise specs and 18,877 cover specs**. It trims no graph, boundary, deviation, metamorphic, task or incomplete probe. Every tested cap retains all 109 protected specs equal to the uncapped parsed specs: graph 6, boundary 39, deviation 20, metamorphic 44. There are no task or incomplete specs in these fixtures. The default tuple-exact mode remains unchanged by this recommendation.

### Fault assay limits and remaining gaps

All rows test the validator's 70 fault classes, one deterministic every-time, anywhere instance per class, with the scripted reference follower. A kill requires a passing reference block and a failed fault block at or after the fault's first changed block, matching the validator's causal rule. Every reference passes; runner errors are zero. The same **44 classes** are caught in all rows, including the rejected smaller caps. No caught class is lost, but this is not evidence for every intermittent or location-specific fault variant, another seed, or another map.

The uncapped suite and chosen caps leave the same 26 classes uncaught. Changed but uncaught: `X1.field-extra`, `X2.fact-flip`, `X2.fact-invent`, `X3.no-report`, `X4.narrate`. No changed trace in this fixture: `X2.slot-first`, `C.no-file`, `C.wrong-name`, `C.wrong-folder`, `C.empty-file`, `C.deletes-input`, `C.touches-other`, `C.temp-left`, `C.no-artifact`, `C.artifact-only`, `C.outside`, `C.absolute`, `C.uppercase`, `C.wrong-ext`, `C.nested`, `C.overwrite-input`, `C.extra-file`, `C.partial`, `C.binary`, `C.says-nothing`, `C.twice`. The code-related classes are not exercised by these conversational maps. The capped suites also leave the reported triples uncovered: 4,478 of 9,162 at 10x and 44,787 of 88,542 at 100x. `coverage.actual[].uncovered` names those tuples; `spec_cap.coverage[].lost` names the subset that the cap removed.

### Verification and speed handoff

Typecheck passes. Lint passes with 20 existing warnings. The final cap, coverage-report, CLI and scenario test run passes **52 tests in 3 files**. A full `pnpm test --maxWorkers=2` run is active; it reports the base handover's Acme fixture mismatches and Acme pilot/extract assertions, plus a generator ladder assertion. Final details will be appended after it finishes. The CLI test was re-run successfully after the report wording changed. `node tools/rename-scope.mjs` ran after the initial main merge and changed zero files.

The separate speed worker has the request to measure `--spec-cap 6127 --spec-cap-mode pairs` with and without its speed fixes. No completed speed-worker result has been received at this checkpoint. The single-generation CPU column above does not establish the validator's two-generation 60-second time gate.
