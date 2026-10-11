# Research: validator map

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.

## Iteration 1

Question: packages/generate/src/extract/tools.ts: numberPartitions ignores multipleOf, so schema-keywords.multiple-of loses its multiple and not-multiple values.

Sources read:
* /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/research/testgen/dossier-specification.md (sources 33 and 34: equivalence partitioning, boundary values)
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.2.1 (multipleOf)

What others do: multipleOf splits a numeric input into two partitions, a multiple and a non-multiple; partition testing covers each once.

What to try, and why: the tool pre-pass reads multipleOf: multiple and not-multiple, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.
