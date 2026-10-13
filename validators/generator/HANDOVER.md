# Handover: validator generator

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate generator --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 5 |
| 2 | 5 |
| 3 | 5 |
| 4 | 5 |
| 5 | 5 |
| 6 | 5 |
| 7 | 5 |
| 8 | 5 |
| 9 | 5 |
| 10 | 5 |
| 11 | 5 |
| 12 | 5 |
| 13 | 5 |
| 14 | 5 |
| 15 | 5 |
| 16 | 5 |
| 17 | 5 |
| 18 | 5 |
| 19 | 5 |
| 20 | 5 |
| hidden | 5 |
<!-- level-table:end -->

Measured on `6756a4cf` (branch `exec/generator-v3`, pull request 306), seeds 1 to 20 and the hidden seed, ladder version 2, 2033 items: 1756 of 2033 items pass on every seed (score 0.864). Every seed is at level 5. Level 6, the validity gate, fails on one item on every seed, `gate.contrast.then-ignores-edit`, which is the first item to rule on below. On seed 1 alone 1825 of 2033 pass (35 items newly pass, 12 newly fail: the eight mode.T items of item 5, the two contrast items of item 2 and two invariance items of item 8); before this branch, on main `a0a3e5d7`, seed 1 alone: 1802 of 2033, level 5. No sweep of all seeds exists for that base; the first sweep of this branch (eight causes in, before main was merged) gave 1733 on every seed.

Every failing item, the seeds it fails on and its first detail: [evidence/sweep-6756a4cf.json](evidence/sweep-6756a4cf.json).

Per level, items passing on every seed:

| Level | Items | Passing on every seed |
|---|---:|---:|
| 1 generate | 25 | 25 |
| 2 differential | 25 | 25 |
| 3 hostile | 26 | 26 |
| 4 reference | 25 | 25 |
| 5 cheaters | 25 | 25 |
| 6 gate | 22 | 20 |
| 7 boundary | 30 | 30 |
| 8 paths | 30 | 30 |
| 9 phrases | 20 | 15 |
| 10 behaviours | 20 | 18 |
| 11 faults | 72 | 44 |
| 12 adequacy | 50 | 37 |
| 13 modes | 141 | 103 |
| 14 coverage | 31 | 31 |
| 15 sequence | 27 | 26 |
| 16 allocation | 20 | 15 |
| 17 report | 40 | 40 |
| 18 minimality | 55 | 0 |
| 19 contrast | 24 | 14 |
| 20 interactions | 1255 | 1149 |
| 21 stability | 50 | 48 |
| 22 scale | 20 | 10 |

## Floor

`validators/floors.json` holds no floor for the generator. The measured level is 5 on every seed. A floor of 5 on ladder version 2 can be set once pull request 306 is on main: it goes through a maintainer branch (`fix/generator-floor`) and an independent review, with the sweep of that main commit as its evidence. The executor does not edit the file.

## What this executor changed

Product code only, in `packages/generate/src/seed`. One cause per commit, each with a test that was red first (`packages/generate/test/seed/*.test.ts`):

| Change | File | Items it moved |
|---|---|---|
| A tool output boundary value walks a path whose approved `states` relation reads the value: the turn that calls the tool gets the value as its answer and its Then states it | `boundary-seeder.ts#statedScenario` | gate.shortcut.passed-by-first-tool, gate.accepted.boundary (on the seeds where every tool is on a flow) |
| A deviation probe records the stage it is said at, as a transition block does | `scenario.ts` (`saidAt` on the probe block) | 20 contrast rejections on seed 1 |
| Every tool value turn is said after a move of a walk and expects the stage it stays at | `boundary-seeder.ts` | fault.X3.no-report, adequacy.X2.fact-invent, X3.no-report, X3.wrong-name, X4.empty, X4.no-question, X4.narrate |
| A valid input of a read-only tool is asked right after the move that calls the tool: the call carries that move's arguments with the value in its field, closed, once | `scenario.ts` (`turn.call`), `boundary-seeder.ts` | adequacy.X1.enum-next, integer-up, integer-invalid, field-missing, case, X2.fact-flip, X5.duplicate (seeds with every tool on a flow) |
| A tool failure whose recovery stays is followed by the same turn with the tool answering, then the rest of the walk | `scenario.ts#toolFailure` | sequence.after.D8_tool_failure |
| A failing turn keeps `input_closed` | `scenario.ts#toolFailure` | adequacy.X1.field-extra |
| A clean walk declares a tool failure perturbation, with the turn itself restoring the tool | `scenario.ts#toolFailurePerturbation` | perturbation.declared.D8_tool_failure, mode.P.D8.hide, retry-many, advance |
| A walk that declares a nudge perturbation holds `rules.one_message_per_turn` | `scenario.ts` | mode.P.X4.double, mode.P.D7.double, mode.P.D7.silent |
| A stage graph walk declares a perturbation for every class it can take, not one drawn class | `graph-seeder.ts`, `scenario.ts` (`perturbEvery`) | perturbation.declared.* and the mode.P items that depended on a draw (six seeds of the first sweep) |
| One metamorphic family over the persona axis has each user say their persona phrase after the first move | `metamorphic-seeder.ts`, `scenario.ts` (`aside`) | phrases.personas |
| A free context axis goes to the allowed value placed on least so far | `seed-drafts.ts#contextAxes`, `SeedContext.usage` | allocation.channel.ratio, allocation.channel.evenness |
| A cell that holds the start stage is covered by a clean walk that declares the first-turn class as its perturbation | `seed-drafts.ts#coverDraft`, `scenario.ts` (`perturb`) | the ten cover items: 1224 of 1224 allowed triples on seed 1 |

