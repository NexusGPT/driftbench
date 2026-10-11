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

## Iteration 5

Question: packages/generate/src/extract/tools.ts: typesOf returns no type for a property without type or properties, so a format or a minimum alone gives no partition; schema-keywords.format-without-type and minimum-without-type prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation sections 6.2 to 6.4 and 7.1 (each keyword applies to one instance type)
* /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/research/testgen/dossier-specification.md (source 6: Schemathesis reads the schema as written, edge cases included)

What others do: a keyword constrains only its own instance type, so a schema with minimum and no type constrains numbers; a generator can treat the keyword as stating that type.

What to try, and why: the tool pre-pass infers a property's type from its keywords when the schema states none, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 6

Question: packages/generate/src/extract/tools.ts: partitionsOf adds null for a type list with null even when the enum already listed null, so schema-keywords.type-null gains a duplicate null-2 value.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.1.2 (enum: the instance equals one of the values; null is a value)
* /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/research/testgen/dossier-specification.md (source 33: one case per partition, no duplicates within a class)

What others do: an enum member null and a null type state the same partition; equivalence partitioning keeps one case per class.

What to try, and why: the tool pre-pass gives null once when a nullable enum lists null, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 7

Question: packages/generate/src/extract/tools.ts: walk reads a property's keywords where it stands, so a property that is a $ref gives no partition; schema-keywords.ref-defs and ref-definitions prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core section 8.2.3.1 ($ref) and 8.2.4 ($defs); draft-07 used definitions
* /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/research/testgen/dossier-specification.md (source 6: Schemathesis resolves references before generating)

What others do: a $ref is replaced by the schema it points at before validation; Pydantic and OpenAPI tool schemas put shared enums in $defs or definitions, so a generator resolves them first.

What to try, and why: the tool pre-pass reads a local $ref to $defs or definitions, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 8

Question: packages/generate/src/extract/tools.ts: stringPartitions reads format and pattern only, so a base64 contentEncoding gives no partition; schema-keywords.content-encoding proves it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 8.3 (contentEncoding: the string is encoded binary data)
* /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/research/testgen/dossier-specification.md (source 6: Schemathesis sends invalid inputs next to valid ones)

What others do: contentEncoding states a string shape like format does; the shape gives a valid and an invalid partition.

What to try, and why: the tool pre-pass reads contentEncoding: well-formed and malformed, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 9

Question: packages/generate/src/extract/tools.ts: partitionsOf gives an object no partition from its key count, so schema-keywords.min-max-properties loses its four edges.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation sections 6.5.1 and 6.5.2 (maxProperties, minProperties)
* /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/research/testgen/dossier-specification.md (source 34: boundary values on and either side of each edge)

What others do: minProperties and maxProperties bound the number of keys like minItems and maxItems bound items; boundary analysis tests each edge and the side outside it.

What to try, and why: the tool pre-pass reads minProperties and maxProperties, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.
