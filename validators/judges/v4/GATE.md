# Judges ladder version 4 (pointer labellers): where the gate stands

Status: measured. The original section 12.4 gate is **not met** and no lowered bar is recorded here; the lead records
the bar. This file holds the measurement, the arithmetic and a proposal.

## What was measured

The blind pilot: a fresh executor, given only the stripped failing-item list, repaired the pointer labellers of
`packages/estate` with 14 functions emptied (branch `pilot/judges-pointer-blind`, starting commit `57e6478ca`; the
copy is loaded through `DRIFTBENCH_POINTER_IMPL`). The pilot ran against the bank as it was then: version 3 (334
items, they pass on the emptied copy) plus 43 pointer items. The rows are the `executor: blind` rows of
`journal.jsonl`; the builder row 0 is the same measurement before any repair.

| Measure | Value | Section 12.4 |
|---|---|---|
| Bank at the pilot | 377 items (334 of version 3, 43 pointer) | 300 items: holds; no family under 20: not met |
| Score at iteration 0 | 0.8859 (334 of 377); the pointer level alone 0 of 43 | |
| Score after the pilot | 0.9894 (373 of 377); the pointer level alone 39 of 43 | at most 0.4: not met |
| Items fixed per iteration | 3.9 | |
| Forecast | 1.03 iterations (4 failing / 3.9) | at least 100: not met |
| Distinct failing causes | 4 | at least 100: not met |

The four items still red after the pilot were `checkAnswer` refusals: the bank read each refusal by its wording and
told the executor only that the text was unrecognised. That was a defect of the bank, not of the executor, and it is
fixed (a refusal is checked by the part of the answer it names). The executor's final copy passes the repaired items.

## The bank since the pilot

The cheater audit failed the 43-item bank in its first rounds (a run-time lookup of the fixtures, a baked table,
a patch of `Array.prototype.push` and others gained 43 of 43 with every function blank). The bank is now 50 items:
each item also runs cases drawn from the seed against short independent references, seven items scan the module
source, an item fails on a fixture group of another size, the refusal items carry a valid control, and the module
runs in a child that only records its answers while the parent decides every verdict (`tape.ts`, `lock.ts`).
The cause review (re-run on commit 47dc6eb06) found 33 distinct causes in the 43 failing items of the emptied module,
against 27 distinct strings declared by the author; the bank now declares 34 distinct causes for its 50 items. The final blind copy passes 44 of the 50 items: its stack never lets system 1
decide a unit by a sure `none`, a case the closed bank covers and the pilot's feed did not.

## Why the gate cannot be met by this level, in numbers

* The pointer level judges 14 functions. A forecast of 100 at 3.9 items per iteration needs about 390 failing items
  after the pilot, more than the whole bank (384 with version 3).
* A score of 0.4 after the pilot needs about 230 failing items of 384 after ten iterations; the bank holds 50
  pointer items, 43 of them fixed by an executor in ten iterations.
* Distinct causes are bounded by what 14 functions do: 34 declared, 27 found by the independent review for the first
  43 items. The gate asks for 100.
* No family reaches 20 items (the largest, `answer`, has 10). Adding items to reach 20 per family would repeat a
  rule already judged: padding, which section 12.1 rules out.

## The recorded gate

The pointer-labellers level has **no hardness bar**. Its gate is the independent audit of section 12.7, and all four
checks read `pass` in [audit.md](audit.md). The reason is the arithmetic above and the owner's per-validator
allowance ("If you cannot do it, lower the bar per validator"): a level that judges 14 functions has at most a few
dozen real causes, so the section 12.4 terms (forecast 100, 100 causes, score 0.4) cannot hold, and a lowered
number would say nothing about the level. `driftbench validate judges --ladder-version 4 --hardness` therefore
prints the measurement and fails its 12.4 terms; the lead's ruling is that the audit is what gates this level.

Known limits of the audit, ruled out of scope and recorded in audit.md: mining a git commit message until the
hidden seed equals a seed a cheat baked, and reading the validator's memory through a debugger. Follow-up (board,
not this pull request): a salt the auditor keeps for the hidden seed.
