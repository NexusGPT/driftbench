# Condition reader: round 2

This is the follow-up to PR #1050. That PR's frozen2 result remains below the bar:
46/53 precision and 46/60 recall. It used two stages, retried 13 protocol-failed
spans alongside 19 budget-blocked spans, enlarged the candidate store between
halves, and lacks independent proof of the reader-freeze/first-call order. Its
timing is unproven. Frozen2 was not used to tune round 2.

## Reader and proposal boundary

`createJudgeConditionReader` uses the existing repository judge port,
`createJevJudge` in `packages/judges/src/clients/system1.ts`. Each candidate
variable/value pair gets one independent binary criterion through
`POST /v1/systemone`, pinned to `jev-1.13.0`. At 0.5 or above the answer is yes;
below 0.5 it is no. A missing, malformed or failed probability stays unread.
The feed calls system 2 only after every candidate was read as no.

The separate `createScopedConditionProposer` uses `claude-sonnet-5-5` to describe
a condition within a listed variable's domain. The listed values are examples,
so a new property, polarity or stage may be proposed. A related entity alone
does not qualify. An unlisted variable is refused. System 1 checks the proposed
description against existing values before the feed admits a new value. The
description comparison has its own rubric because a bare condition description
need not itself be an instruction. Every accepted assignment retains the exact
source quote, checked by the existing feed. No estate validator is changed.

## Development evidence

Development reused the existing blind-writer fictional `dev-clauses.json`:
70 labelled rows, grouped into 68 distinct spans, containing 54 conditions. No
new template generator was made. Only this development set informed changes.

The miss classes were: numeric or polarity neighbours mistaken for exact
candidates; compound conditions losing one candidate; helper-state synonyms
being proposed again; actions mistaken for triggering conditions; and related
entities placed under an overly broad variable domain. Independent candidate
criteria, an exact-condition rubric, a separate description rubric and the
scoped proposer addressed these classes without clause-id rules or language
word lists.

The selected DEV recording is **53/54 precision and 53/54 recall (0.981481)**,
using the primary rule below. There are no unread spans. The remaining error is
an existing positive delay condition represented as a proposed negated exclusion
condition. These are development numbers, not held-out evidence.

Red-first GitHub runs: 39582539738 (judge adapter absent), 39583412045
(primary scorer absent), 39584303911 (scoped proposer absent).
Run 39585042756 passed typecheck and the targeted adapter, scorer, proposer,
feed and historical-recording tests. Its overall train gate is intentionally
not a full-train pass.

## Pre-registered measurement

A planted condition counts as found when the variable is right AND the decision is right. For kind "existing", that means the exact value id. For kind "new", the reader must NOT map it to any existing value and must propose a new value under that variable; the proposed id is not compared. Precision and recall come from that rule alone.

Each prediction can explain at most one planted condition. Every extra
assignment is a false positive. A failed or missing read remains a miss.
Precision is correct assignments divided by all assignments; recall is correct
assignments divided by all planted conditions. Titles never change these counts.

Title equivalence is secondary only. For each primary-correct new proposal, a
separate frozen binary Jev criterion compares its proposed title with the sealed
`expected_new_value.title`. At 0.5 or above it is equivalent; below 0.5 it is
different; malformed or failed reads are unread. Report equivalent/checked,
different and unread counts, plus coverage over all planted new conditions.
Neither titles nor verdicts reach the extraction reader or proposer.

A separate writer, blind to this code and DEV set, wrote frozen3: 73 clauses
(40 existing, 20 new, 13 none), covering all seven variables. The supplied hashes
are clauses `31cd72c488a376ddb4547c424cce0bbb89e73a78aaa5de296c33681cacd54a93`
and answers `0f6143ad620e64c4caa1515255dc9d8ea8de5fabc386a14fdf1c50a8a10c3585`.
The lane never opens the answer key. Only the scorer reads it, after durable
reader outcomes exist, returning aggregate counts alone.

`round2-freeze.json` records source, prompt, configuration and candidate-store
hashes. Before opening clauses, `record-frozen3.ts` checks these bytes, verifies
that the public PR pre-registers this head and the hashes, and creates an
exclusive one-run lock. It verifies the hashes again after reading and scoring.
There is one final measurement, with no post-result tuning. Recordings replay
offline; the sealed answer key is never committed.

## Published prices and spend

Prices checked **2026-10-21**:

* [TypeSafe model pricing](https://docs.typesafe.ai/models):
  `jev-1.13.0`, USD 0.042 per million input tokens; output free.
* [Anthropic model pricing](https://platform.claude.com/docs/en/about-claude/pricing):
  `claude-sonnet-5-5`, standard/global, USD 2 per million input tokens and USD 10
  per million output tokens.

Every response records usage and its actual-price charge. The guard reserves
published full-context input plus the configured output ceiling for in-flight
calls, then releases that reservation against actual usage. Before frozen3,
total lane spend including round 1 and all DEV calls is **USD 1.563168**, against
the authorized **USD 13** cap.

PR #756 already merged as `cee10de5676e3cc6018ff30768b06761badc719a`; its
estate-map-to-store implementation is inherited. It was not closed by this lane.

## Frozen3 result: acceptance remains unmet

The one final run finished **2026-10-21 10:55:21 UTC**, before the 13:00 UTC
deadline. Primary precision is **56/62 = 0.903226** and recall is
**56/60 = 0.933333**. There are six false-positive assignments and four missed
conditions. Miss classes are **one existing condition re-proposed** and **three
new conditions mapped to existing values or not proposed**. All six extra
assignments occurred on planted-condition rows; none occurred on the 13 none
rows. The 0.95 acceptance threshold remains unmet. No tuning or second frozen3
measurement follows this result.

The secondary title check found **15 equivalent / 17 checked** (0.882353),
**2 different**, **0 unread**. Its coverage is **17/20 planted new conditions**.
This does not change primary precision or recall.

Run id: `sol-lane-varstore:frozen3:469a08349ef75a4d5de2cce1df1b518ae9343eda`.
Reader source SHA-256:
`5fc4d9716fcba05675bf978911a5733166a9f10629768f85654143ae9ed3c851`.
The full source/configuration/candidate manifest hash is
`65c5137131466f53f3c450fa9f352182ad70a970d27916c45b9c09782249c41d`.
All manifest hashes matched before reading, after reading and after scoring.

The final [pre-registration comment](https://github.com/NexusGPT/driftbench/pull/1058#issuecomment-6314173752)
was posted at 10:52:35 UTC. The runner recorded GitHub's server Date at
10:52:39 UTC before opening the input. Provider Date headers range from
10:52:39 to 10:55:21 UTC. The committed runner enforces that sequence; provider
headers timestamp responses, not request receipt.

`round2-frozen3.json` preserves the original input bytes as base64, supplied
spans, the initial candidate store, every reader/proposer recording and the
resulting store/report. `round2-frozen3.totals.json` contains aggregate scores,
usage totals and post-run source hashes. Per-call public usage receipts omit
request/response bodies; the private recording receipts retain the fictional
primary calls. Secondary requests containing sealed reference titles are never
saved. The sealed answer key is never committed or opened by the lane.

Frozen3 cost **USD 0.203117938** from 1,952 returned responses. Total lane spend,
including round 1 and every round-2 DEV call, is **USD 1.766285490 / USD 13**.
The owner authorized shipping this reader and continuing DEV-only work on a new
round-3 branch with a fresh blinded frozen4 set; frozen3 is spent for tuning.
