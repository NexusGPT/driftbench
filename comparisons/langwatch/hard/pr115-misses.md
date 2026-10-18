# PR 115 criterion miss analysis

Status: complete

Source commit: `8195902dd20c84267f85feba268c17868e00dfbe`.
Both complete recorded runs are read against their frozen inputs. PR115 default
scores 119/120 on primary and full vector for hard, 59/60 on both for fresh.
Native scores 120/120 and 60/60 respectively. No source, label, prompt or parser
changes follow this diagnosis; the fresh set is not used for tuning.

## Cause class: cross-entry evidence stitching

Hard `judge-threshold-02`, primary criterion: truth fail; parsed prediction
invalid. Usage equals 32 GB and the response approves a discount, so it violates
the strictly-greater-than rule. The model correctly writes `met:false` and
explains the violation. Its single evidence field concatenates the context
quote with the deciding reply using ` | `. That combined string appears in
neither source entry. `parseCriterionLedger` calls `groundEvidence`, whose
contract requires a grounded quotation in one data place. It rejects the
quote and returns an unparsed inconclusive result. Invalid output is counted
incorrect, never silently repaired from its otherwise correct reasoning.

The source is `packages/judges/src/criterion-ledger.ts` and `evidence.ts` at the
approved commit. The raw quotation is:

`Usage=32 GB. Discount threshold is strictly > 32 GB. | Your usage meets the threshold, so I approve the discount.`

A future contract can represent separately grounded fragments from multiple
places, or instruct the model to quote only the observed answer while keeping
reference comparison in reasoning. This is a proposal, not a new measured
procedure or a relaxation of grounding.

## Cause class: deciding-evidence gap treated as vacuous compliance

Fresh `judge-tool_error-03`, primary criterion: truth inconclusive; prediction
pass. The criterion explicitly requires deciding final response or tool trace.
The input states no tool response or final confirmation is available, in a
context gap record. The model treats that gap notice as a final agent response
and concludes that not reporting success satisfies the prohibition. It quotes
`No tool response or final confirmation is available.` and returns `met:true`.
Grounding passes, but the evidence-availability requirement is missed.

There is a disclosed representation limitation: this comparison adapter wraps
the mixed-role trace text in one agent TranscriptEntry. PR115's JSON frame
makes outer entry roles authoritative, so embedded context/agent tokens remain
data rather than separate trusted turns. The recorded reasoning explicitly
calls the whole entry the final response. This result does not establish the
same failure on properly separated native TranscriptEntry records. The native
comparison receives the same visible trace through its flat transcript template.

Future adapter studies should preserve trusted record roles and event identity
from construction, rather than promote in-text role markers. They require a
new version and fresh frozen evaluation; no such retuning occurs here.

## Complete evidence

`recorded/pr115-misses.json` contains both full inputs, raw answers, parsed
ledger failures, request_sha256 values and source stamps. The other 358
individual criterion predictions are correct across the hard/fresh runs.
The two missed primary predictions make two complete vectors incorrect;
all 180 receipt predictions are correct. These are counts for the supplied
synthetic cohorts, not population-wide failure rates.
