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

Further DEV-only diagnosis found actor confusion, unknown lookup results treated
as established absence, a broad mismatch veto rejecting concrete approvals,
and a narrow interpretation of a variable's workflow wording refusing other
states of the same subject. These are DEV observations, not frozen3 diagnoses.

The round-3 profile uses the same repository system-1 judge path,
createJevJudge in packages/judges/src/clients/system1.ts, pinned to jev-1.13.0.
It produces one final yes/no answer per known variable/value candidate. A
primary binary criterion asks whether the condition states that candidate.
Positive candidates receive separate binary checks for actor/polarity/knowledge
compatibility and numeric-parameter equality. A yes survives only when the
first check finds no mismatch and the second affirms equal parameters. Numeric
equality compares cutoff and strictness after exact unit conversion, never
logical range containment. Categorical states permit named role instances and
concrete instances of that same state. Missing, malformed or failed votes stay
unread; they cannot turn into a no that permits a proposal.

System 2 remains behind the all-no gate. It is forbidden to invent an existence
prerequisite from an unconditional action. The variable title's subject defines
the domain, rather than a narrow reading of its workflow wording. Related but
distinct entities are still refused. Proposed descriptions receive the same
system-1 existing-value check before a new value enters the store. Every
assignment retains its exact fictional quote. The binary threshold is 0.5,
declared in round3.ts. Round-2 source/configuration remains unchanged.

Four existing candidate IDs have equivalent explicit renderings: the two
shipment-delay cutoffs in hours, the invoice-difference cutoff in EUR, and absence of response. The initial 15-value store, its IDs and its
titles are unchanged. The question renderer looks up candidate IDs; system 1
judges source semantics. Every other candidate, including newly proposed values,
uses its title. Positive approval retains its original title. The proposer has an
explicit invoice-subject domain including settlement history. The renderings distinguish a conditional response from no
response and make cutoff parameters explicit rather than relying on implication.

A small DEV-only pilot compared the provider's published pinned jev-1.14.0
and the native question path. Neither resolved the numeric implication error
with the original candidate wording. Explicit candidate renderings resolved the
pilot cases on both versions. The final profile retains jev-1.13.0 and the
repository judge path; title equivalence also retains its frozen jev-1.13.0
criterion. All exploratory usage is included in the same USD 13 ledger.

Additional red-first runs: 39592549477 (numeric mismatch veto absent),
39595406106 (positive numeric equality guard absent), and 39594624977
(frozen4 recording absent). Run 39595769239 passed typecheck and all four guard
contract cases. These targeted jobs are not full-train passes.
Run 39597436527 additionally proves the recorded DEV cutoff and conditional
response classes red while the aggregate 0.95 floor already passes.
Run 39600398042 proves the stricter positive-approval wording and narrow invoice
domain lose DEV recall before refinement.
Run 39598826257 passes typecheck and all guard contracts with the clarified
candidate renderings; its formatter patch is empty.

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

Prices rechecked 2026-10-21: [TypeSafe model pricing](https://docs.typesafe.ai/models)
lists jev-1.13.0 at USD 0.042 per million input tokens, output free;
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
lists claude-sonnet-5-5 at USD 2 per million input tokens and USD 10 per million
output tokens (standard/global). Each returned usage receipt is charged at
those prices in the shared ledger, including all prior rounds and DEV calls.

## Selected DEV result

The selected recording is 92/93 precision and 92/93 recall (0.989247),
with one false-positive assignment and one missed condition: an existing helper
failure state was re-proposed. The original seed remains unchanged. All
extended DEV spans and the explicit approval, invoice-state, cutoff and
conditional-response regressions pass. The reader is frozen at this point;
frozen4 remains unopened.

The live DEV run returned 3,255 responses between 12:35:01 and 12:41:56 UTC,
costing USD 0.418084226. Total lane spend before frozen4 is
USD 4.594155270 / USD 13, including every earlier round and exploratory pilot.

GitHub run 39601819048 passed typecheck and 43 targeted tests in eight files,
including DEV replay, all class regressions, quote provenance, the guard
contracts and historical recordings. It proved semantic equality of DEV JSON
before/after Biome and all 42 source/configuration hashes. Only the selected
DEV JSON and manifest document formatting changed; the reader bytes did not.

## Frozen4: registered primary acceptance met

The single final run measured **59/60 precision and 59/60 recall (0.983333)**,
above both 0.95 thresholds. There is one no_assignment miss and one
incorrect_or_extra_assignment on a planted-condition row. No assignment was
made on a none row. All 73 spans were processed: 40 matched, 19 proposed,
14 unmatched, zero failed, zero unsure, zero refused; 34 proposer calls.

The secondary frozen title check found **19/19 equivalent**, zero different,
zero unread, with coverage **19/20 planted new conditions**. It does not alter
primary precision or recall. The lane never opened the sealed answer key.

Run id: sol-lane-varstore:frozen4:c630a7c14c7339381570567e5d446c311d3ca393.
The [public pre-registration](https://github.com/NexusGPT/driftbench/pull/1070#issuecomment-6316315879)
was created at 12:47:15 UTC. The runner obtained GitHub's server Date at
12:47:42 UTC before first clause access. Provider Date headers range from
12:47:42 to 12:51:56 UTC, before the 15:00 UTC deadline. These headers timestamp
responses; the committed runner enforces the registration/input/call order.

Reader/profile SHA-256:
5d0c06b52bff42081801c37debd43d653c2c1bdf76ffa4c07a0a2488031c015a.
Source/configuration file-map SHA-256:
9bddcf18c6f9ad6c38c7171c37e4e63d4935a05e1bc70dee3279cb17d4b68942.
Manifest document SHA-256:
3ecdea12a9adc82565918b188ad0a54718fb4adfed58261fc03e7675c739b7d1.
All 42 hashes matched before reading, after reading and after scoring.
No reader, prompt, setting, candidate-store or scorer change follows the result.

The run returned 1,923 responses and cost USD 0.217582722. Total actual-price
lane spend, including all earlier rounds and DEV calls, is
**USD 4.811737992 / USD 13**. The public recording preserves exact input bytes,
initial store, reader/proposer vectors and the resulting store/report. Public
usage receipts omit bodies; secondary calls retain only hashes and usage,
never sealed reference titles. The sealed key is not committed.

GitHub targeted job 119234152183 in run 39603636768 passed typecheck and
44 tests in nine files, including every frozen4 outcome and exact source quote.
Biome was applied only to the two frozen4 evidence JSON files. GitHub's
assert.deepStrictEqual proof confirms identical JSON values before/after;
the totals bytes were already compliant. All 42 frozen source/configuration
hashes remain unchanged. The recording file bytes changed from
1eb3f2bbb3effad07b5e4af0f434fc05ad26a7e539646f1fcd26e62dc49e7cda to
8642b0e095e71e989c8df45c1ae068d07c6fc0957fc5d227efe4e499c5815f22.
The totals file remains
cbf671041e3912a69f9ad18180405a3da15d7521e53d38141368812153a33acb.
The targeted job is not a full-train pass; the lead owns train verification.
