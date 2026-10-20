# Condition label: the shipped labeler breaks the label rules on the fixture

Split: `SPLIT.md` (commit 15abc6ad6, before the baseline). Labeler: `system2:anthropic`, `claude-haiku-5-5`, three runs per window, 54 requests per scan of the fixture, a fresh cassette for each scan. Counted: refusals of the check of the answer (a `condition` with no target in the window, a target on a label that takes none, a `condition` that points at a unit that holds no atom). Cost of the whole row: 0.074 USD (`cost.json`, per call from the recorded usage); cap 1.00.

| Set | Scans | Refusals, development files | Refusals, held-out files |
|---|---|---|---|
| shipped (baseline) | 4 | 12, 13, 9, 11 | 2, 3, 4, 2 |
| A: gate takes no target; condition target must be a unit that says what to do | 2 | 8, 7 | 2, 4 |
| B: A, shorter condition, headings are not conditions | 2 | 15, 16 | 1, 2 |
| **C: A, plus a line that says what a file is for or when to use it is a description, never a condition** | 3 | 2, 0, 2 | 0, 0, 0 |

* Fix: the descriptions of two labels in the set (`gate`, `condition`); the system text of the request is unchanged, so no other set changes its requests. `set-shipped.yaml` and `set-candidate.yaml` differ by those two descriptions only.
* Cause on the development files, from the answers: the shipped labeler gave a target to `gate` (the description says "one act before another", which reads as a pair) and labelled the `description:` and "Use when" lines of a skill's front matter `condition`, with no unit to scope in the window.
* Selection: candidates were chosen on the development files only (C has the fewest refusals there). The held-out refusal counts were printed beside the development ones in the first scans, so the held-out set was not blind to the choice; its counts are reported for all scans, and C is the only candidate whose held-out count was 0 in every scan. Candidate C was not changed after its first scan.
* Limits: 3 scans of one candidate on one 14-file estate; a window is asked three times and a unit takes a label only when the runs agree, so this counts the refusals the scan reports, not the single-answer rate. Not measured: another model, another estate.

Applying C changes the hash of the shipped set, so every recorded answer of the fixture cassette (the system 1 ones included) misses: the fixture cassette must be recorded again with the system 1 service, which this lane cannot reach.
