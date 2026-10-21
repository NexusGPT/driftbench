# Round 3: DEV-only work before frozen4

The round-2 reader ships in PR #1058 at 009168cf09ba2eb34cbc4b31a9012e9044454119,
with an independent PASS. Its single frozen3 result remains 56/62 precision and
56/60 recall, below 0.95. Frozen3 is not used to tune this round.

## How DEV was extended

The lane manually wrote 59 fictional labelled rows from the seven public
candidate variables. These are 57 distinct spans and 39 planted conditions,
including two compound spans with two existing conditions each. Code only
assigned stable ids and serialized the handwritten clauses; no clause template
generator was used.

The added cases cover changed numeric boundaries and comparison strictness,
exact unit conversions versus business/calendar-day differences, different
timing stages, categorical helper outcomes, polarity, related entities, and
actions or examples that mention a candidate without stating its condition.
They are in round3-dev-clauses.json. The original 70-row DEV set is retained.

The two DEV batches each start with the same original 15-value/seven-variable
candidate store. This keeps each batch's NEW labels relative to the declared
known list, rather than reclassifying them because another development batch
introduced a similar model proposal. Within each batch the ordinary feed grows
the store sequentially. Together the batches contain 125 spans and 93 planted
conditions.

## Red-first evidence

The unchanged round-2 profile, recorded again on these DEV batches, measured
89/94 precision (0.946809) and 89/93 recall (0.956989). The replay regression
requires both unchanged 0.95 bars. GitHub run 39590815273 is red specifically on
precision: expected 0.9468085106382979 to be at least 0.95.

DEV-only diagnosis found:

* A >48-hour rule also received a yes for >1 day: implication was mistaken for
  identity of numeric guard boundaries.
* A business-day rule was mapped to a calendar-day value.
* Terminal helper failure states were treated as new instead of the categorical
  died value.
* An unconditional helper-task instruction became an invented task-exists
  condition.

The round-3 profile makes numeric identity, exact unit conversion and categorical
state membership explicit. It asks the same repository system-1 judge path,
one independent binary criterion per candidate. System 2 remains behind the
all-no gate and is additionally forbidden to invent existence prerequisites
from an unconditional action. A DEV-calibrated binary threshold is declared in
round3.ts. The source/configuration for round 2 is unchanged.

## Frozen4 protocol

The owner supplied a fresh blind writer's 73 clauses: 40 existing, 20 new,
13 none. Until the single final run, neither clauses nor sealed answers are
opened by this lane. The scorer alone reads the key after durable reader
outcomes, returning aggregate counts.

Clauses SHA-256:
6d73fc5aa25c08ca2ed1964ff9ca2278458aeb4294ab478bf8211a6b245de94c.

Sealed answers SHA-256:
00cfbc15a9ba1b400757347da22ec0368f28c4d351efe16116f081c1b883a8e4.

The same primary rule and separate frozen title-equivalence rule are
pre-registered in the follow-up PR with the final reader/configuration hash
before any input access. Frozen4 is measured once by 15:00 UTC. No tuning
follows its result. The total lane cap remains USD 13, including all prior
rounds, using returned tokens at the published list prices documented in
ROUND2.md.
