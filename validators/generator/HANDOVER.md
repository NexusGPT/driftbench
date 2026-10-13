# Handover: validator generator

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate generator --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 5 |
<!-- level-table:end -->

The owner resumes this work after the recorded pause and authorizes merging cap PR 155 and speed PR 158 into this branch. The replay-stage edge case and old-cache provenance are repaired. Cap PR 155 is merged at `6236f772`; speed PR 158 is merged at `8d44e8f5`. The plugin interruption stops the measurements after the completed 1x and 10x comparisons. Their source is `1084a1e5`; the 100x comparison and cap refresh remain incomplete. No new sweep is active yet. Options A and B and the separate compose repair are pushed to PR 113 before the 06:40 deadline. Fresh completed seeds 1 through 4 each reach level 5, with 1788, 1791, 1773 and 1789 of 2009 seed-dependent items passing respectively. Seeds 5 through 20 plus hidden and the 24 global items remain unmeasured. This is a partial result, not a full 2033-item bank score. Source code: `8359f453`; [partial sweep evidence](evidence/options-ab-partial-sweep.json). Row 17 (1551 of 2033 on source `4d94b132`) remains the pre-change seed-1-only full-bank baseline. [SWEEP-JOURNAL.md](SWEEP-JOURNAL.md) records the deadline, test results and pause.

