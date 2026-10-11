# Handover: validator map

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate map --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
<!-- level-table:end -->

No executor iteration has run yet. Iteration 0 of the bank (section 12.4), at commit 8ee9523: 166 of 456 items pass on seeds 1 to 20 and the hidden seed, a score of 0.364, level 0 of 8 on every seed. The measurement is the first row of `validators/map/bank.jsonl`.

## Floor

None: `validators/floors.json` holds no floor for map, so CI reads it as 0. Under section 12.5 the bank is ladder version 2 of map, and its floor starts at the level the pilot reaches.

## Open items

Level 1 (structured files, 98 items) fails on every seed with 44 or 45 items: 30 schema keywords the tool pre-pass does not read (multipleOf, uniqueItems, minItems, draft-04 boolean bounds, formats and bounds with no type, oneOf, anyOf, allOf, $ref, deeper nesting, array items, prefixItems, contains, dependentRequired, if-then-else, not, additionalProperties and patternProperties, discriminators, recursive references, contentEncoding, minProperties and maxProperties, a doubled null), 12 tool file shapes it cannot read (Gemini, Bedrock, OpenAPI, Swagger, legacy functions, agent configs, stringified parameters, YAML streams, JSON with comments, Cohere, Vercel), and 3 inventory forms (a title longer than a quote, markdown tables, CSV). Each item names its convention in its title: the partition ids the pre-pass must give.

## Hypotheses tried

None yet. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Run `pnpm driftbench validate map --seed 1` and take the first item of level 1.
2. Write one sentence: the component (`packages/generate/src/extract/tools.ts` for a schema keyword), the cause, the item.
3. Fix that one keyword in the tool pre-pass with a test in `packages/generate/test/extract/tools.test.ts` that reproduces the item first, then run the bank (`pnpm tsx packages/validators/src/ladders/map/bank/cli.ts --run --record <n> --note "<what changed>"`) and append the journal row.

## Pitfalls

* The bank's perfect model is code: a model port that answers each section with what the request shows, writes only the keys the contract's answer template shows, and holds 16000 output and 200000 context tokens at four characters a token. A semantics item passes only after the contract template (`SYSTEM_PROMPT` in `packages/generate/src/extract/contract.ts`) shows the key it needs (`polarity`, `when`, `weight`, `required` on a value; `role` on a dimension; the relation kinds `tool_order`, `route`, `reply_text`).
* Every styled item checks rule polarity, so the style, pair and scale families stay red until the map carries polarity; after that they show the next cause.
* An item passes only when it passes on all 21 seeds; one seed is not evidence.
* A full bank run takes about 70 seconds on 21 seeds; the ladder stops at the first failing level and takes about 2 seconds.

## How to run

```
pnpm driftbench validate map --seed 1
pnpm driftbench validate map --seeds 1..20 --hidden
pnpm tsx packages/validators/src/ladders/map/bank/cli.ts
pnpm tsx packages/validators/src/ladders/map/bank/cli.ts --run --record <n> --note "<text>"
pnpm vitest run packages/validators/test/map
```

## Fixtures

* The bank is `packages/validators/src/ladders/map/bank/`: `types.ts` (items and levels), `perfect.ts` (the perfect model), `facts.ts` (the oracle's facts), `run.ts`, `ladder.ts`, `hardness.ts`, `styled.ts` (fourteen prompt styles), and one file per family under `families/`.
* The first ladder of section 2 is `first.ts`; its seven levels are items of the bank (`families/v1.ts`). Its fixtures for seeds 1 and 2 are in `packages/validators/fixtures/map/`.
* The hardness rows are `validators/map/bank.jsonl`, iteration 0 first.
