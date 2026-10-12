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

The bank is ladder version 2 of map: 578 items over 8 levels. After the ten pilot fixes and 30 executor iterations (11 to 40): 300 of 578 pass (score 0.5190), 51 distinct causes among the failing. Level 0 of 8 on every seed.

## Floor

None in `validators/floors.json`, so CI reads 0. Under section 12.5 the bank is ladder version 2; its floor starts at the level the pilot reached, 0.

## Open items

Level 1 (structured files) still fails on every seed. Failing items per family: adversarial 1, hostile-inputs 5, prompt-containers 30, roles 29, scale 36, schema-keywords 4, semantics 55, style-pairs 91, styles 21, transforms 6. All level 1 items that a pre-pass fix can pass now pass, except the four below, which are validator contradictions (see the section on iterations 26 to 40). Level 2 is next: prompt-containers (30 failing) then the later levels; run `pnpm driftbench validate map --seed 1 --all-levels` to list them.

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

* Iteration 11: packages/generate/src/extract/tools.ts: an optional property with a default gives no at-default partition; schema-keywords.default proves it. It held (commit below in the journal row). Bank 238 of 578 (0.4118).

Rejected, not a pre-pass fault: schema-keywords.closed-object (additionalProperties false on an input gives <tool>.in.unknown-key.sent). Reading it makes styles.v1-precision fail on every seed, because the first-ladder fixtures (render.ts `objectSchema(..., closed=true)`) close every input and plant no unknown-key, so precision calls the value invented. The two items contradict; no honest pre-pass passes both. Fix belongs to the validator lane (plant the value in the v1 truth, or quarantine one item). The change was reverted.

## Next actions

1. Take the next failing level 1 item (tool-formats.legacy-functions, tier 2, then the schema-keywords tier 3 items such as any-of, one-of, all-of); never closed-object (see above).
2. Write the test that reproduces it in `packages/generate/test/extract/` (on exec/map-pilot the pilot's file `tools-keywords.test.ts` shows the pattern: one property, its expected partitions), see it red, make the one change the cause names.
3. Run `pnpm driftbench validate map --seeds 1..20 --hidden --items --json`, write the journal row with bankSize, passing, failingByFamily and bankByFamilyTier, append it with `--journal`, and rewrite this file.

## Pitfalls

* The model in this bank is a perfect model written by code (`bank/perfect.ts`): it reports what a request shows, writes only the keys the answer template in `SYSTEM_PROMPT` shows, and holds 16000 output and 200000 context tokens at four characters a token. A `contract:` item passes once the template shows its key and the proposal keeps it.
* It misreads an entry whose context a request leaves out (a scope heading, a table header, a deprecated marker, the update that replaces a rule): the `extract:` chunk items fail until a chunk carries that context.
* An item passes only when it passes on all 21 seeds. The level stays 0 until all items of level 1 pass, so progress shows in the level 1 value and in `--items`.
* A full `--items` run on 21 seeds takes several minutes on a loaded machine.

## Local state

The worktree carries an UNCOMMITTED edit to packages/validators/src/ladders/index.ts (`map: mapLadder()`), a waiver from the lead so the CLI runs. Never stage it; discard it once the registration PR is on main, then merge main.

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

## Iterations 11 to 25 (executor, branch exec/map-v2)

Each fix is one commit in tools.ts with its test in packages/generate/test/extract/tools-keywords.test.ts: 11 default as at-default; 12 legacy functions list; 13 Bedrock toolSpec; 14 Vercel jsonSchema; 15 agent.tools; 16 stringified parameters; 17 YAML stream; 18 JSON with comments; 19 JSON lines; 20 Cohere parameter_definitions; 21 Vertex function_declarations; 22 LangChain args; 23 OpenAPI 3 and Swagger 2 (six items); 24 OpenAPI query parameters; 25 legacy XML.

Rejected: schema-keywords.closed-object. Reading additionalProperties false makes styles.v1-precision fail on every seed (the v1 fixtures close every input, plant no unknown-key). The two items contradict; the validator lane must plant the value in the v1 truth or quarantine one. Not done by me (validator is out of bounds). closed-object is therefore not counted as fixed.



## Iterations 26 to 40 (executor, branch exec/map-v2)

26 TOML (smol-toml, quotes mapped back to TOML lines); 27 quotes capped at 1000 characters (tools); 28 a dot kept in a property name; 29 inventory title quote capped; 30 markdown-table and CSV inventories (tables.ts); 31 oneOf, anyOf, allOf, discriminator, allOf required; 32 arrays, tuples, nesting to depth 3, recursive $ref once; 33 leaf keywords (object const and enum, contains, minContains, not, propertyNames, contentMediaType, int32, x-nullable); 34 unevaluatedProperties, additionalProperties schema, patternProperties; 35 property dependencies; 36 and 37 readOnly, writeOnly, deprecated; 38 if/then/else; 39 $ref siblings and $anchor; 40 oneOf object children.

Each iteration has a red test first in packages/generate/test/extract (the test fails on the old code, checked by stashing the fix), the journal row, and a commit.

### Items no honest pre-pass fix passes (for the validator owner)

* schema-keywords.closed-object contradicts styles.v1-precision (the v1 fixtures close every input and plant no unknown-key).
* adversarial.property-named-ref expects the dimension id `<tool>.in.$ref`, but the proposal schema allows only lowercase letters, digits, dots, hyphens and underscores in a dimension id, so the extractor throws. Either the id rule or the item has to change.
* schema-keywords.unevaluated-items and additional-items expect only the array partitions plus extra-item; schema-keywords.prefix-items and tuple-items-draft-04 expect one dimension per tuple position. The two expectations cannot both hold for a tuple of one boolean.
* schema-keywords.dependencies fails on seed 12 only: the drawn property name is `reason`, which collides with the item's own second property `reason` (one key overwrites the other).

Handover test at iterations 30 and 40: `driftbench validate map --brief --fresh` prints the live ladder, the items of the first failing level and this file's static instruction; the level (0, 1 structured at 0.9 or more) is reproducible from it without the hypotheses.