`worldFor` moved to `seed/world.ts` so `scenario.ts` can build a tool's answer without an import cycle. The Acme fixtures, the budget pin (`packages/generate/test/enumerate/fixtures/budget-categorical.json`), the pinned counts and the two generate transcripts (`docs/generating.md`, `docs/reference/cli.md`) are regenerated: 504 files, 332 complete specs, 24 cover specs. README.md lines 154 and 437 still say 508 files; README is outside the executor's scope.

## Open items: items to rule on

Each group below fails on every seed unless a seed list is given. For each, the cause is in the validator or in the map it renders, and no change of the generator makes the item pass without failing another item. The evidence is reproducible with the tools at the end of this file.

1. `gate.contrast.then-ignores-edit` (level 6, the item that holds the ladder at 5), with `contrast.write.integer.at-minimum-above-minimum` and `contrast.write.integer.below-maximum-at-maximum`. Ten boundary blocks on seed 1: `gen-boundary-004#b2-value` and `gen-boundary-009#b2-value` (lookup_record quantity below the minimum and above the maximum), 017 and 022 (list_options limit), 030 to 035 (the six values of submit_request units). The correct Then is the same for each pair: an invalid value forbids the call and the conversation stays; the rendered map fixes `units: 2` in the only `uses_tool` relation of submit_request and the follower never sends another value (`follower.ts#call` reads `memory[tool.slot]` for the first input only). `boundary.read.in.below-minimum`, `boundary.read.in.above-maximum` and the six `boundary.write.in.*` items each require a discriminating block per value, so the blocks cannot be merged or dropped. On seeds where a goal shift is possible at its own goal stage, the same gate reason also rejects `D2_goal_shift` said at intake against `D5_language_switch` said at intake (seed 3: gen-cover-026 and five more): going back to intake from intake and staying at intake are the same correct Then, and `cover.pair.deviation.stage` requires the cell.
2. `contrast.read.integer.at-minimum-above-minimum` and `contrast.list.integer.at-minimum-above-minimum` (failing since commit "a valid tool input is asked right after the move that calls the tool"). The item collects every asserted value of the argument in every block of the specs that hold the partition. The above-minimum spec now also holds the walk's own call, whose argument the map fixes at the minimum (`quantity: 2`), so its set contains the at-minimum value. The alternative placement (the value turn before the move) passes these two items and fails adequacy.X1.enum-next, field-missing and case, because the first argument is then bound by nothing the map states.
3. The `X2.slot-first` cluster: fault, adequacy, minimal, stable, mode.P, mode.T and every `pair.*+X2.slot-first` item (56 items). No approved path says a slot twice, and no rule of the rendered prompt says the latest value holds: the contradiction rule says "ask which one holds and stay on the step" (prompt.md, Rules).
4. `minimal.*` (the 54 other items of the level). `vectorOf` groups killing blocks by Then and outcome on every agent, without the When. Every walk of a map opens with the same opening move and the same Then, so two specs of one path share their first blocks. A block cannot drop its Then: `gate.observed.no-machine-then` rejects it.
5. `mode.T.*` (33 items beside the slot-first one; 25 of them on seed 1). `follower.ts` keeps its stage in the session and reads only the last user turn; a teacher-forced block runs in a session of its own (`packages/core/src/runner/run.ts`, mode T), so the follower restarts at the start stage and fails every block after the first. Eight of these items passed on seed 1 before this branch and fail now (`mode.T.X1.enum-next`, `enum-first`, `integer-up`, `integer-invalid`, `field-missing`, `case`, `mode.T.X5.drop`, `mode.T.X5.wrong-tool`): a boundary value turn used to be the first and only block of its spec, the one block the follower passes in mode T; it is now said after a move, which is what makes fault.X3.no-report and the adequacy items pass.
6. `fault.C.*` (20 items) and `behaviour.save.exercised` (seeds where a save behaviour exists). The rendered map holds no relation for the saved file: `exports/record.json` is in `hidden.ts#saveFile` only, and the proposal schema has no relation for a workspace or an artifact outside a task family.
7. `allocation.stage.present`, `ratio`, `evenness`, `hill1`. `counts` reads `block.expect.stage`. A block that expects the start stage is a first-turn class whose recovery stays: the trivial agents report the start stage, the echo agent repeats the recovery's words, and the opening question is in the prompt's prose only, so the constant, echo and copy cheaters pass it (the `cheaters.*` items). The cover items read placements, which count a declared perturbation; this allocation item does not.
8. `invariance.<path>.persona` and `.channel` (6 items). `slots` keeps the `.in.` values of the cell only; two specs with the same inputs and different tool answers (`.out.` values in the Given world) state different values, as the approved `states` relations require. Example on seed 1, path change-request-back: gen-boundary-012 against gen-cover-008, same kind and quantity, found false against true.
9. Masked pairs: `pair.X4.empty+D5.dutch`, `pair.X4.empty+D5.mixed`, `pair.X4.empty+D6.says-skipped`, `pair.X4.no-question+D7.double`, `pair.X4.narrate+D7.silent`, `pair.X5.drop+X5.duplicate`, `pair.X5.drop+X5.write-twice`, `triple.X4.dutch+D5.dutch+X4.empty`. One member removes what the other changes (an empty reply has no language to judge; a dropped call cannot be made twice).
10. `fault.D4.no-reask` (seeds 1, 3, 6, 15, 17, 19, 20) and `adequacy.D4.no-reask` (18 seeds). The map's recovery pattern is `CONFIRM`; the recap question ("Reply CONFIRM to submit the request, or tell me what to change.") holds the word, and the fault still asks the pending question, so the pattern matches.
11. `fault.X2.fact-invent` (the instance at done; seeds 1, 11, 14, 15). The invented fact is the write tool's own first output; on the turn that calls the tool the map's `must_not` names the other tools only, so a second statement of the same field passes.
12. `adequacy.X4.double` (every seed) and `fault.X4.double` at a stage only flows without a nudge recovery reach (seeds 3, 9, 10, 14, 15, 16, 17). The map states one reply per turn for a nudge only (the D7 recovery).
13. `adequacy.D8.advance` (seeds 1, 3, 4, 7, 13, 17, hidden). On a move that stays on its stage (check to check) an agent that advances after the failure ends on the same stage, and the recovery's count is `max: 2`, so one call passes.
14. `sequence.stages.D8_tool_failure` (17 seeds). The item asks for a tool failure at every middle stage of the flows; the map recovers from a failure of one tool, and the validator's own `possible.ts#said` allows the class only on a turn that calls that tool.
15. `perturbation.carrier.D6_instruction_in_data`. The users package carries the class in the world; the follower reads a deviation in the user turn only, so a world carrier would leave every D6 fault unchanged.
16. `mode.P.D2.ignore`. A perturbed run goes on with the walk, so a perturbation's recovery must stay; a goal shift that stays is said at its goal stage, where ignoring it changes nothing.
17. `phrases.data-in` (the write tool's enum phrases), `phrases.data-out`, `phrases.behaviours`, `phrases.flows`. A data request of the write tool is deferred whatever its value (same Then, the contrast gate of item 1). A returned-value request has no approved relation for what the reply states outside a move. A behaviour phrase of a behaviour with a tool makes the follower call it (`follower.ts`, case behaviour) and the map has no relation for that call. A flow with one phrasing has no family; saying its phrase in place of the opening move was tried and reverted: on Acme the reference agent fails gen-graph-005 and gen-graph-006 (24 blocks), because an Acme flow phrase can carry an address or an email.
18. Seeds 3, 6, 13, 16, 17, 18 and 19: a tool no flow calls (list_options with no `uses_tool` relation). `fault.X1.field-extra`, `fault.X5.duplicate`, `fault.X2.fact-flip`, eight `adequacy.X1.*`, `X2.fact-flip` and `X5.duplicate` items, `gate.accepted.boundary`, `phrases.slot-values`, `behaviour.list.exercised`. The map states the arguments of no call of that tool, so its value turns assert one field.
19. Seed 8: `fault.D2.ignore`, `adequacy.D2.ignore`, `stable.D2.ignore`, `mode.F.D2_goal_shift` and the 48 `pair.*+D2.ignore` items. The only flow that recovers from a goal shift walks opening, intake, check; the recovery goes to intake; said at intake it moves nothing, and after the last stage the validator's `possible.ts` (and the generator's) allow only a class whose recovery stays.

