# Handover: validator map

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate map --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
| 2 | 0 |
| 3 | 0 |
| 4 | 0 |
| 5 | 0 |
| 6 | 0 |
| 7 | 0 |
| 8 | 0 |
| 9 | 0 |
| 10 | 0 |
| 11 | 0 |
| 12 | 0 |
| 13 | 0 |
| 14 | 0 |
| 15 | 0 |
| 16 | 0 |
| 17 | 0 |
| 18 | 0 |
| 19 | 0 |
| 20 | 0 |
| hidden | 0 |
<!-- level-table:end -->

After pilot iteration 10 (commit a6f767c): level 0 of 8 on every seed. The bank (`validators/map/bank.jsonl`): 180 of 456 items pass on seeds 1 to 20 and the hidden seed, score 0.3947; iteration 0 was 166 of 456, score 0.364. Items fixed per iteration so far: 1.40; failing items left: 276; forecast 197.1 iterations.

## Floor

None: `validators/floors.json` holds no floor for map, so CI reads it as 0. Under section 12.5 the bank is ladder version 2 of map; its floor starts at the level the pilot reaches, 0.

## Open items

Level 1 (structured files) passes 67 of 98 items on every seed. Its failing items: inventory-forms.long-item, inventory-forms.markdown-tables, inventory-forms.csv, tool-formats.bedrock, tool-formats.openapi, tool-formats.swagger, tool-formats.legacy-functions, tool-formats.agent-config, tool-formats.stringified-parameters, tool-formats.multi-document, tool-formats.jsonc, tool-formats.cohere-v1, tool-formats.vercel-json-schema, schema-keywords.one-of, schema-keywords.any-of, schema-keywords.any-of-null, schema-keywords.all-of, schema-keywords.depth-three, schema-keywords.array-of-objects, schema-keywords.array-items-enum, schema-keywords.prefix-items, schema-keywords.contains, schema-keywords.dependent-required, schema-keywords.dependencies, schema-keywords.if-then-else, schema-keywords.not, schema-keywords.closed-object, schema-keywords.additional-properties-schema, schema-keywords.pattern-properties, schema-keywords.discriminator, schema-keywords.recursive-ref. Each item's title names the partition ids the pre-pass must give.

## Hypotheses tried

* Iteration 1: packages/generate/src/extract/tools.ts: numberPartitions ignores multipleOf, so schema-keywords.multiple-of loses its multiple and not-multiple values. Result: held; the item passes on every seed (commit c397266).
* Iteration 2: packages/generate/src/extract/tools.ts: arrayPartitions ignores uniqueItems, so schema-keywords.unique-items loses its duplicate-items value. Result: held; the item passes on every seed (commit 2af2447).
* Iteration 3: packages/generate/src/extract/tools.ts: arrayPartitions only renames the empty case for minItems, so schema-keywords.min-items loses below-min-items and at-min-items. Result: held; the item passes on every seed (commit a40d7a9).
* Iteration 4: packages/generate/src/extract/tools.ts: numberPartitions reads exclusiveMinimum and exclusiveMaximum only as numbers, so a draft-04 schema (minimum with exclusiveMinimum true) gets inclusive bounds; schema-keywords.exclusive-minimum-boolean and exclusive-maximum-boolean prove it. Result: held; the item passes on every seed (commit 4dd67cc).
* Iteration 5: packages/generate/src/extract/tools.ts: typesOf returns no type for a property without type or properties, so a format or a minimum alone gives no partition; schema-keywords.format-without-type and minimum-without-type prove it. Result: held; the item passes on every seed (commit 9234bdb).
* Iteration 6: packages/generate/src/extract/tools.ts: partitionsOf adds null for a type list with null even when the enum already listed null, so schema-keywords.type-null gains a duplicate null-2 value. Result: held; the item passes on every seed (commit c5d444e).
* Iteration 7: packages/generate/src/extract/tools.ts: walk reads a property's keywords where it stands, so a property that is a $ref gives no partition; schema-keywords.ref-defs and ref-definitions prove it. Result: held; the item passes on every seed (commit ebf9a7a).
* Iteration 8: packages/generate/src/extract/tools.ts: stringPartitions reads format and pattern only, so a base64 contentEncoding gives no partition; schema-keywords.content-encoding proves it. Result: held; the item passes on every seed (commit 2e61ff9).
* Iteration 9: packages/generate/src/extract/tools.ts: partitionsOf gives an object no partition from its key count, so schema-keywords.min-max-properties loses its four edges. Result: held; the item passes on every seed (commit a3e43ca).
* Iteration 10: packages/generate/src/extract/tools.ts: locate and readTools know tools and tool_schemas only, so a Gemini file ({ functionDeclarations } at the root or inside the tools list) gives no tool; tool-formats.gemini and gemini-nested prove it. Result: held; the item passes on every seed (commit a6f767c).

