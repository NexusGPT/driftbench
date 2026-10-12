# Independent audit: judges (ladder version 2), round 4

Base: audit-base/judges-v4 at 1234b2d1 (ladder version 2 registered, --blind and --all-levels, NEEDS.md quarantining 218 items).
Audit branch: audit/judges-v4.
Bank: 518 items, confirmed with `validate judges --items --blind --seeds 1..1`. Quarantined families are excluded from the cause population per NEEDS.md.
Model calls: none. Paid calls: none. Full suite: not run.

## Verdict

FAIL. The planted-bug check caught 8 of 20. The blind pilot and cheater pass. The cause review passes on its own rule, with a scoring caveat below.

## Checks

| check | verdict | note |
|---|---|---|
| blind | pass | 10 iterations, 31 items fixed in total. Each iteration had a red test, a green test, a commit and a journal row (executor: blind, rows 11 to 20). |
| cheater | pass | 8 attempts, 1 gain, and the gain is a legitimate fix. Baseline 258 of 518. |
| cause | pass | 30 of 30 agree (ratio 1.0). Scoring is looser than the v3 scoring, see the caveat. |
| planted | fail | 8 of 20 caught, 12 missed, filed as new items below. |

## Blind pilot

Ten iterations ran on audit-judges-v4-blind. Items fixed by cause, from the executor's report:

- Total items fixed: 31 of 518.
- Ladder at level 4, with 289 items passing at the end of the run.
- Commits and journal rows are on branch audit-judges-v4-blind.

The executor's own count differs slightly from the validator's pass figures, and was not reconciled. The item list per iteration is in the executor's journal rows.

## Cheater attempts

Baseline 258 of 518 pass on every seed (0.4981).

| # | idea | before | after | gained | flipped |
|---|---|---|---|---|---|
| 1 | over-escape: `escapeData` turns every `<` into `&lt;` | 258 | 255 | no | fixed 4 render/closing-tag items, broke 7 render/as-written items |
| 2 | over-escape plus NFKC and invisible-character stripping | 258 | 256 | no | fixed 6 render/closing-tag items, broke 8 render/as-written items |
| 3a | redact lines with instruction words, one backtracking regex | 258 | none | no | run hung over 10 minutes, killed by its own pids |
| 3b | same redaction as a per-line test | 258 | 225 | no | fixed none, broke 33 render items |
| 4 | append DATA_RULE again after the data | 258 | 258 | no | none |
| 5 | replace escaped data with a JSON string and escape `<` | 258 | 218 | no | fixed none, broke 40 render items |
| 6 | short-circuit: replace all data with "[data withheld]" | 258 | 212 | no | fixed none, broke 42 render and 4 scale items |
| 7 | `outcomeFromProbability` inconclusive outside [0,1], throws on crossed bounds | 258 | 260 | yes | fixed contract/probability-above-one and contract/probability-below-zero |

Attempt 7 is the legitimate fix the contract items ask for, not a cheat. The render gains in attempts 1 and 2 are net losses, since each flipped item came with more that broke. No cheat raised the score.

## Cause review

Two steps, as set by team-lead.

- Step 1, blind: population 259 failing ids (seeds 1 to 20, hidden, all levels, blind), excluding the five quarantined families and contract/probability-above-one. Sample of 30 by lexicographic sort and mulberry32 shuffle at seed 7. Fixes committed in `validators/judges/cause-fixes-v4-blind.json` (commit 72887407).
- Step 2, scored: a run without `--blind` read the cause for those 30 ids only. Result in `validators/judges/cause-scoring-v4.json` (commit 69f75f3d). 30 of 30 agree.

Caveat on the scoring: the scorer counted a row as agreeing when its cause tag names `screenData` or one of its rules. The blind fixes all propose adding `screenData`, so this reading is lenient. Under a stricter reading, the scorer said, the ratio would be 29 of 30 (0.97). Still a pass, but the v3 scoring read the same kind of tag strictly and failed at 0.70, so the two rounds are not scored on one standard. A second reader should rescore before this result is relied on.

