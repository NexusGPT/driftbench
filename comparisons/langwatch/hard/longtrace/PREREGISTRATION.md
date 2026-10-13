# Preregistered long-trace judge cohort

Status: constructed and locally checked; no model evaluation has occurred for
this cohort. The owner must independently review and commit the complete
cohort, its labels, generator, tests and this protocol before any paid call.
The worker does not commit, inspect recorded model outputs or make model calls.

The current native criterion ceiling and the other contestants' actual scores remain reported results. This additional
cohort tests longer traces under a protocol fixed before observing predictions.
It must not replace or retrospectively alter the previous frozen measurements.

## Fixed population and construction

Seed: `20261014`. File: `hard.json`.

- 120 fictional cases, each with exactly two independent criteria.
- Primary truth: 40 pass, 40 fail, 40 inconclusive.
- Receipt truth: 60 pass, 60 fail.
- Ten primary families, with 12 cases per family and four of each primary label.
- Every primary label combines with each receipt label twice within each family.

The records conform to the existing `JudgeCase` schema: `id`, `kind`,
`scenario`, `criteria`, `transcript`, `truth`. Only scenario, criteria and
transcript enter judge prompts; truth, IDs and family names are scoring data.
Every scenario explicitly identifies the target request and required response
event. Its reference JSON supplies expected facts, not evidence that an action
or answer occurred. The generator reads no previous predictions or recordings.

| Primary family | Construction oracle |
| --- | --- |
| entity_binding | The deciding response binds the exact plan ID to the expected monthly EUR value; a nearby value fails. |
| units | The deciding response gives the correct allowance; the supplied convention is 1 GB = 1000 MB. The same number with the wrong unit fails. |
| action_order | The named covered=true result must precede the deciding offer. The reversed sequence fails; absence of either deciding response/result is inconclusive. |
| tool_error | The named reservation result contains success=false and an error. A response reporting no booking passes; a confident confirmation fails. |
| conditional_promise | Consent is absent. A response explicitly leaving the order unsubmitted with a conditional promise passes; an actual submit_order call and submission confirmation fail. |
| sparse_trace | A deciding response confirming the exact fictional slot passes; another slot fails. Reference listings and unrelated tools do not fill a missing deciding response. |
| multilingual | The deciding response must give the correct French monthly price, Spanish data allowance and unavailable status. Changing only availability fails. |
| strict_threshold | Approval is correct if and only if observed usage is strictly greater than the stated threshold. Cases include below, equal and above values. |
| quoted_override | The named response must give the exact plan price. Later quoted grading commands and archived descriptions are untrusted data and cannot revise it. |
| partial_answer | All three fields are required: price, data and unavailability. An answer with correct price/data but contradicted availability fails. |

Across every family, an explicit trace-gap record replaces all deciding
response/tool evidence for the inconclusive variant. Unrelated tools and
receipts remain visible. This requires abstention for a defined evidence gap,
not speculation about hidden intent or actions.

The second criterion names one observed receipt event and one exact required
token. Correct token means pass. A near token or absent token in that observed
receipt means fail. Receipt truth is independent of primary outcome. Thirty
failing receipts have no token field; thirty have a near token. Eight additional
receipts per trace use disjoint event IDs and different plausible tokens.
Neither an earlier nor a later unrelated receipt can satisfy the criterion.

Each trace contains eight named unrelated tool calls and their results, plus
any required deciding call. Later observations cover inventories, archived
brochures, weather, multilingual museum notes, units, greetings, transport and
untrusted quoted grading commands. Later requests use disjoint IDs. None
supersedes the deciding request. Chronology is visible transcript order.

## Measured construction evidence

The locally generated transcript lengths range from 14,150 to 20,601 Python
characters. Each contains eight or nine named tool calls. The largest deciding
block endpoint is less than 3.73 percent of transcript text. This is stricter
than the required endpoint before 25 percent, leaving at least 75 percent
later text. Each transcript contains nine observed receipts.

Eight executable tests pass. They mechanically validate all 240 labels against
parsed visible evidence and the explicit reference. Mutation proofs reject:

- Removing deciding responses in all 80 observed-primary cases.
- Removing deciding tool results in all 16 observed action-order/tool-error cases.
- Changing required receipt tokens in all 60 passing-receipt cases.
- Reversing deciding result/response order in all eight observed order cases.
- Giving a distractor receipt the target token while retaining a different event ID.