None was rejected: each iteration fixed the one keyword or shape its item named.

## Next actions

1. Run `pnpm driftbench validate map --seed 1` and take the next failing item of level 1. The schema keywords left are oneOf, anyOf and anyOf with null, allOf, depth three, array items (objects and enums), prefixItems, contains, dependentRequired and dependencies, if-then-else, not, closed objects, additionalProperties and patternProperties, discriminators, recursive references. The tool shapes left are Bedrock, OpenAPI, Swagger, legacy functions, agent configs, stringified parameters, YAML streams, JSON with comments, Cohere and Vercel. The inventory forms left are a title longer than a quote, markdown tables and CSV.
2. Write the test in `packages/generate/test/extract/tools-keywords.test.ts` (or the prepass tests for an inventory form) from the item's title, see it red, fix `packages/generate/src/extract/tools.ts` or `prepass.ts`.
3. Run the bank with `pnpm tsx packages/validators/src/ladders/map/bank/cli.ts --run --record <n> --note "<what changed>"` and append the journal row; every third iteration ask the maintainer for the handover test of section 10.4.

## Pitfalls

* The bank's perfect model is code: a model port that answers each section with what the request shows, writes only the keys the contract's answer template shows, and holds 16000 output and 200000 context tokens at four characters a token. A semantics item passes only after the contract template (`SYSTEM_PROMPT` in `packages/generate/src/extract/contract.ts`) shows the key it needs (`polarity`, `when`, `weight`, `required` on a value; `role` on a dimension; the relation kinds `tool_order`, `route`, `reply_text`).
* Every styled item checks rule polarity, so the style, pair and scale families stay red until the map carries polarity; after that they show the next cause.
* An item passes only when it passes on all 21 seeds; one seed is not evidence. The ladder level stays 0 until all 98 items of level 1 pass, so progress shows in the level 1 value and in the bank score.
* A full bank run takes about 70 seconds on 21 seeds.

## How to run

```
pnpm driftbench validate map --seed 1
pnpm driftbench validate map --seeds 1..20 --hidden
pnpm tsx packages/validators/src/ladders/map/bank/cli.ts
pnpm tsx packages/validators/src/ladders/map/bank/cli.ts --run --record <n> --note "<text>"
pnpm vitest run packages/generate/test/extract/tools-keywords.test.ts
```

## Fixtures

* The bank is `packages/validators/src/ladders/map/bank/`: `types.ts` (items and levels), `perfect.ts` (the perfect model), `facts.ts` (the oracle's facts), `run.ts`, `ladder.ts`, `hardness.ts`, `styled.ts` (fourteen prompt styles), and one file per family under `families/`. Schema keywords: `families/schema.ts`.
* The first ladder of section 2 is `first.ts`; its seven levels are items of the bank (`families/v1.ts`).
* The hardness rows are `validators/map/bank.jsonl`, iteration 0 first; the pilot's keyword tests are `packages/generate/test/extract/tools-keywords.test.ts`.
