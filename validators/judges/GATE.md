# Gate: the judges bank on needs alone

The hardness gate of docs/validators.md 12.4 is not met. This file records the honest numbers after round 2 of the needs work (NEEDS.md), and why the bank stops here.

## The numbers

Measured by `pnpm driftbench validate judges --hardness` from `validators/judges/journal.jsonl`. A run of HEAD on seeds 1 to 20 and the hidden seed gives the same last row: 253 of 494 items, 83 distinct failing causes.

| Measure | Value | Gate |
|---|---|---|
| Bank (deterministic, kept) | 494 items, 15 families, every tier | at least 300, no family under 20: holds |
| Score at iteration 0 | 0.5142 (254 of 494) | |
| Score after the pilot | 0.5121 (253 of 494) | at most 0.4: fails |
| Items fixed per iteration | -0.1 | at least one item fixed: fails |
| Forecast | none | at least 100: fails |
| Distinct failing causes after the pilot | 83 | at least 100: fails |

Failing items and their distinct causes per family after the pilot:

| Family | Failing | Causes |
|---|---|---|
| injection | 102 | 37 |
| council | 23 | 5 |
| attacks | 22 | 1 |
| precision | 20 | 2 |
| render | 16 | 2 |
| calibration | 13 | 4 |
| consistency | 9 | 5 |
| contract | 9 | 8 |
| cascade | 7 | 3 |
| cassette | 6 | 6 |
| clients | 6 | 6 |
| check | 4 | 4 |
| scale | 4 | 2 |

Families can share a cause (the base screen, for example), so the per-family causes sum to more than 83.

## Why the pilot now fixes nothing

The pilot's ten iterations built leniency into the answer parser in iterations 2 to 7 (case folding, a score in quotes, single quotes, trailing commas, comment lines, typographic quotes). The judges page says "The answer is strict JSON". Round 2 rewrote those six items to ask for the refusal the page states, so each of those iterations now turns one item red. Iterations 8 to 10 fixed refusals that no page states; those items are quarantined. Iteration 1 fixed five items that stay. Net: 254 at iteration 0, 253 after the pilot.

## Why the bank stops here

Every new item must rest on a need a page already states. Round 2 looked for them in three places:

1. The items NEEDS.md flagged as asking more than, or other than, the page: 6 rewritten to the page and failing, 5 rewritten and passing today, 25 quarantined. They are listed in NEEDS.md, "Round 2".
2. Every capability statement of docs/concepts/judges.md and the `driftbench judge` section of docs/reference/cli.md, against the package and its own tests (107 tests in packages/judges/test). Probes on the statements no test covers found one gap: an echoed header value under 8 characters is not redacted. It is the new item `clients/echoed-short-header-redacted`.
3. Design sections of docs/validators.md (4, 12.2, 12.6). These are already the needs of the kept families; no further method in them has a computable answer the bank lacks.

Each of the 7 failing causes of round 2 was planted alone in a scratch copy of packages/judges: on seed 1 exactly its own item turned green and nothing else changed.

To meet the gate at 253 passing items, the bank needs at least 633 items, so 139 more failing items, and 17 more independent causes. The pages do not state that many capabilities the package lacks. Padding the bank with items no page needs is what round 1 removed.

## What would move it

* A page that states a capability the package lacks. The quarantined families (rubric lint, prompt budget, evidence grounding, turn-by-turn judging, pairwise judging) return when a page states them; together they hold 125 items with 69 distinct causes (NEEDS.md lists them).
* A maintainer decision on the 12.6 calibration coverage items (`coverage-*`): they ask for an export beside the Wilson report the page names.
* The gate rule itself (docs/validators.md 12.4): a component that already meets most of its pages cannot also leave 60 percent of a needs-only bank failing.
