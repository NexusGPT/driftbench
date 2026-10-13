# Handover: validator generator

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate generator --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 5 |
<!-- level-table:end -->

The bank holds 2033 items in 26 families, ordered in 22 levels; a level passes when every item of it passes on every seed. After journal row 16 (seed 1 only; the other seeds were not re-measured) seed 1 passes levels 1 to 5 and fails level 6 (the validity gate, 4 items). Bank on seed 1: 1551 of 2033 pass (0.763). The level table below is the pre-merge table of the other seeds and is stale until a full sweep (seeds 1 to 20 and hidden) runs.

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

## Hypotheses tried

Rows 1 to 10 are the pilot (branch `exec/generator-pilot`, merged). Rows 11 to 13 are listed in the journal. Row 14 covers four causes:
- The report states `coverage.measures.*` and `seeders.<seeder>.measures.*` (the validator's definitions: Good-Turing discovery, Chao, Hill, Pielou, t = 3 share, weighted share, required cells, axis values, machine Then share). The 40 `report.*` items pass. Code: `coverageMeasures` in `packages/generate/src/enumerate/generate.ts`.
- A flow phrase opens a path of its flow, in place of the opening move (`choosePhrase(..., opening)` in `scenario.ts`; flow branch in `metamorphicOnPaths`). The metamorphic flow families are complete: `phrases.flows` and `phrases.metamorphic` pass.
- A boundary request that only forbids calls (an invalid value, a write tool asked for early) is said after the walk's first move, and the block expects the conversation to stay on that stage (`turn` in `ScenarioRequest`; boundary seeder). The 13 failing `boundary.*` items pass, and `phrases.data-out` too.
- A single-turn boundary block states the reply language (`paths.lang.boundary` passes).
- Row 15: a transition block's recorded cell now holds the stage it is said at (`saidAt`) and only the data values its Then reads. Gate.accepted.graph, twise, deviation and metamorphic pass.
- Row 16: scale. `cellsOf` in `generate.ts` projects the grid once per map (`gridAt`) and the cover loop reads only the cells a spec reaches (`reachedCells`); the report counts maps up to 4 million cells (the space package refused 277200). Ten times the behaviours: 29 s of CPU for one generation (was 78 s for two); a hundred times completes but takes 384 s of CPU for two against a 60 s budget (`scale.100x.time` still fails; the remaining cost is YAML parsing of each spec and garbage collection, spread thin).
- Tried and reverted: a stable transition phrase per context (no change in then-ignores-edit); letting a requested probe stage skip the first-turn filter (it fixed the Acme cover cells but added 53 constant and echo cheater passes on gen-cover blocks and level 6 got worse, 8 to 10 failing).
- The previous builder's iteration 14 (a second probe of a class at another stage) and 15 (a probe after the last stage; main has its own version) were merged, not journaled separately.

## Next actions

1. Run the full sweep (seeds 1 to 20 and hidden) in the background and write the next journal row from it; the level table is stale.
2. `gate.contrast.then-ignores-edit`: choose one family of pairs (transition siblings) and give the two blocks a different Then or a different cell; measure with the `runGate` script, which takes about 5 minutes.
3. `scale.100x.time`: profile a 30x run with `node --cpu-prof` on `scale-child.ts`; parsing every written spec twice (render then `parseSpecText`) is the largest single cost.
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
