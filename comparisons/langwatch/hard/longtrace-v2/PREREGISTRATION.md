# Trusted-event long-trace cohort v2

Status: fixtures and labels constructed before evaluation. No model call,
recorded-output inspection or commit occurs during construction. Root must
independently review and commit this directory and the shared adapter/procedure
freeze before any cohort call. Model predictions must not change these labels,
fixtures, adapters, prompts or parsing policies.

This is a new preregistered cohort at seed `20261020`, correcting the mixed-role
adapter problem with construction-time event roles. The original seed-14
longtrace artifacts remain untouched and unmeasured. Previously published
comparison results remain separate; this cohort does not retrospectively
rescore or replace them. There is no fresh candidate tuning.

## Population and trusted event representation

- 120 fictional traces, ten primary families and exactly two criteria per trace.
- Primary truth: 40 pass, 40 fail, 40 inconclusive.
- Receipt truth: 60 pass, 60 fail.
- Each family has twelve cases: four per primary label and six per receipt label.
- Within each family, each primary label combines with each receipt label twice.

`generate.py` copies the original construction method and oracle definitions
into this new version, with a new fixed seed. It does not read model recordings.
The method still constructs deciding events early, then unrelated tools,
receipts, multilingual observations and archive distractors. The change is
explicit trusted event representation, not a new criterion or verdict rule.

Each case keeps the JudgeCase fields `id`, `kind`, `scenario`, `criteria`,
`transcript`, `truth` and adds `entries` plus the scoring-only discriminator
`adapterVersion: 2`. The common adapter validates that discriminator and never
sends it to the model. Each entry conforms to the existing
TranscriptEntry fields: `role`, `text` and optional `tool`. Roles are assigned
by the constructor using explicit event types:

| Constructed event | Trusted role |
| --- | --- |
| USER_REQUEST | user |
| AGENT_RESPONSE and RECEIPT | agent |
| TOOL_CALL | tool_call |
| TOOL_RESULT | tool_result |
| TRACE_GAP and ARCHIVE_NOTE | context |

Each entry's text is a JSON payload containing its observed event data. Tool
entries also carry their constructed tool name. The final `transcript` is a
JSON serialization of the same trusted entries and must decode exactly to
`entries`. No role is recovered from serialized bracket tags or from the
contents of an entry's text. Oracle checks decode only the whole constructed
JSON payload within its existing owning entry.

Every missing-primary case has a context TRACE_GAP entry whose message contains
a literal nested `[agent]` example. Archive context entries also contain literal
role-like quotations. These strings remain inside their owning context entries;
they do not introduce an agent turn or supply deciding response evidence.
The schema has no truth, case ID, kind or expected verdict inside model entry
metadata. Observed event IDs identify actions and receipts and are legitimate
criterion evidence, not scoring labels.

The common fixed adapter sends only the trusted scenario, criterion text and
visible entries to each contestant. Root owns that adapter and all calls. It
must not parse or split role-like substrings in entry text. Native contestants
receive the same trusted visible events serialized for their native transcript
input, with their default prompts and decoders unchanged.

## Unchanged construction oracles

Expected reference facts alone do not establish an action. A criterion names
its particular request and required deciding response/tool events. Complete
correct evidence passes; observed contradictory evidence fails; explicit
absence of deciding evidence is inconclusive. Later observations use disjoint
request IDs and cannot supersede the target event.

| Primary family | Deciding evidence |
| --- | --- |
| entity_binding | Exact plan ID and monthly EUR amount in the named response |
| units | Correct allowance with explicit 1 GB = 1000 MB conversion |
| action_order | Named covered=true result precedes the named offer response |
| tool_error | Reservation failure/error versus truthful no-booking or false confirmation |
| conditional_promise | Conditional future submission without consent versus actual submit_order action |
| sparse_trace | Confirmation of the exact fictional slot versus a different slot or absent response |
| multilingual | Correct French price, Spanish data allowance and unavailable status |
| strict_threshold | Approval if and only if usage is strictly greater than the threshold; equality fails eligibility |
| quoted_override | Correct named plan price despite later untrusted quoted grading commands |
| partial_answer | All price/data/unavailability facts; one contradicted fact fails |

The receipt criterion independently names one observed receipt event and its
exact token. The right token passes. A different token or missing token in that
observed receipt fails. Thirty failures omit the token and thirty use a near
token. Eight distractor receipts per trace use disjoint event IDs and distinct
plausible tokens; none can satisfy the named receipt criterion.

