# Handover: validator map

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate map --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
<!-- level-table:end -->

No executor iteration has run yet, so the table is empty. The V4 lane's own run (`pnpm driftbench validate map --seeds 1..20 --hidden`, at commit 8abd7e2, before the first executor) reached level 4 of 7 on seeds 1 to 20 and on the hidden seed: levels 1 to 4 pass at 1.0 on every seed, level 5 fails at 0.75 on every seed.

## Floor

None: `validators/floors.json` holds no floor for map, so CI reads it as 0. Level 1 holds on seeds 1 to 20 and the hidden seed; a floor rise is a maintainer commit of its own (`pnpm driftbench validate floors --raise map 4 --evidence <run.json>`).

## Open items

Level 5 (metamorphic invariance), one item on every seed: `transform:permute`, pointing at `packages/generate/src/extract/space.ts`. The prompt with its sections in reverse order gives a map whose persona and data axes differ: `proposeRole` makes the first dimension of a kind that arrives an axis and the others details, and the answer contract (`packages/generate/src/extract/contract.ts`) carries no role, so the axis follows the order the sections appear in. The other three transforms (split rules, synonyms, decoys) leave the map unchanged.

Level 7 (roles) will name the same cause once level 5 passes: the specification declares one axis per kind, stated in the prompt by the sentence "Each of these makes a different kind of conversation.", and the extractor has no field to carry it.

## Hypotheses tried

None yet. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Read the item of seed 1: `pnpm driftbench validate map --seed 1`. Write one sentence naming `proposeRole` and the missing role field.
2. Fix one cause: let a model section state a role. Add an optional `role` to `AnswerDimension` in `packages/generate/src/extract/contract.ts`, ask for it in the dimension template of `SYSTEM_PROMPT` (`"role": "<axis or detail>"`), and use it in `acceptAnswer` instead of `proposeRole` when present. Write the test in `packages/generate/test/extract/` that reproduces the item first. The perfect model reads `SYSTEM_PROMPT`: once it shows a `"role":` key, it sends each dimension's declared role (`contractStatesRole` in `oracle.ts`), so no validator file changes.
3. Re-run on seed 1, then `--seeds 1..20 --hidden`, and record the level per seed with `--journal`. Levels 6 and 7 are computed for the first time then. The V4 lane applied exactly this fix to a scratch copy (never committed; the edits are in `_captures/v-map/mutations/mutate.py`, entry `F`) and measured level 7 of 7 on seeds 1 to 20 and the hidden seed.

## Pitfalls

* The extractor runs with no model: the perfect model is code that answers each section from the hidden specification and the rendered spans. A live run with a real model is a separate, billed run the owner approves; `mapLadder({ answerer })` takes a `ModelPort` for it, and nothing in the command wires it.
* The perfect model lists dimensions in the order the prompt states them, as a model reading the prompt would. That is what makes the permute transform move the axes.
* Level 6 runs 20 specifications derived from the seed (`mixSeed(seed, 1000 + i)`), four extractions each. It is the slowest level; it is not computed while level 5 fails.
* A missed prose atom with no refusal points at the section request (`contract.ts`): nothing refused it, so the section answer never reported it.

## How to run

```
pnpm driftbench validate map --seeds 1..20 --hidden
pnpm driftbench validate map --seed 1 --json
pnpm driftbench validate map --brief
pnpm vitest run packages/validators/test/map
```

## Fixtures

* The hidden specification is drawn by `hiddenSpec(seed)` in `packages/validators/src/ladders/map/spec.ts`; the renderer is `render.ts`, the truth `truth.ts`, the perfect model `oracle.ts`, the transforms `transforms.ts`, the levels `levels.ts` with the fixed component table `MAP_COMPONENTS`.
* `packages/validators/fixtures/map/seed-1/` and `seed-2/` hold what seeds 1 and 2 render to (prompt, inventory, tools, the recorded answers, the truth with every span); the fixture test compares them byte for byte.
