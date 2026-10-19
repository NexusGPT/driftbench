# Blind pilot, estate ledger level (branch exec/estate-ledger-blind)

## Cause table (step 1, before any fix)
Start: seeds 1,2 failed 4 items: class-field (seeds 1,2; also 977, 4242, 3), condition.situation, condition.atoms-by-unit, condition.manifest (seed 2 only).

| id | wrong behaviour | doc sentence broken | fix |
|---|---|---|---|
| ledger-scan.class-field | a pointer atom has no field for the class that decided it (fields: extraction, unit, labelSet, label, cassette, labeler, polarity) | estate.md l.214: "with fields.extraction: pointer, the unit id, the set, the label and the class that decided it" | atoms.ts ~l.117: add fields.class = item.by (system1 or system2) |
| ledger-scan.condition.situation | no (rule, description) pair is planted on seed 2 | estate.md l.209 "the text of that unit becomes the situation of the target's atom" | cause NOT found (see below) |
| ledger-scan.condition.atoms-by-unit | follows from the missing pair ("condition unit undefined") | same | same |
| ledger-scan.condition.manifest | follows from the missing pair ("manifest ... is []") | same | same |

Distinct causes: 2 (1 fixed, 1 unidentified). The three condition items share one cause.

## Rounds
| round | failing before (seeds 1,2) | failing after (1,2 / 977,4242) | sha | change |
|---|---|---|---|---|
| 1 | 4 | 3 / 0 | a47f7e57a | atoms.ts: fields.class = the deciding class |

Vitest `packages/estate/test/pointer/atoms.test.ts`: 14 passed.

## Why the condition items stay red on seed 2 (evidence)
- Seeds 1, 3, 977, 4242 pass. Their CLAUDE.md has a unit labelled `rule` next to a `description` unit (rule then "## Routing", or "## Rules" then rule). The item's labeler plants the condition there (seed 3: unit 4 condition, target 5).
- Seed 2 CLAUDE.md labels (n): 4 description, 5 prohibition, 6 prohibition, 7 rule, 8 rule, 9 gate, 10 gate, 11 description. No `rule` unit has a `description` unit at n-1 or n+1 in any of the 12 files. The labeler plants no condition, so the item finds no pair.
- Product units equal the natural cut (28 units in CLAUDE.md, all labelled, 0 unlabeled, 0 split, 0 refusals). The product maps labels to units correctly (checked denseOpinions / checkAnswer).
- Tried and reverted (not committed, no effect on seed 2): window flush at every heading; front-matter values cut into sentences.
- The doc pages state no rule that would change the unit sequence of seed 2. Candidate explanation: the three items are unsatisfiable on seed 2 for any product (estate has no adjacent rule/description pair), i.e. an item or estate-generator defect. Not proven.

blind pilot: fail 1 item class fixed in round 1 (class-field), 1 round used, residual 3 items (condition.situation, condition.atoms-by-unit, condition.manifest, seed 2 only)
cause review: 2 causes, fixes as listed