The protected validator part of this work (reply renderer, composed follower repair, seed-1 fixtures and their validator tests) has left PR 113 for an independent maintainer; see [Moved to the maintainer](#moved-to-the-maintainer). The seed results above were measured with those changes in place.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The lane proposes a floor of 1 for generator, ladder version 2 (a maintainer change after the merge).

## Open items

Fresh seed-1 level-6 failures on source `8359f453`:
- `gate.shortcut.passed-by-first-tool`: 8 boundary blocks remain vulnerable to the first-tool shortcut.
- `gate.contrast.then-ignores-edit`: 30 boundary blocks have a Then that ignores the edited value.
- `gate.accepted.boundary`: 54 of 72 boundary blocks pass the gate, below its 0.9 threshold.

### Historical findings before options A and B

The following list is historical. The full new sweep is paused after four completed seed workers.

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

The owner approved both options. They are implemented on this branch. The decision record below preserves the original rationale.

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

1. Merge opening-pair PR 174 only after its CI is green. The replay repair is already committed and its focused recheck passes 22 tests.
2. The maintainer applies `.exec/generator-protected-maintainer.patch` on `fix/generator-validator-contracts` (non-executor branch) once PR 113's unprotected changes are on main. Import main after that PR merges, then verify protection against origin/main. Re-measure cap limits and caught classes on the final source; preserve historical stamps.
3. Run a fresh full sweep on the final combined source, seeds 1 to 20 plus hidden, with two seed workers and load logging. The pre-pause files do not count toward this sweep.
4. Append the completed native journal row after all bank items across all requested seeds are measured; use `SWEEP-JOURNAL.md` for partial progress.

## Approved options A and B

- Optional spec assertions `tools[].input_closed` and `expect.stage_reported` are implemented in the canonical schema, shared checks, runner integration tests, adapters and reference docs. No field default is added; existing saved specs retain their behavior.
- Generated stages require a current-block report. A generated call is closed only when its approved input assertion names every declared input schema property. Partial legacy input assertions remain open.
- Approved `states` relations accept `must`, `must_not`, or both. Both lists support regex-escaped bound tool values. The validator renders these reply requirements and their source evidence for every flow transition.
- The six previously unchecked fault classes are killed by the graph-suite integration test. The all-spec reference smoke before the main merge passes all 426 generated specs.
- Main is merged at `e2a5acdf` (upstream `7c0b3592`); `node tools/rename-scope.mjs` reports no remaining changes. The separate performance PRs are merged on resume, as recorded above.
- Acme generated fixtures are refreshed. Its inline-email flow phrase now carries the existing `first_message=says-everything` context, so it is not treated as equivalent to a greeting that gives no email.
- Read-only review found that a bound numeric reply value could disagree with the synthetic tool answer. The repair injects the exact typed scalar binding and refuses ambiguous or inconsistent bindings. The bound-reply and related scenario/value tests pass (71 tests); the six-class integration recheck also passes.
- Final typecheck and lint pass at `8359f453`. The full repository run finishes with 5018 passing tests, 7 failed tests and 43 skips; its CI cleanup hook also times out. Acme extraction, generation and budget rechecks pass all 30 tests. The 7 CLI generation tests, isolated CI action test, and 10 gate/pilot rechecks also pass. The exact system-floor recheck also passes all 1297 items through level 7 on `cf271ae8`. All six affected suites then pass together: 105 tests pass and 4 skip, with one worker and larger test-harness timeouts. The original failures are three stale fixture expectations, three test timeouts, and a system-floor assertion reporting level 2. The exact system rerun passes through level 7; the original failing item was not captured. No bank threshold changes. The initial full-suite failures and the passing recheck are reported separately.
- No external model API calls are made by this work.

## Validator item defects (logged, not edited)

- `gate.shortcut.passed-by-first-tool` on single-turn tool output reads: the follower returns no argument for a read, so no generator Then separates it from the cheater without an input the map does not give.
- `contrast.write.integer.*`: the follower ignores the write tool's integer argument.
- Resolved by option A: `fault.X3.no-report` now has the `stage.reported` check. Its composed variant also retains absent reports after the authorized repair.

## Tools

Gate funnel and fault table on the generated suite: a script with `SeedData(1, {}, ...)`, `data.generated()` and `runGate` as `gated()` does in `packages/validators/src/ladders/generator/bank4.ts` (copy it into `packages/validators/` as `gate.tmp.mts`, never commit it). Items by prefix: a script that calls `evaluate(bankItems().filter(...), data)` as `bank-run.ts` does. `pnpm driftbench validate generator --seed 1` (no `--items`) stops at the first failing level and takes about 6 minutes; `--items` takes about 40.

## Pitfalls

* Do not change bank item expected answers. The owner authorizes the rendered-map reply relations and the separate composed-report repair described below.
* An echo agent repeats every literal word of the spec's `must` patterns: words alone never kill it.
* Acme items read `examples/acme`. The fixtures are regenerated on this branch. For later map changes, regenerate with `pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out examples/acme/generated --baseline examples/acme/specs --t 2 --force` then `pnpm -s biome check --write examples`; pinned counts live in `packages/generate/test/enumerate/acme.test.ts` and `test/gate/acme-generated.test.ts`.
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


## Approved composed-report repair

The owner authorizes the `follower.compose` repair. A report mutation returning `null` now remains absent when composed with another mutation, in either order. This makes the bank stricter and changes no item's expected answer. The regression test `composed missing-stage reports` fails before the fix (it sees an `intake` report) and passes after the fix. Evidence: `.exec/compose-red.log` and `.exec/compose-green.log`. The paused sweep measures this repaired fault family together with options A and B; its completed seed results are recorded above.

## Replay-stage boundary repair

Pre-turn Claude Code step-feed entries remain in the first block for legacy `stage.reached` behavior, with optional `carried: true` provenance. The new `stage.reported` check excludes carried entries. Reports at the user-turn timestamp count in that block only. The T/F/P replay regression fails before the production fix and passes afterward; omitted and false reporting flags retain the prior result. Evidence: `.exec/replay-stage-red-confirmed.log` and `.exec/replay-stage-green.log`, with 130 targeted tests passing across 12 files. Replay adapter version `0.1.1` invalidates pre-fix cache entries for library callers. The T/F/P cache regression fails before the version bump and passes after it; the 27-test recheck confirms the new cached failure stays a failure. Evidence: `.exec/replay-cache-version-red.log` and `.exec/replay-cache-version-green.log`.

## Spec cap: historical PR 155 evidence

This section preserves the pre-integration record from PR 155. Its measurements and handoff instructions apply to that source; the current next actions appear above.

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

Typecheck passes. Lint passes with 20 existing warnings. The final cap, coverage-report, CLI and scenario test run passes **52 tests in 3 files**. A fresh full `pnpm test --maxWorkers=2` run is active against the fixed source. An isolated Acme check reproduces five stale-fixture assertions already named by the base handover. The pilot additionally reports that the committed suite has map hash `b583de68c530` while the approved map has hash `6d29ed7a7539`. The extraction checks pass when re-run with a 60-second test timeout; their first run hit the 5-second default. These fixture and runtime issues are not marked as passes. `node tools/rename-scope.mjs` ran after the initial main merge and changed zero files.

The separate speed worker has the request to measure `--spec-cap 6127 --spec-cap-mode pairs` with and without its speed fixes. No completed speed-worker result has been received at this checkpoint. The single-generation CPU column above does not establish the validator's two-generation 60-second time gate.

### Post-outage integration

The owner directs this PR to remain on its measured base before the outage. At the pre-outage checkpoint, GitHub reports conflicts against `exec/generator-v2` in `packages/generate/src/enumerate/generate.ts`, `packages/generate/src/seed/seeders.ts`, `packages/generate/test/enumerate/acme.test.ts` and this handover. The branch has not merged the newer A/B contracts.

After network restoration, merge `origin/exec/generator-v2` into `exec/generator-cap` in this worktree, preserve both the new contracts and these cap/report invariants, and run `node tools/rename-scope.mjs`. Then re-measure the uncapped and capped suites against the new fault contracts. Recompute the smallest passing limits, retain every reached pair and protected probe, and compare the exact caught class sets. Commit the newly stamped evidence separately from the base merge. Re-run typecheck, lint and tests, and add the speed worker's completed result if supplied. Do not reuse this pre-A/B fault count as evidence for the combined implementation.

## Speed: historical PR 158 evidence

This section preserves the pre-integration record from PR 158. Its measurements apply to that source. The integrated measurements below supersede its performance figures for this branch.

Speed work is based on `ffc1db8c3131d78bb1bf9e1befba05debf525711` from `origin/exec/generator-v2`. It changes neither spec selection nor the cap. The capped measurements use isolated copies of `8ce6daa7` inside the speed worktree, with the same four production changes applied to the after copy. No other branch or worktree is edited.

Changes:
- Unseeded feasibility search visits dimension values directly. Seeded search keeps its shuffle order and random draws.
- Coverage enumerates event products without intermediate arrays and indexes specs by behaviour before channel filtering. Ordering and duplicate-id handling stay unchanged.
- Seeder totals append to existing arrays. The report reuses the complete coverage when all specs are complete, and reuses the triple tally already computed in pair coverage.
- `tools/generator-speed.ts` measures the complete scale window by stage, including both disk writes, both directory reads, every spec reload and cleanup. It hashes every generated file, including the report, after timing.

Profiling precedes the changes. The initial `node --cpu-prof` run shows inclusive sample shares of 10.88% for spec serialization, 6.57% for feasibility completion, 4.90% for report coverage measures, and 18.78% for `loadSpecFile`. Cached YAML serialization preserves bytes but does not improve the measured 10x run; that experiment is reverted. The first retained search change reduces paired 10x generation CPU from 9.195 to 6.989 seconds, and the full window from 18.398 to 14.666 seconds.

The final profiled 100x suite keeps all 32,068 file hashes. Its two generation calls take 66.598 CPU seconds, against 79.943 before. These profile runs are diagnostic, not an adjacent full-window comparison: total CPU is 196.315 before and 205.233 after while the one-minute load rises from 31.01 at the first start to 119.34 at the last end. Use the adjacent measurements below for the full-window comparison.

Measurement method: Apple M4 Pro, Node v24.18.0, hidden seed 1, the same command on each revision, before immediately followed by after. Each command generates twice and checks that both runs match. CPU means process user plus system time in seconds. The output label only selects the measurement JSON filename. The two 100x comparison pairs overlap under the existing machine load; load averages are recorded at both ends of every run.

```sh
node --max-old-space-size=2048 --import tsx tools/generator-speed.ts 100 before
node --max-old-space-size=2048 --import tsx tools/generator-speed.ts 100 after
# On cap commit 8ce6daa7, then the same commit plus the speed changes:
node --max-old-space-size=2048 --import tsx tools/generator-speed.ts 100 before --spec-cap 6127 --spec-cap-mode pairs
node --max-old-space-size=2048 --import tsx tools/generator-speed.ts 100 after --spec-cap 6127 --spec-cap-mode pairs
```

Use factors `1` and `10` for the smaller maps. Add `--cpu-prof --cpu-prof-dir=.exec/speed` before `--max-old-space-size` to profile. Full measurements and per-file SHA-256 manifests remain under `.exec/speed/`, following this handover's measurement convention. No validator or bank file changes.

Adjacent paired results: the capped full window falls from **68.666 to 54.079 CPU seconds**, a **21.24% reduction**, below the 60-second budget. The uncapped 100x window falls from **182.515 to 147.855 CPU seconds**, an **18.99% reduction**, with the same 32,067 specs. Its two generation calls fall from 80.855 to 53.186 seconds. The uncapped 10x window falls from 15.970 to 13.662 seconds. The 1x generation calls improve, but its full-window CPU rises from 2.445 to 2.753 seconds under load. The uncapped pair finishes at 06:40:26 local, before the expected outage; these completed measurements replace the pending update.

CPU seconds by stage. Each cell is before / after.

| Stage | 1x | 10x | 100x | 100x cap 6127 |
|---|---:|---:|---:|---:|
| render_map | 0.049 / 0.019 | 0.028 / 0.048 | 0.073 / 0.067 | 0.089 / 0.095 |
| write_map | 0.029 / 0.002 | 0.004 / 0.053 | 0.017 / 0.027 | 0.083 / 0.027 |
| load_map | 0.169 / 0.181 | 0.306 / 0.232 | 0.814 / 0.775 | 1.031 / 0.926 |
| generate_first | 0.630 / 0.619 | 3.480 / 3.175 | 39.953 / 25.597 | 25.584 / 19.319 |
| generate_second | 0.439 / 0.347 | 3.270 / 2.813 | 40.902 / 27.589 | 24.092 / 17.973 |
| write_suites | 0.261 / 0.617 | 1.778 / 1.646 | 16.954 / 15.110 | 4.758 / 4.625 |
| read_suites | 0.149 / 0.270 | 1.720 / 1.136 | 13.874 / 8.475 | 2.774 / 1.846 |
| reload_specs | 0.591 / 0.602 | 4.705 / 4.018 | 63.784 / 63.366 | 9.053 / 8.012 |
| normalize_specs | 0.002 / 0.015 | 0.007 / 0.010 | 0.079 / 0.767 | 0.013 / 0.017 |
| cleanup | 0.100 / 0.075 | 0.671 / 0.527 | 6.058 / 6.075 | 1.185 / 1.185 |
| **Full window** | **2.445 / 2.753** | **15.970 / 13.662** | **182.515 / 147.855** | **68.666 / 54.079** |
| Wall seconds | 17.667 / 16.583 | 111.601 / 104.718 | 1141.659 / 470.234 | 358.736 / 261.863 |

Load averages are 1 / 5 / 15 minutes. Timestamps identify when each run finishes, in UTC on 2026-10-13.

| Map | Run | Finished UTC | Load at start | Load at end |
|---|---|---|---|---|
| 1x | before | 04:19:22.037 | 181.67 / 150.16 / 105.65 | 176.43 / 150.57 / 106.57 |
| 1x | after | 04:19:45.109 | 173.19 / 150.69 / 107.13 | 165.51 / 150.08 / 107.67 |
| 10x | before | 04:21:44.346 | 158.68 / 149.15 / 107.84 | 139.07 / 147.64 / 112.43 |
| 10x | after | 04:23:37.184 | 139.72 / 147.52 / 112.80 | 144.39 / 147.48 / 116.66 |
| 100x | before | 04:32:31.947 | 95.04 / 84.67 / 71.94 | 283.60 / 259.52 / 188.87 |
| 100x | after | 04:40:26.236 | 285.71 / 260.36 / 189.58 | 117.04 / 162.97 / 171.16 |
| 100x cap 6127 | before | 04:14:25.893 | 50.47 / 55.56 / 59.89 | 105.83 / 88.82 / 74.24 |
| 100x cap 6127 | after | 04:18:58.232 | 108.92 / 90.06 / 74.85 | 186.17 / 150.50 / 105.51 |

All per-file SHA-256 comparisons pass, including the JSON report. Both generations in each run also match.

| Map | Specs | Blocks | Files compared | Changed hashes | Manifest SHA-256 |
|---|---:|---:|---:|---:|---|
| 1x | 434 | 2003 | 435 | 0 | `e3e69214ff0f4aea46ef958b8191ce1ef6eeafa58af373cc68fbe6c4480351a4` |
| 10x | 3283 | 16284 | 3284 | 0 | `510bd91ada0c4ecee2347a87e2fc0dad47fd34969f0f6a3950639d2137992073` |
| 100x | 32067 | 160817 | 32068 | 0 | `cded18f57e73e871e2c819e061864d84828f3f8e887b0ff77e285a17c52b3202` |
| 100x cap 6127 | 6127 | 27092 | 6128 | 0 | `b0af985375bcb2a81a963173aa96a263f7ab18cb40007bf57be7e7dbc390fd2b` |

Manifest hashes cover sorted `path<TAB>file-sha256<NEWLINE>` entries. The uncapped 100x file count remains 32,068, representing 32,067 specs plus the report.

Verification after both full runs finish:
- `pnpm typecheck` and the benchmark tool's separate TypeScript check pass.
- `pnpm lint` passes with four pre-existing warnings.
- Focused coverage, space, seed and generation tests: 18 files and 236 tests pass.
- Full `pnpm exec vitest run --maxWorkers=2` completes on both revisions. Baseline: 352 test files pass and 8 fail; 4,138 tests pass, 15 fail and 38 skip. Speed: 355 files pass and 6 fail; 4,144 tests pass, 12 fail and 38 skip. Wall durations are 2,887.62 and 2,666.99 seconds respectively. Neither full run is green.
- The speed run has five Acme assertion failures that also fail on the baseline, plus seven timeouts: two estate unit tests, the CLI-CI wrapper, the estate and generator CLI floors, the Acme coverage check, and the generator ladder check. The baseline has six Acme assertion failures, five timeouts and four archive-only docs failures. The Acme coverage assertion fails before the change and times out after it.
- The estate file passes all 16 tests, and the CLI-select usage test passes, when retried with `--testTimeout=30000`. The CLI-CI wrapper retry still hits its explicit 120-second timeout and a cleanup race. No assertion in the added tests or focused coverage/search/generation checks fails.
- Four baseline docs failures come from Git excluding the archive under `.exec/`; its checker finds zero pages. All 23 affected docs tests pass when retried with `GIT_CEILING_DIRECTORIES` set to the archive parent, so the checker uses its non-repository fallback. The actual speed worktree has 612 valid links across 50 pages.
- `node tools/rename-scope.mjs` runs; it changes only three README copies in the ignored measurement archives. No merges are performed. `git diff --check` passes.

## Integrated verification checkpoint

The resolved cap conflicts retain the A/B assertions, reply bindings, unreachable budget-pair reporting and current Acme fixture expectations. The Acme report is regenerated and lists actual coverage of 624/637 pairs and 2529/3510 triples. The speed production diff matches its four reviewed file changes. All 104 focused integration tests pass. `node tools/rename-scope.mjs` changes no files; lint passes with 20 warnings and 8 information notices. The owner delegates full suites to CI; the local full run is stopped without a result. The new sweep remains pending. The selected 100x cap receives five process-CPU timing runs, reported as a contended median with no speed-gain claim.

CI protection rejects the executor branch because the approved renderer, composed follower repair and their fixtures/tests touch seven protected validator paths. [The protection job](https://github.com/achammah/driftbench/actions/runs/38362466850/job/115179908448) records the exact list. The protection rule is unchanged; maintainer review is required before merging PR 113. This check is separate from runtime tests.

## Moved to the maintainer

Commit `54e65573` removes every protected path change from PR 113, so `validate protect` passes against main. Protected paths may change only on an independent maintainer branch (docs/validators.md section 8.1, `packages/validators/src/protect.ts`); the GATE files tune hardness and grant no exception. The removed hunks are saved byte-identical in `.exec/generator-protected-maintainer.patch` (a local, untracked file in this worktree; its header lists the contents).

| Path | What it carries | Why it moved |
|---|---|---|
| `packages/validators/src/ladders/generator/render.ts` | Option B reply requirements: `states` relations per flow transition, output dimensions in path `when`, full typed tool inputs, out-value slots | Protected validator code |
| `packages/validators/src/ladders/generator/follower.ts` | Approved composed-report repair: a `null` report stays absent in either mutation order | Protected validator code |
| `packages/validators/fixtures/generator/seed-1/approved.yaml`, `prompt.md` | Seed-1 fixtures regenerated by the new renderer | Protected fixtures |
| `packages/validators/test/generator/approved-replies.test.ts` (new) | Reply renderer tests | Protected test; needs render.ts and the A/B code in PR 113 |
| `packages/validators/test/generator/follower.test.ts` | `composed missing-stage reports` regression | Protected test; needs follower.ts |
| `packages/validators/test/generator/ladder.test.ts` | Ladder expectations for the new renderer | Protected test; needs render.ts |

- What stays in PR 113: Option A (`input_closed`, `stage_reported`) and Option B (`states` must and must_not) in schema, checks, adapters, generator and docs; cap PR 155; speed PR 158; the replay-stage repair. No unprotected test depended on the moved changes: all 28 focused test files pass without them.
- Until the maintainer patch lands, the validator bank renders the old prompt and keeps the old composed-report behavior. The partial A/B sweep above therefore describes source with the patch applied.
- The pinned Acme hashes in `packages/generate/test/enumerate/fixtures/budget-categorical.json` are refreshed. They failed CI before this move too. Every generated spec file is identical to the A/B pin at all five budgets; only `generate-report.json` differs, with the opening-pair reasons from cap commit `9e42656e`. Evidence: `.exec/nr-ab.json` and `.exec/nr-head.json`.
- No floor, threshold or bank expected answer changes.