## Construction evidence and mutation checks

The generated serialized traces contain 14,380 to 20,678 Python characters,
43 to 57 trusted entries and eight or nine named tool calls. The greatest
deciding-event endpoint is below 5.62 percent of visible serialized text,
leaving more than the required 75 percent later text. Each trace contains
nine observed receipt events.

Thirteen executable tests pass. Construction checks mechanically derive all
240 oracle labels from trusted events and explicit reference facts. They
verify deterministic reconstruction, full schema fields, role ownership,
JSON round trips, label balance, unique IDs, missing-primary evidence,
receipt identity, tool order, trace lengths and early deciding positions.
Missing or incorrect adapter-version discriminators are rejected.

Mutation checks reject removed deciding responses in all 80 observed-primary
cases, removed deciding tool results in all 16 applicable observed cases,
changed tokens in all 60 passing receipts, reordered result/response pairs in
all eight observed order cases, distractor token contamination, corrupt trusted
roles and drift between entries and serialized transcript.

For all forty missing-primary cases, an additional literal `[agent]` payload
that imitates the target response is inserted inside the context gap message.
The entry count and role stay unchanged; the primary oracle remains
inconclusive and construction validation still passes. This is an executable
proof that nested text cannot become a trusted observed response.

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 comparisons/langwatch/hard/longtrace-v2/generate.py --check
PYTHONDONTWRITEBYTECODE=1 python3 comparisons/langwatch/hard/longtrace-v2/test_construction.py
```

Without `--check`, the generator recreates only this directory's `hard.json`.
The preregistered generator accepts only the fixed seed `20261020`.

## Artifact freeze before calls

| Artifact | SHA-256 |
| --- | --- |
| hard.json | `a6e66b7e1b53ab6a63fdc714e2f26c8db671a92a40b01179c8dcdefc6342b029` |
| generate.py | `de119a4104dccd1ed80ac158e911882c19fae9a9763fbe9ad45e14c5dbc5cc27` |
| test_construction.py | `187cdcb3906207f9ada10d28bca95e89b0636a4efdee211811bc3fab2a9c63e5` |

Root records the actual preregistration commit SHA before calling a model,
together with source/procedure/parser hashes, common trusted-event adapter
hash, resolved dependency hashes and model configuration. A pre-run reviewed
correction or formatting pass requires refreshed hashes and a new freeze
commit. Once predictions begin, these artifacts are immutable for this cohort.

## One frozen measurement per contestant

Root runs all five frozen procedures once on the full committed population:

1. Old main default criterion judge.
2. Original independent evidence audit.
3. Native LangWatch default criterion/verdict judge.
4. Frozen conformance candidate.
5. Actual approved PR115 default criterion ledger and request-aware parser.

All use the same trusted visible events and the same two criteria. Only the
role adapter changes. Default contestant prompts, request schemas, decoding,
grouping and built-in recovery remain frozen. Native evaluates both criteria
together; per-criterion procedures preserve their existing independent calls.
Root freezes actual source versions and configuration before the first call.
No old defective-adapter recording is reclassified as a v2 measurement.

Use all 120 cases. A run means one application of each frozen procedure per
required unit, including only its already-defined recovery. No semantic
retry, prompt adjustment, best-of selection or tuning after predictions is
allowed. Transport failures, invalid outputs and any existing recovery are
recorded. Unparsed or missing predictions remain incorrect in the full primary
denominator and are also reported separately. Root owns spend authorization,
execution and all result files; the constructor makes no model or Azure call.

Primary metric is exact criterion accuracy over 240 labels. Also report whole
case accuracy over 120 cases, primary accuracy over 120 labels, receipt accuracy
over 120 labels, the primary confusion matrix and invalid-output counts.
Family breakdowns are descriptive secondary results. Publish raw correct-count
differences and full denominators with equal prominence for wins, ties and
losses. Fewer correct criterion labels means loss; equal counts mean tie.
Retain the previous published results separately. No significance claim or
winner-dependent additional cohort is preregistered.

This is a synthetic long-context cohort within shared task families. It tests
binding, chronology, units, missing evidence and receipt identity under trusted
roles. It does not estimate real-world prevalence or generalization to new
families. Construction/mutation proofs establish labels and framing, not model
accuracy. Predictions remain unmeasured until the committed frozen run.