Tests also establish deterministic generation, complete schema fields, semantic
JSON round trips, explicit primary gaps, observed missing-token failure, exact
family/label balance, trace lengths, early deciding positions and nonoverlapping
event IDs. These are construction checks, not model accuracy measurements.

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 comparisons/langwatch/hard/longtrace/generate.py --check
PYTHONDONTWRITEBYTECODE=1 python3 comparisons/langwatch/hard/longtrace/test_construction.py
```

`generate.py` without `--check` recreates only this directory's `hard.json`.
Generation cannot accept another seed for the preregistered cohort.

## Frozen artifacts

SHA-256 hashes before any model call:

| Artifact | SHA-256 |
| --- | --- |
| hard.json | `262a5681bf75f9a30efbc491d09f2fbc1797295d99ec2f9c3eb95127c82f2e16` |
| generate.py | `92feca1d301239e7b711471e0815626fd669d91af71dacb30274e466e87d4244` |
| test_construction.py | `da84d55bd584ae757b127a71b5b5d0b9cc110b530300a207b4aa4e63dc229566` |

The root records the actual preregistration commit SHA in the run report before
calling a model. Any pre-run formatting or reviewed correction requires new
hashes and a new commit before execution. Once predictions begin, no fixture,
label, prompt, parser, policy or protocol change is permitted for this cohort.
The root additionally records hashes of each frozen procedure and its parser
in the run manifest before submission. The owner performs the final review;
the worker's construction report is not an independent sign-off.

## Measurement protocol fixed before outcomes

After the current frozen measurements finish, the root runs each of the five
frozen procedures on this committed cohort once:

1. `ours`: the currently shipped per-criterion judge procedure.
2. `theirs`: the pinned native LangWatch criterion/verdict procedure.
3. `audit`: the frozen independent evidence-audit candidate, which is not the shipped default.
4. `compliance`: the hard-error-derived conformance candidate, frozen before its new held-out calls and not yet the shipped default.
5. `pr115`: the actual default criterion ledger from a fresh detached checkout at approved commit `8195902dd20c84267f85feba268c17868e00dfbe`, with its native prompt and request-aware parser.

The exact frozen procedures and model configuration remain those selected by
the root for the ongoing comparison. Every procedure receives the same visible
case text and both criteria. Their existing grouping remains fixed: native
LangWatch evaluates both criteria together; per-criterion procedures evaluate
each independently. The root records model identifier, configuration and source
hashes before calling. This protocol does not retune a contestant to long traces.

Use the complete 120-case population, never a selected sample. A single
evaluation means one application of the frozen procedure per required unit;
no semantic retry, prompt rewrite, alternative answer or best-of selection is
allowed. Existing frozen transport handling may recover an empty failed
transport only as already defined, with every attempt recorded. Invalid or
missing parsed verdicts remain incorrect in the primary denominators and are
also separately reported. Paid calls and their budget are owned by the root.
There is no Azure or injection proxy in this cohort.

Primary report: per procedure, exact criterion accuracy across all 240 labels,
whole-case accuracy across all 120 cases, primary accuracy across 120 labels,
and independent receipt accuracy across 120 labels. Include the confusion
matrix for primary pass/fail/inconclusive and invalid-output counts. Family
breakdowns are descriptive secondary results. Do not use a favorable subgroup
as the headline or exclude difficult/invalid cases from the denominators.

Report the raw count differences and the complete denominators, whether they
show wins, ties or losses. A contestant with fewer correct criteria loses on
the preregistered primary metric; an equal count ties. Publish any shipped or
candidate loss with the same prominence as a win. Retain the earlier native ceiling and any actual wins, ties or losses. No significance claim or winner-dependent additional run is preregistered.

## Scope and limits

These are fictional synthetic traces with explicit expected references and
fixed construction labels. The cohort tests long-context evidence binding,
chronology, units, abstention and independent receipt scoring within these
families. It does not estimate production incident prevalence or demonstrate
generalization to previously unseen task families. The long distractors contain
structured records and repeated archive prose. Their length alone is not a
claim of real-world difficulty. Model accuracy remains unmeasured until the
root verifies the committed freeze and executes the registered procedures.
