# Two-step pointwise hypothesis

Owner: "Ok then probably you need to run 2 steps System 1, answer for one or no then router".

Hypothesis: separating commitment from judge selection preserves hard rows at 96.3 or better, recovers Verify above 80 and reference-guided Verify above 96, and reaches RubricBench 93.5.
The candidate is compared with the immutable single-threshold configuration `pw-router-v3-frozen.json`.
This is one architecture round; all threshold and expert choices use tuning data only.

## Calls and fit

1. System 1 sees the item and answers the verdict question plus whether it can commit without guessing. Pairwise rubric items ask both directions in the same call. Confidence fits the product of verdict confidence and ability probability, separately by supplied evidence shape.
2. The calibrated commitment gate returns a verdict or abstains. Unsupported reference-free correctness always abstains.
3. Only an abstention permits the separate System-1 router call. Its own prompt reads supplied reference, worked solution versus factual source, compound rubric, reasoning, subjective style and judge-design suitability.
4. Supplied input shape and the router's solution/compound decisions select a content bucket. A tuning-selected expert and confidence threshold determine a terminal reference/rubric decision or Luna full-judge escalation.

The first conservative collection gate requires 98 percent cross-fitted commitment accuracy; no threshold qualifies, so every tuning item abstains and receives a router call.
The final fit selects commitment jointly with downstream routing, using out-of-fold confidence predictions and four-benchmark mean balanced accuracy, then fewer System-2 calls and more commitments.
The final commit threshold is 0.8. The conservative collection gate is not the frozen operating policy.
Each reference or rubric bucket may select its own expert-confidence threshold. No validation value participates in that fit.

Both Verify modes share labels but have different fixed moj-split-v2 halves. Tuning copies of every ID in either mode's validation half are excluded.
This leaves 130 tuning items: RubricBench 54, hard rows 42, Verify 17, Verify with reference 17.
Matching Verify IDs stay in the same cross-validation fold across modes. All 204 original validation entries remain reportable.
This is a practice comparison on previously studied data, not a new unseen confirmation set.

All new System-1 requests use unchanged moj/client.py, three simultaneous calls and built-in 403/429 waits.
Existing expert responses replay; all System-2 experts in the new candidate use gpt-6-luna.
The historical single-threshold baseline includes its already-recorded mixed panel. It stays unchanged and is labeled as such.
No new System-2 requests are planned. All recordings and failed submissions remain in the owned recorder files.
No sealed file or identifier is read. No package or validator file changes.
