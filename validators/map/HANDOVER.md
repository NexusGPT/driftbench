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

The bank is ladder version 2 of map: 546 items over 8 levels. Iteration 0 (the extended bank, before any fix): 192 of 546 items pass on seeds 1 to 20 and the hidden seed. After the ten pilot iterations: 207 of 546 pass, 1.50 items fixed per iteration, 339 failing, 112 distinct causes among them (`_captures/v-map/replay/causes-after-pilot.txt`). Level 0 of 8 on every seed.

## Floor

None in `validators/floors.json`, so CI reads 0. Under section 12.5 the bank is ladder version 2; its floor starts at the level the pilot reached, 0.

## Open items

Level 1 (structured files) fails on every seed. Failing items per family after the pilot: adversarial 3, inventory-forms 3, schema-keywords 40, tool-formats 20. Distinct causes after the pilot, per component: contract 12, extract 9, inventory 3, quote 25, tools 63.

How to read a failing item (`driftbench validate map --seed 1`): the message starts with `[family, tier, cause]`, then the capability with its convention (the partition ids, the key or the relation kind the map must hold), then what the run lost and gained as facts, such as `lost value <dimension>/<value>` or `lost polarity rule/R-01 = "must_not"`. The cause names the one change to make: `tools:` is `packages/generate/src/extract/tools.ts`, `inventory:` is `prepass.ts`, `quote:` is `quote.ts` (reading a prompt container), `contract:` is `contract.ts` (a key the answer template must show, then `proposal.ts` and `accept.ts` to store it), `accept:` is `accept.ts`, `extract:` is `extract.ts` (chunked requests and their merge). Items sharing a cause turn green together.

## Hypotheses tried

* Iteration 1: packages/generate/src/extract/tools.ts: numberPartitions ignores multipleOf, so schema-keywords.multiple-of loses its multiple and not-multiple values. It held: the item passes on every seed (commit c397266 on exec/map-pilot).
* Iteration 2: packages/generate/src/extract/tools.ts: arrayPartitions ignores uniqueItems, so schema-keywords.unique-items loses its duplicate-items value. It held: the item passes on every seed (commit 2af2447 on exec/map-pilot).
* Iteration 3: packages/generate/src/extract/tools.ts: arrayPartitions only renames the empty case for minItems, so schema-keywords.min-items loses below-min-items and at-min-items. It held: the item passes on every seed (commit a40d7a9 on exec/map-pilot).
* Iteration 4: packages/generate/src/extract/tools.ts: numberPartitions reads exclusiveMinimum and exclusiveMaximum only as numbers, so a draft-04 schema (minimum with exclusiveMinimum true) gets inclusive bounds; schema-keywords.exclusive-minimum-boolean and exclusive-maximum-boolean prove it. It held: the item passes on every seed (commit 4dd67cc on exec/map-pilot).
* Iteration 5: packages/generate/src/extract/tools.ts: typesOf returns no type for a property without type or properties, so a format or a minimum alone gives no partition; schema-keywords.format-without-type and minimum-without-type prove it. It held: the item passes on every seed (commit 9234bdb on exec/map-pilot).
* Iteration 6: packages/generate/src/extract/tools.ts: partitionsOf adds null for a type list with null even when the enum already listed null, so schema-keywords.type-null gains a duplicate null-2 value. It held: the item passes on every seed (commit c5d444e on exec/map-pilot).
* Iteration 7: packages/generate/src/extract/tools.ts: walk reads a property's keywords where it stands, so a property that is a $ref gives no partition; schema-keywords.ref-defs and ref-definitions prove it. It held: the item passes on every seed (commit ebf9a7a on exec/map-pilot).
* Iteration 8: packages/generate/src/extract/tools.ts: stringPartitions reads format and pattern only, so a base64 contentEncoding gives no partition; schema-keywords.content-encoding proves it. It held: the item passes on every seed (commit 2e61ff9 on exec/map-pilot).
* Iteration 9: packages/generate/src/extract/tools.ts: partitionsOf gives an object no partition from its key count, so schema-keywords.min-max-properties loses its four edges. It held: the item passes on every seed (commit a3e43ca on exec/map-pilot).
* Iteration 10: packages/generate/src/extract/tools.ts: locate and readTools know tools and tool_schemas only, so a Gemini file ({ functionDeclarations } at the root or inside the tools list) gives no tool; tool-formats.gemini and gemini-nested prove it. It held: the item passes on every seed (commit a6f767c on exec/map-pilot).

None was rejected.

## Next actions

1. Run `pnpm driftbench validate map --seed 1` and take the first failing item of level 1; read its cause and its title.
2. Write the test that reproduces it in `packages/generate/test/extract/` (on exec/map-pilot the pilot's file `tools-keywords.test.ts` shows the pattern: one property, its expected partitions), see it red, make the one change the cause names.
3. Run `pnpm driftbench validate map --seeds 1..20 --hidden --items --json`, write the journal row with bankSize, passing, failingByFamily and bankByFamilyTier, append it with `--journal`, and rewrite this file.

## Pitfalls

* The model in this bank is a perfect model written by code (`bank/perfect.ts`): it reports what a request shows, writes only the keys the answer template in `SYSTEM_PROMPT` shows, and holds 16000 output and 200000 context tokens at four characters a token. A `contract:` item passes once the template shows its key and the proposal keeps it.
* It misreads an entry whose context a request leaves out (a scope heading, a table header, a deprecated marker, the update that replaces a rule): the `extract:` chunk items fail until a chunk carries that context.
* An item passes only when it passes on all 21 seeds. The level stays 0 until all items of level 1 pass, so progress shows in the level 1 value and in `--items`.
* A full `--items` run on 21 seeds takes several minutes on a loaded machine.

## How to run

```
pnpm driftbench validate map --seed 1
pnpm driftbench validate map --seeds 1..20 --hidden --items
pnpm driftbench validate map --hardness
pnpm vitest run packages/validators/test/map packages/generate/test/extract
```

## Fixtures

* The bank: `packages/validators/src/ladders/map/bank/` (`types.ts`, `perfect.ts`, `facts.ts`, `run.ts`, `ladder.ts`, `styled.ts`, one file per family under `families/`; `distinctCauses` in `index.ts`).
* The first ladder of section 2: `first.ts` and `packages/validators/fixtures/map/`; its seven levels are items of the bank (`families/v1.ts`).
* The pilot's ten fixes and their tests are on the branch exec/map-pilot; the journal rows measure them on the extended bank.