## Decision for the owner: scale at a hundred times the behaviours

`scale.100x.*` (10 items) fail because the scale child dies of memory at its 2048 MB heap. One generation at 100 times writes 31940 specs and 165166 blocks in 36.6 s of CPU and holds 644 MB after collection; the child keeps two results, both file maps and the reloaded specs. Full triple coverage on an axis map with a stage needs about 50 specs per behaviour, so the count is inherent to the default target. The budget is 60 s of CPU for two generations, the writes, the reads and the reload. Meeting it needs a default that writes fewer specs on a large map (for example the pairs mode of `--spec-cap` as a default above a size), which trades triple coverage for size. That is a product decision, not an executor's.

## Open item the product can still fix

`allocation.deviation.ratio` on seeds 5, 8 and 20: the tool failure class has 9 probes against 35 for the most probed class on seed 5 (it has no phrase, so no metamorphic family, and one tool). A top-up of the least probed classes after the cover seeder would fix it; not done.

## Hypotheses tried and rejected

- A flow phrase opens the stage graph walk of a flow with one phrasing: passes on the hidden maps, fails 24 blocks on the Acme reference agent. Reverted.
- A goal shift probed after the last stage of a walk (seed 8): the map's derived constraints forbid the class there. Reverted.
- Persona phrases in every persona family: the variants of two families became one-slot siblings that expect the same (9 contrast rejections). One family carries them.
- A perturbation per class drawn with the seeded generator: the extra draws changed the context of every graph walk. The extra classes are taken at their first stage with no draw.

