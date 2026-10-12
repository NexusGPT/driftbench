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

The bank holds 2033 items in 26 families, ordered in 22 levels; a level passes when every item of it passes on every seed. After iteration 13 every seed passes levels 1 to 5 and fails level 6 (the validity gate). Bank: 1286 of 2033 pass on every seed (it was 1332 one fix earlier: see the regression below).

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The lane proposes a floor of 1 for generator, ladder version 2 (a maintainer change after the merge).

## Open items

Failing items per family: {'interaction-pair': 410, 'modes': 59, 'minimality': 53, 'report': 40, 'adequacy': 21, 'fault-code': 20, 'fault-drift': 16, 'behaviours': 15, 'interaction-triple': 14, 'boundary': 13, 'coverage': 11, 'sequence': 11, 'scale': 10, 'allocation': 10, 'perturbation': 9, 'stability': 9, 'gate': 8, 'phrases': 7, 'paths': 5, 'fault-deviation': 3, 'contrast': 3}.

First failing level, 6 gate, 8 items on seed 1:
- `gate.shortcut.passed-by-first-tool` (8 boundary blocks, e.g. gen-boundary-010..012): a boundary block is rejected because the first-tool trivial agent passes it. Component `packages/generate/src/seed/seeders.ts#boundarySeeder` (the gate reads `renderDraft`).
- `gate.contrast.then-ignores-edit` (275 blocks, e.g. gen-boundary-027#b3-check-to-recap): the Then of a transition block ignores an edit of the user turn. The gate edits the turn and expects the verdict to change.
- `gate.accepted.{graph,twise,boundary,deviation,metamorphic}`: only 15/23, 319/527, 26/36, 38/44, 102/153 blocks pass the gate (need 0.9). They share the two causes above.
- `gate.killers`: classes with no killer in the gated suite (X1.field-extra, X2.fact-flip, X2.fact-invent, X3.no-report, X4.no-question, X4.narrate @any/r1). These are the same `kill.*` causes as before: the suite has no block that fails an agent exhibiting them. Largest lever: about 400 `interaction-pair` items and 100 more items share them.

Known regression to repair: iteration 13 removed the first-turn D9 probe, which was the only block killing `fault.D9.inside` (and `mode.F.D9_out_of_scope`, `cover.pair.channel.stage`, about 41 `pair.*+D9.inside` items). Find a later-stage D9 probe whose Then kills it (the recovery's `at` stages and the phrase context may exclude it), or a first-turn probe with a tool-count Then.

## Hypotheses tried

Iterations 1 to 10 are the pilot (journal rows 1 to 10, branch `exec/generator-pilot`, merged into this branch).

11. Bank 1209 to 1219. The t-wise report counted tuples no possible cell holds (diff.twise.allowed). `packages/generate/src/seed/possible.ts` leaves out pairs no path event reaches; `twise.unreachable` lists them. Merge with the pilot: level 4 on every seed.
12. Bank 1323 to 1325. A boundary block whose every tool count is 0 is passed by a do-nothing reply, so it goes to incomplete/ (test `boundary.test.ts`, red run `.exec/red12.txt`).
13. Level 4 to 5, bank 1332 to 1286. First-turn probes with a words-only Then are passed by constant, echo, copy-given. First attempt (accept a word the constant reply lacks) failed: the echo agent repeats every literal word of the must patterns, so no `must` can kill echo. Second attempt, kept: the first-turn probe goes in only when the recovery leaves the start stage or asks for a call (`discriminates` in `scenario.ts`; red runs `.exec/red13.txt`, `.exec/red14.txt`).

## Next actions

1. Repair the D9.inside regression (see Open items), then re-measure; the bank should pass 1332 again or better with level 5 kept.
2. `gate.shortcut.passed-by-first-tool`: read gen-boundary-010 (`pnpm driftbench generate --map packages/validators/fixtures/generator/seed-1/approved.yaml --out .exec/g --seed 1 --force`) and give the block a count the first-tool agent breaks.
3. `gate.contrast.then-ignores-edit`: read gen-boundary-027 block 3; make the Then depend on the user turn's content.
4. Handover test on the next third iteration: `pnpm driftbench validate generator --brief --fresh`.

## Pitfalls

* Never edit the validator or bank (`packages/validators/**`, the rest of `validators/`).
* An echo agent repeats every literal word of the spec's `must` patterns: words alone never kill it.
* Acme items read `examples/acme`; regenerate with `pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out examples/acme/generated --baseline examples/acme/specs --t 2 --force` then `pnpm -s biome check --write examples`; pinned counts live in `packages/generate/test/enumerate/acme.test.ts` and `test/gate/acme-generated.test.ts`.
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
