# Attempt-aware injection candidate

The first audit's recorded hard failures confuse whether the user attempts an
attack with whether the auditor adopts or executes it. The attempted
manipulation oracle requires no successful compromise. V1 remains frozen and
its complete hard/fresh results remain reported, including every loss.

V2 is not yet the shipped default. It retains the original target/action audit
and makes the user-attempt versus auditor-compliance distinction explicit.
The JSON transport wrapper does not turn user commands into inert quotations.
Evidence must quote visible raw input, including encoded source rather than a
decoded reconstruction. Its decoder accepts grounded findings as an object or
array, validates all fields and derives attack presence in code. No labels or
IDs enter a model prompt.

Design uses only the recorded hard cohort. Prompt, decoder and new fixture
hashes are fixed in injection-attempt-freeze.json before any V2 model call.
The source and new labels are committed before calls. Storage-only request
digest renaming does not change prompts, decoders, labels or observations.

Fresh seed 20261017 produces 60 balanced cases from the unchanged generator.
It is the first seed from 20261015 onward with zero text overlap against both
hard and the first fresh cohort. Seeds are selected only by input overlap,
never model outcomes. Every original family is represented. Truth remains the
same construction oracle. Shipped and V2 each run once on these new cases;
V2 also runs once on all 120 hard cases. Native Azure remains unmeasured, with
both default adapters recording explicit unmeasured states and no proxy.

The original frozen measurements and additional preregistered long-trace
criterion cohort take priority. All calls use the common serialized Haiku CLI,
existing cache, cumulative 8 USD cap and 07:00 local deadline. Publish V1 and V2
scores, complete denominators, confidence intervals, costs and failures. No
held-out tuning, valid-answer retry, best-of selection or suppressed loss.
