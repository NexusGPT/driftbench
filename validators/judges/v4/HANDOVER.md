# Handover: judges ladder version 4, the pointer labellers

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 5 |
<!-- level-table:end -->

This table is the pilot's last row: the emptied copy of the pointer module after ten repairs, level 5 of 6 (the
five labeller levels of version 3 pass on it, the pointer level does not yet).

## Floor

None. Version 2 is the default, with its floor of 20. Version 4 has no floor until its pull request has landed and
the floor is raised with evidence (`validate floors --raise`).

## What version 4 is

Version 3 (334 fixed-label labeller items, from PR 767) plus level 6, `pointer-labellers`: 50 items that judge the
label-reading code of `packages/estate/src/pointer` (14 functions). The level runs in a child process whose
built-in objects are read-only before the module is imported and that only RECORDS the module's answers
(`lock.ts`, `pointer-child.ts`, `tape.ts`); the parent replays them into the items and decides every verdict.
Items run their fixture cases (`fixtures/judges/pointer.json`, made by `make_pointer.py`) and cases drawn from the
seed (`pointer-seeded.ts`); seven items scan the module source. `DRIFTBENCH_POINTER_IMPL` names a copy of the
module (its `pointer/index.ts`) for a pilot.

## Open items

* The pilot ended with 4 `checkAnswer` items red; they were fixed in the bank afterwards (a refusal is checked by
  the part of the answer it names, not by its wording). The pilot rows stay as measured.
* The final blind copy passes 42 of the 50 items of the closed bank (its stack never lets system 1 decide a unit
  by a sure `none`): the bank found a defect the pilot's feed did not show.
* From a built package the level starts its child through the package's own entry point (`pointerBankChild`, as the
  judges version 2 does); it still loads `tsx` when the checkout has it, because the module under audit is TypeScript.

## Hypotheses tried

* Items that read only refusals pass for a module that refuses everything: closed by a valid control in each.
* A fixture lookup, a table baked into the source, a patch of `Array.prototype.push` hidden in a helper folder,
  a `.mts` file or run-time strings, and a replay of the first call all scored 49 of 49 with the module blank
  (audit rounds 1 and 2); the child with read-only built-ins, the seeded cases and the source scan close them.

## Next actions

1. Raise the floor of version 4 with evidence once #692 and #767 have landed.
2. A second gold set with the units in another order for `gold-scan`.

## Pitfalls

* The expected values of `pointer.json` come from `make_pointer.py`; edit the script and regenerate, never the JSON.
* A cheat that is right only at the seeds it baked falls to the blank module's score at the others; the audit counts
  the score that passes on every seed, hidden seed included.

## How to run

```
driftbench validate judges --ladder-version 4 --seed 1 --items
DRIFTBENCH_POINTER_IMPL=<copy>/pointer/index.ts driftbench validate judges --ladder-version 4 --all-levels --blind --items --json
```

## Fixtures

`packages/validators/fixtures/judges/pointer.json` and `make_pointer.py` (standard library only; the script never
reads the TypeScript).
