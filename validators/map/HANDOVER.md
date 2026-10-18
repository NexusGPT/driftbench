# Handover: validator map

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate map --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 9 |
| 2 | 9 |
| 3 | 9 |
| 4 | 9 |
| 5 | 9 |
| 6 | 9 |
| 7 | 9 |
| 8 | 9 |
| 9 | 9 |
| 10 | 9 |
| 11 | 9 |
| 12 | 9 |
| 13 | 9 |
| 14 | 9 |
| 15 | 9 |
| 16 | 9 |
| 17 | 9 |
| 18 | 9 |
| 19 | 9 |
| 20 | 9 |
| hidden | 9 |
<!-- level-table:end -->

Ladder version 3, 2026-10-18: the table above is iteration 1 of version 3, measured on the pilot branch `exec/map-cutter-pilot` at `a7f1ef2b6`, PR 692 plus one fix to the cutter. On the validator branch (PR 692 without that fix) the level is 8: 873 of 879, the six `cutter-masks.masks.link-text.*` items failing on one cause. Level 9, the cutter, holds 301 items in twelve families (`packages/validators/src/ladders/map/bank/families/cutter.ts` and `cutter-audit.ts`). The version 2 journal is `journal-v2.jsonl`; `journal.jsonl` starts at version 3.

The bank is ladder version 2 of map: 578 items over 8 levels. After the ten pilot fixes and 45 executor iterations (11 to 55): 328 of 578 pass (score 0.5675), 31 distinct causes among the failing. Level 0 of 8 on every seed.

## Floor

None in `validators/floors.json`, so CI reads 0. Under section 12.5 the bank is ladder version 2; its floor starts at the level the pilot reached, 0.

## Open items

- Version 3: the hardness gate is not met. The pilot topped the ladder in one iteration (879 of 879); the forecast is 0. The audit (`audit.md`) found 15 of 20 planted bugs and 7 of 13 shortcuts uncaught on the first 188 items; 113 items now answer them and the audit runs again.
- Version 3 depends on PR 692 (the pointer reader) and has to be measured again once it merges. The link-text fix lives only on `exec/map-cutter-pilot`.

Level 1 (structured files) still fails on every seed, only because of the contradictions listed below. Failing items per family: adversarial 1, hostile-inputs 5, prompt-containers 2, roles 29, scale 36, schema-keywords 4, semantics 55, style-pairs 91, styles 21, transforms 6. Level 2 (prompt containers) has two items left (restructured-text, latex). The next bulk is level 3: style-pairs (89 on seed 1) and styles, then level 7 semantics and roles, level 8 scale. Run `pnpm driftbench validate map --seed 1 --all-levels` to list every failing item with its cause.

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

1. Version 3: once PR 692 merges, land the link-text mask fix of `exec/map-cutter-pilot` (commit `a7f1ef2b6`) through its own reviewed PR, then measure the map ladder on main.

2. Take the next failing level 1 item (tool-formats.legacy-functions, tier 2, then the schema-keywords tier 3 items such as any-of, one-of, all-of); never closed-object (see above).
3. Write the test that reproduces it in `packages/generate/test/extract/` (on exec/map-pilot the pilot's file `tools-keywords.test.ts` shows the pattern: one property, its expected partitions), see it red, make the one change the cause names.
4. Run `pnpm driftbench validate map --seeds 1..20 --hidden --items --json`, write the journal row with bankSize, passing, failingByFamily and bankByFamilyTier, append it with `--journal`, and rewrite this file.

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

## Iterations 41 to 55 (executor, branch exec/map-v2): prompt containers

A prompt kept inside another file is sent to the model decoded, and each quote the model gives is mapped back to a passage of the file (packages/generate/src/extract/containers.ts, used by extract.ts). The bank checks two things at once: a quote must be inside the file as written and inside the planted rule as decoded, so a mapped quote is the longest run of characters the file writes as they are, contiguous in the file. `viewSources` builds the text the request shows, `rawizeAnswer` rewrites the quotes of an answer before it is accepted.

41 and 42 were the first tries (decoded view alone, then a quote mapping); 43 gave JSON, JSON lines, agent exports (4 items); 44 quoted YAML scalars; 45 quoted strings in TS, PHP, JSON5, Go; 46 literals joined with + or implicitly; 47 template and f-string constants; 48 C# verbatim and SQL doubled quotes; 49 HTML and XML entities and tags (5 items); 50 TOML basic strings and .env; 51 properties files; 52 CSV; 53 Swift interpolation; 54 JSON text parts; 55 Word XML runs.

Two level 2 items remain: restructured-text (a backslash before an inline-markup character) and latex (`\textbf{word}` around a word). Each needs one decoder in containers.ts: a `.rst` view that drops the backslash of an escaped character, and a `.tex` view that drops the command and braces.

The Acme test `is exactly what the extractor writes...` in packages/generate/test/extract/acme.test.ts passes alone but times out at its 5 s limit when the machine load is high (load average above 100 during this run); it is not a regression of these changes.


## Iteration 80 and state (executor, branch exec/map-v2)

* Bank at iteration 80: 577 of 578 pass on seeds 1 to 20 and the hidden seed (score 0.9983). One failing item remains: inventory-forms.no-channel-list (seeds 1, 4, 8, 12, 13, 16, 19, 20, hidden).
* Iteration 80: scale.chunk.constraints-first. A constraint stated in a chunk before the chunk that proposes its values was refused as "not a proposed value" and never retried. `acceptAnswer` now returns those constraints as `deferred`; `extractMap` retries them once after every section has run and removes the refusal when they enter the draft. Test: "keeps a constraint stated in a chunk before the chunk that proposes its values" in packages/generate/test/extract/chunks.test.ts.
* The closed-object fix (an unknown-key dimension per closed tool input) is in: the Acme chain (proposal, approved, space, generated, gated, golden) was regenerated in one commit. Acme before to after: dimensions 46 to 51, proposal values 177 to 182, approved-map values 180 to 185, generated specs 321 to 326 (blocks 1178 to 1184, incomplete 70 to 75), gated blocks 1100 of 1106 to 1101 of 1107, holdout 58 to 56 specs. Faults: 13 of 13 scored faults still killed.
* Remaining item, not a pre-pass fault: inventory-forms.no-channel-list expects no constraint at all, but the extractor correctly emits the behaviour-by-flow constraints that the base form expects. The validator's `code` for that form filters every constraint (packages/validators/src/ladders/map/bank/families/inventory.ts, form no-channel-list); it should drop only the channel constraints. Validator lane to fix.
* Open for the validator lane: packages/validators/test/map/bank.test.ts ("writes a key only when the contract template shows it") and levels.test.ts ("gives roles only when the system prompt of the extractor asks for them") read the live SYSTEM_PROMPT and expect no polarity or role key; the template now states both, by design. They need a fixture template without those keys. PR 80 CI is red only on these two.
* The earlier Open items and Hypotheses sections above are older than iteration 80; the figures there (328 of 578, level 0 at 561) are history.

## Iteration 81: 100 percent

* Bank 578 of 578 on seeds 1 to 20 and the hidden seed (score 1), level 8 of 8 on every seed, after merging main with the validator fixes (PR 127, 134, 136). The final report: ladder 8 on every seed; floor to set: 8 (ladder version 2); fragile: nothing known. The map floor lives in validators/floors.json, a protected file an executor branch cannot change, so the maintainer raises it from a non-exec branch with the evidence run.
* The open items and next actions above are history; nothing remains. Run the validator again to confirm.