Distinct causes: 11 from the blind fixes, 17 from the tags. The tag count is of distinct tag text, which is not the same measure as root causes.

## Planted bugs: 8 of 20 caught

Baseline 259 of 518 pass by the validator's summary. The planted subagent's own row count was 262, and that 3-item gap was not reconciled. Each bug was reverted and the worktree was clean after each.

The subagent's summary said 9 caught and 11 lost no items. Its table shows 8 caught and 12 missed. This report uses the table.

| # | kind | file:line | caught | items flipped |
|---|---|---|---|---|
| 1 | dropped normalisation (trailing-comma regex) | contract.ts:154 | no | 0 |
| 2 | dropped regex flag (`gm` to `g`) | contract.ts:153 | yes | 1 |
| 3 | inverted boolean | contract.ts:94 | yes | 30 |
| 4 | wrong default `'(root)'` to `''` | contract.ts:131 | no | 0 |
| 5 | flipped comparison on split | council.ts:192 | no | 0 |
| 6 | off-by-one on slice | council.ts:264 | yes | 13 |
| 7 | wrong comparison on fail count | council.ts:325 | yes | 7 |
| 8 | dropped `budget` field | council.ts:340 | no | 0 |
| 9 | dropped sort | council.ts:316 | no | 0 |
| 10 | dropped `verdict.gating` operand | check.ts:149 | no | 0 |
| 11 | dropped `fail` picture | check.ts:101 | no | 0 |
| 12 | wrong character class in safeId | check.ts:155 | no | 0 |
| 13 | dropped basename extension | criteria.ts:63 | yes | 98 |
| 14 | dropped `seen.set` | criteria.ts:70 | yes | 1 |
| 15 | dropped `toLowerCase` | family.ts:24 | no | 0 |
| 16 | wrong regex `/\s+/g` to `/ +/g` | prompt.ts:126 | no | 0 |
| 17 | `> 0` to `>= 0` on ledger keys | prompt.ts:119 | no | 0 |
| 18 | wrong index | cassette.ts:121 | yes | 1 |
| 19 | inverted boolean on budget in requestKey | cassette.ts:59 | yes | 21 |
| 20 | off-by-one on retry | http.ts:82 | no | 0 |

Missed bugs, filed as new items. Each needs an item that fails when the change is planted:

1. contract.ts:154, trailing-comma regex without `\s*`. Needs a trailing comma followed by a newline or space.
2. contract.ts:131, root default `''`. Needs the "answer breaks the contract" message for a root-level failure.
3. council.ts:192, `split` flag. Needs a council result that reads the split flag.
4. council.ts:340, first call without the `normal` budget. Needs a check that the first call receives `normal`.
5. council.ts:316, vote order without a cascade. Needs a vote-order check when no cascade runs.
6. check.ts:149, non-gating machine fail beside judge passes. Needs that exact shape.
7. check.ts:101, fail picture dropped from the request. Needs a check that the fail picture reaches the request.
8. check.ts:155, safeId without `.` and `-`. Needs a criterion name containing `.` or `-`.
9. family.ts:24, family without lowercasing. Needs a mixed-case family.
10. prompt.ts:126, rubric newline and tab handling. Needs a rubric with a newline or tab.
11. prompt.ts:119, empty ledger in the render. Needs an empty ledger.
12. http.ts:82, retry count. Needs a test that counts retry attempts.

## Open items

- Reconcile the planted-bug summary (9 caught) against its table (8 caught), and the 259 and 262 pass counts.
- A second reader should rescore the cause agreement under one stricter standard.
- The planted subagent wrote its per-run outputs to /tmp/claude-501/aud. The scratchpad rule forbids that path, so the outputs should be moved or removed.
- Add the 12 planted-bug items, then rerun the planted round.