## Next actions

1. Take the rulings on items 1 to 19 to the maintainer. Item 1 alone holds every seed at level 5.
2. After pull request 306 merges, a maintainer sets the generator floor at 5 (`fix/generator-floor`).
3. Fix `allocation.deviation.ratio` (above), then re-run the sweep.

## Pitfalls

* Never edit `packages/validators` or `validators/` bank files from an executor branch: `pnpm -s driftbench validate protect --branch <name> --base origin/main` must report none protected.
* The Acme fixtures are byte pinned. After any generator change: `pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out examples/acme/generated --baseline examples/acme/specs --t 2 --force`, then `pnpm -s biome check --write examples`, then refresh `budget-categorical.json` (the hash of `result.files` per budget, as `budget.test.ts` computes it) and the counts in `packages/generate/test/enumerate/acme.test.ts`, `packages/generate/test/gate/acme-generated.test.ts` and `packages/cli/test/generate.test.ts`.
* A change that adds a seeded draw moves every later draw of the walk. Add choices without a draw where the old output should stand.
* An echo agent repeats every literal word of the spec's `must` patterns: words alone never fail it.
* One sweep takes 70 minutes to several hours on a loaded host. Measure one seed and a few families first (Tools).

## How to run

```
pnpm -s driftbench validate generator --seed 1
node --max-old-space-size=4096 --import tsx packages/validators/src/ladders/generator/bank-run.ts .exec/after.json --seeds 1..20 --hidden --jobs 3
node --import tsx packages/validators/src/ladders/generator/bank-row.ts .exec/after.json .exec/row.json --iteration <n> --before .exec/before.json --hypothesis "<text>" --files <a,b> --commit <sha> --tests "<names>" --minutes <n> --model opus
pnpm -s driftbench validate generator --journal .exec/row.json
```

Run the sweep in a second worktree at a fixed commit: each seed's child reads the source when it starts, so an edit during a sweep mixes two versions.

## Tools

Three scripts, each a few lines, placed in `packages/validators/` and never committed:

- Items by prefix on one seed: build `new SeedData(seed, {}, scale)` and call `evaluate(bankItems().filter(...), data)` as `bank-run.ts` does. Gate, phrases, cover and allocation items take about a minute; fault, adequacy and mode items a few minutes.
- The gate funnel: evaluate `gate.killers`, then read `data.memoized('gate', ...)` for the rejected blocks and their stage details.
- A seed's map on disk: `renderMap(hiddenSpec(seed))` written under the names of `MAP_FILES`, then `pnpm -s driftbench generate --map <dir>/approved.yaml --out <dir>/gen --seed <seed> --force` to read the specs.

## Fixtures

* Hidden specification per seed: `hiddenSpec(seed)` in `packages/validators/src/ladders/generator/hidden.ts`, rendered by `render.ts`; seed 1 is kept in `packages/validators/fixtures/generator/seed-1/`.
* Rule follower `follower.ts`, faults `faults.ts`, cheaters `cheaters.ts`, items `bank*.ts` and `acme.ts`.
* Earlier history of this lane (options A and B, the spec cap, the speed work, the maintainer patch of pull request 178) is in the journal rows 0 to 17 and in the git history of this file.
