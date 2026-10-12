# Handover: validator generator

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate generator --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 4 |
| 2 | 4 |
| 3 | 4 |
| 4 | 4 |
| 5 | 4 |
| 6 | 4 |
| 7 | 4 |
| 8 | 4 |
| 9 | 4 |
| 10 | 4 |
| 11 | 4 |
| 12 | 4 |
| 13 | 4 |
| 14 | 4 |
| 15 | 4 |
| 16 | 4 |
| 17 | 4 |
| 18 | 4 |
| 19 | 4 |
| 20 | 4 |
| hidden | 4 |
<!-- level-table:end -->

The bank holds 2033 items in 26 families, ordered in 22 levels; a level passes when every item of it passes on every seed. After pilot 10 every seed stops at level 4 (green on the rule follower).

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The lane proposes a floor of 1 for generator, ladder version 2 (a maintainer change after the merge).

## Open items

295 distinct causes among 688 failing items, largest first. Each line: the cause, how many items it holds, the component to change, and what the first item says.

- `kill.X1.field-extra`: 54 items, `packages/generate/src/seed/relations.ts#toolExpect`. fault.X1.field-extra: 0 of 5 scored instances killed; survivors: X1.field-extra@any/r1 (changed 279 specs), X1.field-extra@list_options/r1 (changed 90 specs), X1.field-extra@any/r2 (changed 167 specs), X1.field-extra@lookup_record/r1 (changed 268 specs), X1.field-extra@any/r3 (c...
- `kill.X2.fact-flip`: 53 items, `packages/generate/src/seed/relations.ts#recoveryFor`. fault.X2.fact-flip: 0 of 5 scored instances killed; survivors: X2.fact-flip@any/r1 (changed 261 specs), X2.fact-flip@list_options/r1 (changed 90 specs), X2.fact-flip@any/r2 (changed 166 specs), X2.fact-flip@submit_request/r1 (changed 94 specs), X2.fact-flip@any/r3 (changed 44 ...
- `kill.X2.slot-first`: 52 items, `packages/generate/src/seed/scenario.ts#buildScenario`. fault.X2.slot-first: no instance ever changed what an agent did in a generated spec: the suite never sets up X2.slot-first; it lacks a tools input or end state assertion after a slot is restated
- `kill.X2.fact-invent`: 50 items, `packages/generate/src/seed/relations.ts#recoveryFor`. fault.X2.fact-invent: 0 of 5 scored instances killed; survivors: X2.fact-invent@any/r1 (changed 293 specs), X2.fact-invent@done/r1 (changed 94 specs), X2.fact-invent@any/r2 (changed 257 specs), X2.fact-invent@choice/r1 (changed 79 specs), X2.fact-invent@any/r3 (changed 236 specs...
- `kill.X4.narrate`: 49 items, `packages/generate/src/seed/relations.ts#recoveryFor`. fault.X4.narrate: 0 of 5 scored instances killed; survivors: X4.narrate@any/r1 (changed 293 specs), X4.narrate@choice/r1 (changed 79 specs), X4.narrate@any/r2 (changed 257 specs), X4.narrate@recap/r1 (changed 115 specs), X4.narrate@any/r3 (changed 236 specs); it breaks "Repl...
- `kill.X4.no-question`: 49 items, `packages/generate/src/seed/relations.ts#recoveryFor`. fault.X4.no-question: 0 of 5 scored instances killed; survivors: X4.no-question@any/r1 (changed 293 specs), X4.no-question@intake/r1 (changed 257 specs), X4.no-question@any/r2 (changed 257 specs), X4.no-question@check/r1 (changed 239 specs), X4.no-question@any/r3 (changed 236 sp...
- `kill.X3.no-report`: 48 items, `packages/generate/src/seed/scenario.ts#buildScenario`. fault.X3.no-report: 3 of 5 scored instances killed; survivors: X3.no-report@any/r1 (changed 293 specs), X3.no-report@opening/r1 (changed 61 specs); it breaks "The runtime reports the stage of every turn."; it lacks a stage check that fails when no stage is reported
- `kill.D2.ignore`: 46 items, `packages/generate/src/seed/scenario.ts#buildScenario`. fault.D2.ignore: no instance ever changed what an agent did in a generated spec: the suite never sets up D2.ignore; it lacks expect.stage at the goal stage after the goal shift
- `acme.coverage`: 1 items, `packages/generate/src/seed/seeders.ts#twiseSeeder`. acme.coverage.complete-pairs: complete Acme specs cover 708 of the 840 allowed pairs at t = 2 (all of them are wanted). Find the missing pairs with `pnpm driftbench generate --map examples/acme/map/approved.yaml --out /tmp/acme --t 2` and `pnpm driftbench space coverage /tmp/acme/specs ...
- `acme.price-sheet-d6`: 1 items, `packages/generate/src/seed/seeders.ts#deviationSeeder`. acme.split.price-sheet-D6: no dev-split gated spec covers the price-sheet flow with an instruction in data (D6); the only such spec, acme-price-sheet, is sealed in the holdout. The generator must write a complete price-sheet spec carrying D6 so the gate can place one in the dev split.
- `acme.price-sheet-path`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. acme.fault.ops-x1-wrong-price: the gated Acme suite does not kill ops-x1-wrong-price: it ran on 0 specs, 0 gated blocks target it, none goes red (it changed nothing observable: no complete spec reaches it). No complete generated spec runs on the ops agent: the price-sheet flow (B-013) ha...
- `acme.price-slot`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. acme.fault.x1-invents-price: the gated Acme suite does not kill x1-invents-price: it ran on 216 specs, 81 gated blocks target it, none goes red. No generated block reads a quoted price: give the map an expected-price slot bound to the catalog.search result and make the block that state...
- `adequacy.D4.no-reask`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.D4.no-reask: in 3 of 19 specs the block where D4.no-reask first changes the agent does not fail: gen-twise-005 block 3, gen-twise-086 block 3, gen-twise-108 block 3
- `adequacy.D8.advance`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.D8.advance: in 1 of 19 specs the block where D8.advance first changes the agent does not fail: gen-twise-198 block 2
- `adequacy.X1.case`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X1.case: in 16 of 279 specs the block where X1.case first changes the agent does not fail: gen-boundary-005 block 0, gen-boundary-006 block 0, gen-boundary-007 block 0
- `adequacy.X1.enum-next`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X1.enum-next: in 16 of 279 specs the block where X1.enum-next first changes the agent does not fail: gen-boundary-005 block 0, gen-boundary-006 block 0, gen-boundary-007 block 0
- `adequacy.X1.field-extra`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X1.field-extra: in 279 of 279 specs the block where X1.field-extra first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X1.field-missing`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X1.field-missing: in 16 of 279 specs the block where X1.field-missing first changes the agent does not fail: gen-boundary-005 block 0, gen-boundary-006 block 0, gen-boundary-007 block 0
- `adequacy.X1.integer-invalid`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X1.integer-invalid: in 271 of 279 specs the block where X1.integer-invalid first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X1.integer-up`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X1.integer-up: in 271 of 279 specs the block where X1.integer-up first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X2.fact-flip`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X2.fact-flip: in 261 of 261 specs the block where X2.fact-flip first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X2.fact-invent`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X2.fact-invent: in 293 of 293 specs the block where X2.fact-invent first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X3.no-report`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X3.no-report: in 293 of 293 specs the block where X3.no-report first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X3.wrong-name`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X3.wrong-name: in 36 of 293 specs the block where X3.wrong-name first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X4.double`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X4.double: in 272 of 293 specs the block where X4.double first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X4.dutch`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X4.dutch: in 36 of 293 specs the block where X4.dutch first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X4.empty`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X4.empty: in 264 of 293 specs the block where X4.empty first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X4.narrate`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X4.narrate: in 293 of 293 specs the block where X4.narrate first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X4.no-question`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X4.no-question: in 293 of 293 specs the block where X4.no-question first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `adequacy.X5.duplicate`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. adequacy.X5.duplicate: in 22 of 261 specs the block where X5.duplicate first changes the agent does not fail: gen-boundary-001 block 0, gen-boundary-002 block 0, gen-boundary-003 block 0
- `allocation.channel.evenness`: 1 items, `packages/generate/src/seed/seeders.ts#twiseSeeder`. allocation.channel.evenness: Pielou evenness 0.859 (at least 0.9); counts web 127, messaging 50
- `allocation.channel.ratio`: 1 items, `packages/generate/src/seed/seeders.ts#twiseSeeder`. allocation.channel.ratio: the most placed value has 195, the least 59 (ratio at most 3); counts web 195, messaging 59
- `allocation.stage.evenness`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. allocation.stage.evenness: Pielou evenness 0.848 (at least 0.9); counts opening 25, intake 400, check 307, choice 89, details 76, recap 134, done 94
- `allocation.stage.hill1`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. allocation.stage.hill1: Hill number of order 1 is 5.21 for 7 values (at least 0.8 of them); counts opening 25, intake 400, check 307, choice 89, details 76, recap 134, done 94
- `allocation.stage.ratio`: 1 items, `packages/generate/src/seed/scenario.ts#buildScenario`. allocation.stage.ratio: the most placed value has 400, the least 25 (ratio at most 3); counts opening 25, intake 400, check 307, choice 89, details 76, recap 134, done 94
- `behaviour.list.exercised`: 1 items, `packages/generate/src/seed/seeders.ts#twiseSeeder`. behaviour.list.exercised: 0 complete specs cover B-004 and hold the Then that exercises it
- `behaviour.save.exercised`: 1 items, `packages/generate/src/seed/seeders.ts#twiseSeeder`. behaviour.save.exercised: 0 complete specs cover B-003 and hold the Then that exercises it
- `behaviour.submit.exercised`: 1 items, `packages/generate/src/seed/seeders.ts#twiseSeeder`. behaviour.submit.exercised: 0 complete specs cover B-005 and hold the Then that exercises it
- `boundary.list.in.above-maximum`: 1 items, `packages/generate/src/seed/seeders.ts#boundarySeeder`. boundary.list.in.above-maximum: 1 of 1 values have no discriminating block: list_options.in.limit.above-maximum (1 blocks hold it, none green on the follower and failed by every cheater)
- `boundary.list.in.below-minimum`: 1 items, `packages/generate/src/seed/seeders.ts#boundarySeeder`. boundary.list.in.below-minimum: 1 of 1 values have no discriminating block: list_options.in.limit.below-minimum (1 blocks hold it, none green on the follower and failed by every cheater)

The other 255 causes hold one or two items each; list them with `pnpm driftbench validate generator --seeds 1..20 --hidden --items`.

## Hypotheses tried

The ten pilot iterations, each one fix to `packages/generate` with a test that fails first. Their journal rows are `validators/generator/journal.jsonl` rows 1 to 10.

1. Pilot 1, commit `1485a88` on `exec/generator-pilot`, bank 1209 to 1237 of 2033. A t-wise row whose behaviour no own path carries walks another flow's path. The generator validator's first failing level (differential, diff.twise.pairs) named allowed pairs no complete t-wise spec held: rows whose behaviour belongs to no flow with a path, or whose flows recover none of the row's deviation, ended incomplete. The row now tries the paths of other flows after its own. On the Acme map 186 specs are complete (168 before); the real Acme agent passes all of them.
2. Pilot 2, commit `350b805` on `exec/generator-pilot`, bank 1237 to 1247 of 2033. The covering array's default strength is 3. The validator's first failing level named diff.twise.triples: complete t-wise specs held no allowed triple of the axes beyond what pairs give by chance. The default strength of the covering array is now 3 (--t 2 keeps the old suite; the committed Acme suite and its tests stay at 2).
3. Pilot 3, commit `7ede370` on `exec/generator-pilot`, bank 1247 to 1254 of 2033. A recovery that moves the conversation ends the walk. The validator's reference level named blocks the rule follower fails after a goal shift: the probe's recovery sends the conversation back to the goal stage, and the scenario then played the path's next turn from the stage the conversation had left. A recovery whose stage after differs from the stage reached now ends the walk after the probe, with no end state, as a tool failure does.
4. Pilot 4, commit `e4ce16a` on `exec/generator-pilot`, bank 1254 to 1253 of 2033. Boundary values of a side-effecting tool go through a path, or forbid the call. The validator's reference level named boundary blocks the rule follower fails: a single turn asked for the side-effecting tool directly and expected the call, while the map calls that tool only on a move of a flow (it is a path's end-state source). Such a value now walks a path that reads it; a value no path reads expects the tool not to run on a request alone. The committed Acme suite is regenerated at strength 2 (it also carries pilot 3's ended walks).
5. Pilot 5, commit `b7f486f` on `exec/generator-pilot`, bank 1253 to 1263 of 2033. A boundary block expects every other tool 0 times. The validator's cheater level named boundary blocks the every-tool and replay cheaters pass: a block on one tool's value expected that tool and said nothing of the others, so an agent calling every tool passed it. The block now expects every other tool of the map 0 times, as a scenario block does.
6. Pilot 6, commit `3f5d3ce` on `exec/generator-pilot`, bank 1263 to 1265 of 2033. A tool failure carries the words of its recovery. The validator's perturbation level named perturbation.recovery.D8_tool_failure: the probe of a tool failure expected the recovery's stage and calls but dropped its must and must_not, so an agent that hid the failure behind a cheerful reply passed. The probe now expects the recovery's words, filled as literal patterns.
7. Pilot 7, commit `dd21aea` on `exec/generator-pilot`, bank 1265 to 1275 of 2033. Invariance families over the persona and channel axes. The validator's contrast level named invariance items: no two complete specs walked a path with the same values under different personas or channels, so nothing checked that an irrelevant change keeps the expectation (CheckList's invariance). The metamorphic seeder now walks each path with its data values fixed under every allowed value of each persona and channel axis, a family whose relation is the same observed outcome. On Acme 216 specs are complete; the real agent passes all of them.
8. Pilot 8, commit `5831234` on `exec/generator-pilot`, bank 1275 to 1276 of 2033. A boundary value carried by a path records its concrete value. Pilot 4 sent the boundary values of a side-effecting tool through a path, and those specs lost the record of the concrete value every boundary spec keeps; the validator's differential level named diff.boundary.in.enum. The path-carried spec now records it.
9. Pilot 9, commit `8a1dc7d` on `exec/generator-pilot`, bank 1276 to 1296 of 2033. A clean path walk declares a perturbation for mode P. The validator's modes level found no complete spec declaring a perturbation, so no perturbed run could apply a deviation. A walk with no probe now declares one: a deviation class whose map recovery keeps the conversation on the stage it reached, said before the turn that leaves that stage, with the recovery as its Then and a window of 0 blocks. The Acme suite is regenerated at t 2; the gate test points at an incomplete spec that still exists.
10. Pilot 10, commit `37cbb94` on `exec/generator-pilot`, bank 1296 to 1345 of 2033. A deviation can arrive on the first turn. The validator's coverage and allocation levels found that no complete spec places a block on the start stage: every probe went in after the first move. A probe now goes in at the start stage too, for the classes a first message can carry (an off-topic question, a language switch, an instruction in data, an out-of-scope request); a silence, a burst, a contradiction, a loose confirmation, a goal shift and a return need an earlier turn. The Acme suite is regenerated at t 2 and stays green on the real agent.

## Next actions

1. Run `pnpm driftbench validate generator --seed 1` and read the first failing level: it names each failing item, its component and what it lacks.
2. Pick the largest cause in Open items whose component you can change (`kill.<class>` lines first: one change there turns about 50 items green). The item text says what the suite lacks, for example "it lacks a must or must_not on the tool answer the reply states".
3. Write a test in `packages/generate/test/seed/scenario.test.ts` that fails on the current code, make the one change, see it pass, then run `pnpm -s vitest run packages/generate packages/validators`.
4. Measure with `node --import tsx packages/validators/src/ladders/generator/bank-run.ts /tmp/bank.json --seeds 1..20 --hidden --jobs 4`, turn it into a row with `bank-row.ts` (see How to run), and record it with `--journal`.

## Pitfalls

* Never edit the bank (`packages/validators/src/ladders/generator/**`): an item you think is wrong goes to the maintainer with the counter-example.
* The Acme items (`acme.*`) read `examples/acme`, not the seed. They run once per bank run, take about 40 s, and need the Acme map; regenerate `examples/acme/generated` with `--t 2` when a test pins it.
* The scale items judge CPU time; a slow machine does not fail them, a slow generator does.
* A full bank run over 21 seeds takes 15 to 50 minutes depending on machine load; check one family first with `--seed 1`.
* Items sharing a cause count once: fixing the cause of a `kill.<class>` turns the fault, adequacy, minimality, stability and interaction items of that class green together.

## How to run

```
pnpm driftbench validate generator --seed 1
pnpm driftbench validate generator --seeds 1..20 --hidden --items
pnpm driftbench validate generator --hardness
node --import tsx packages/validators/src/ladders/generator/bank-run.ts /tmp/after.json --seeds 1..20 --hidden --jobs 4
node --import tsx packages/validators/src/ladders/generator/bank-row.ts /tmp/after.json /tmp/row.json --iteration <n> --before /tmp/before.json --hypothesis "<what you changed and why>" --files <a,b> --commit <sha> --tests "<test names>" --minutes <n> --tokens <n>
pnpm driftbench validate generator --journal /tmp/row.json
```

## Fixtures

* The hidden specification of each seed is drawn by `hiddenSpec(seed)` in `packages/validators/src/ladders/generator/hidden.ts` and rendered by `render.ts`; seed 1 is kept in `packages/validators/fixtures/generator/seed-1/` (refresh: `pnpm exec tsx --tsconfig tsconfig.json packages/validators/fixtures/generator/refresh.ts`).
* The rule follower is `follower.ts`, the 70 fault classes `faults.ts`, the cheaters `cheaters.ts`, the runs `measure.ts`, the items `bank.ts` to `bank4.ts` and `acme.ts`, all in `packages/validators/src/ladders/generator/`.
