# Handover: validator generator

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate generator --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 5 |
<!-- level-table:end -->

The fresh options A and B measurement reaches level 5 on seed 1. Levels 1 through 5 pass; level 6 passes 19 of 22 items. This stop-at-first-failure run measures 145 of 148 items passing, not the full bank score. Evidence: [seed-1 level report](evidence/options-ab-seed-1-level.json), source code `8359f453`. The full bank holds 2033 items in 26 families and 22 levels; its 21-seed sweep remains active. Row 17 (1551 of 2033 on source `4d94b132`) is the pre-change full-bank baseline. [SWEEP-JOURNAL.md](SWEEP-JOURNAL.md) records the partial measurement and test limitations until the full bank row is available.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The lane proposes a floor of 1 for generator, ladder version 2 (a maintainer change after the merge).

## Open items

Fresh seed-1 level-6 failures on source `8359f453`:
- `gate.shortcut.passed-by-first-tool`: 8 boundary blocks remain vulnerable to the first-tool shortcut.
- `gate.contrast.then-ignores-edit`: 30 boundary blocks have a Then that ignores the edited value.
- `gate.accepted.boundary`: 54 of 72 boundary blocks pass the gate, below its 0.9 threshold.

### Historical findings before options A and B

The following list is historical. The full new sweep is still running.

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

1. Finish the full sweep on the final A+B source, seeds 1 to 20 plus hidden, with two seed workers. Append measured partial results to `SWEEP-JOURNAL.md` before the 06:40 push deadline if it is still running; append the full bank result to `journal.jsonl` once it finishes.
2. Keep the 100x cap, performance and speed work on their separately owned branches. Merge their PRs into this branch only after the owner explicitly authorizes it.
3. Use the fresh sweep's failing items to choose the next generator change. Do not treat the historical list above as a current measurement.

## Approved options A and B

- Optional spec assertions `tools[].input_closed` and `expect.stage_reported` are implemented in the canonical schema, shared checks, runner integration tests, adapters and reference docs. No field default is added; existing saved specs retain their behavior.
- Generated stages require a current-block report. A generated call is closed only when its approved input assertion names every declared input schema property. Partial legacy input assertions remain open.
- Approved `states` relations accept `must`, `must_not`, or both. Both lists support regex-escaped bound tool values. The validator renders these reply requirements and their source evidence for every flow transition.
- The six previously unchecked fault classes are killed by the graph-suite integration test. The all-spec reference smoke before the main merge passes all 426 generated specs.
- Main is merged at `e2a5acdf` (upstream `7c0b3592`); `node tools/rename-scope.mjs` reports no remaining changes. The separate performance PRs are not merged.
- Acme generated fixtures are refreshed. Its inline-email flow phrase now carries the existing `first_message=says-everything` context, so it is not treated as equivalent to a greeting that gives no email.
- Read-only review found that a bound numeric reply value could disagree with the synthetic tool answer. The repair injects the exact typed scalar binding and refuses ambiguous or inconsistent bindings. The bound-reply and related scenario/value tests pass (71 tests); the six-class integration recheck also passes.
- Final typecheck and lint pass at `8359f453`. Full repository tests and the 21-seed sweep are running. Acme extraction, generation and budget rechecks pass all 30 tests. The 7 CLI generation tests and isolated CI action test also pass. The exact system-floor recheck also passes all 1297 items through level 7 on `cf271ae8`. Every failure reported so far has a passing focused recheck, but the full run remains active and no full-suite pass is claimed.
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

The owner authorizes the `follower.compose` repair. A report mutation returning `null` now remains absent when composed with another mutation, in either order. This makes the bank stricter and changes no item's expected answer. The regression test `composed missing-stage reports` fails before the fix (it sees an `intake` report) and passes after the fix. Evidence: `.exec/compose-red.log` and `.exec/compose-green.log`. The next full sweep measures this repaired fault family together with options A and B.
