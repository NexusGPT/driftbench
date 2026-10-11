# Research: validator map

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.

## Iteration 1

Question: packages/generate/src/extract/tools.ts: numberPartitions ignores multipleOf, so schema-keywords.multiple-of loses its multiple and not-multiple values.

Sources read:
* /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/research/testgen/dossier-specification.md (sources 33 and 34: equivalence partitioning, boundary values)
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.2.1 (multipleOf)

What others do: multipleOf splits a numeric input into two partitions, a multiple and a non-multiple; partition testing covers each once.

What to try, and why: the tool pre-pass reads multipleOf: multiple and not-multiple, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 2

Question: packages/generate/src/extract/tools.ts: arrayPartitions ignores uniqueItems, so schema-keywords.unique-items loses its duplicate-items value.

Sources read:
* /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/research/testgen/dossier-specification.md (source 6: Schemathesis generates edge cases and invalid inputs from a schema)
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.4.3 (uniqueItems)

What others do: uniqueItems true makes an array with a repeated element invalid; schema-driven generators send that invalid case as its own input.

What to try, and why: the tool pre-pass reads uniqueItems: duplicate-items, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 3

Question: packages/generate/src/extract/tools.ts: arrayPartitions only renames the empty case for minItems, so schema-keywords.min-items loses below-min-items and at-min-items.

Sources read:
* /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/research/testgen/dossier-specification.md (source 34: boundary values on and either side of each edge)
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.4.2 (minItems)

What others do: boundary value analysis tests on and just below each edge; minItems is an edge of the item count, so a test needs one item under it and exactly at it.

What to try, and why: the tool pre-pass reads minItems: below-min-items and at-min-items, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 4

Question: packages/generate/src/extract/tools.ts: numberPartitions reads exclusiveMinimum and exclusiveMaximum only as numbers, so a draft-04 schema (minimum with exclusiveMinimum true) gets inclusive bounds; schema-keywords.exclusive-minimum-boolean and exclusive-maximum-boolean prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.2.5 (exclusiveMinimum is a number since draft 6)
* packages/generate/src/extract/tools.ts doc comment (the accepted files include OpenAI and older tool formats, which carry draft-04 schemas)

What others do: draft 6 turned exclusiveMinimum and exclusiveMaximum from booleans that modify minimum and maximum into numbers; tool files from older generators still carry the boolean form.

What to try, and why: the tool pre-pass reads the draft-04 boolean exclusiveMinimum and exclusiveMaximum, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.
