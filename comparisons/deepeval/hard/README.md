# Hard judged comparisons

Measurements and free replays are recorded. The candidate is **not yet the shipped default**.

This folder measures nine judged rows against DeepEval 4.2.8 using six synthetic
120-case sets. It preserves the old comparisons in the parent folder.

## Construction and truth

`generate.py` creates five counterfactual pairs for each of twelve families in
each set. Every set contains 60 passing and 60 failing cases. All names, plans,
addresses, account records and contact details are fictional. The generator fixes
the truth before measurement. No model output changes a label.

`sets-v1.json` preserves the original corpus. `sets-v2.json` corrects sixty
role user turns to contain the unrelated request their replies refuse or answer.
IDs, labels, assistant replies and every other set remain unchanged. The original
and corrected generators remain in `generate-v1.py` and `generate-v2.py`.

`sets.json` is clarified v3. Both labels in the grounding negation family now have
source text explicitly excluding every included router and discount. Every
grounding source also identifies the lead reference as the user's own. IDs,
labels, replies and all other source facts remain unchanged. V2 positives broaden
“no loyalty discount and no free router” into “No router or discount is included”.
The candidate is right to flag that broader claim despite its positive label.
The owner approves source clarification, rather than changing the labels or
teaching the candidate to accept the broader claim. All three versions are reported.

`sets-heldout.json` uses the same clarified generator with seed 20261019 and
three pairs per family, giving 72 cases per set. It uses fresh fictional client
contexts and values, with 36 cases per label. Labels and data are fixed before
any held-out model call. The shipped judge, candidate and default metric each
receive one evaluation per case. Candidate selection uses only hard v1/v2/v3. The original unrun held-out corpus
remains in `sets-heldout-v2.json`; it is regenerated with the same seed and labels
after source clarification, before its first model call. `corpus-history.json`
records the pre-call hashes and approval.
`candidate-freeze.json` stamps the selected procedure, runner, rendered prompts,
hard results, provenance and current corpora. The runner rejects any change to those files before held-out measurement.

| Set | Passing rule | Near misses |
|---|---|---|
| relevancy | The last reply answers every part of the latest ask. | A missing part, wrong entity, quote of the ask, fluent deferral or answer to the previous topic. |
| completeness | All active requests have an answer by the conversation's end. | A missing part, unresolved earlier request, promised result or quoted request. |
| task | The requested result is explicitly achieved for the requested target. | Drafted orders, approved refunds, queued cancellations, wrong targets and unfinished compound tasks. |
| role | The reply stays within the supplied role and every explicit permission boundary. | Polite advice outside the role, disclaimers, conditional guarantees and unrelated asides. |
| grounding | Every factual offer claim is supported by the user or supplied contexts. | Nearby prices, units, address changes, reference suffixes, negation and unsupported extras. |
| knowledge | The reply preserves current user facts and does not ask for them again. | Obsolete corrected values, another person's email, currencies, contact preferences and fluent re-asks. |

Paraphrases, mixed languages, long distractors, explicit unknown answers and
fluent replies appear on both sides of the labels. A negative answer to a question
is still an answer. Truth is tied to these explicit policies, not to reply length
or surface vocabulary. No expected truth, ID, family or pair ID enters model input.

Cases are related constructions, not independent samples of real conversations.
Some prompts repeat. Repeated prompts share one recording. Wilson intervals and
paired McNemar values describe the nominal case counts; their independence
assumptions do not hold for every repeated template. They cannot establish general
superiority on unseen conversations. The hard sets are tuning sets.

## Both sides and defaults

`render.mts` uses the shipped `buildPrompt` and criteria for the baseline. The
role input explicitly supplies the same permission boundaries to both sides.
`audit.py` is a comparison-only alternative. It asks for atomic evidence checks
and computes the final answer in Python. It does not rewrite production judges.

`run.py` invokes the actual pinned metric classes with a custom Haiku model
adapter. Their default templates render through their own Jinja implementation.
Every complete rendered prompt is preserved verbatim in the JSONL recording stream, including
the fragments. Default scoring thresholds remain 0.5. G-Eval is strict and uses
the same fixed evaluation steps as the inherited comparison. DAG uses the same
one-node relevancy graph. Reason-only extra calls are disabled; decision prompts
are unchanged. As required, both sides use the same `claude -p` path and model.

The new runner repairs errors in the inherited manual runner:

- Faithfulness extracts a JSON object with `claims`, not a bare list. Its native
  pipeline also extracts source truths before deciding claims.
- Faithfulness renders the default guidance, including the `borderline` policy.
  Borderline claims count as agreeing by default.
- Hallucination in this pinned package scores agreeing contexts, with higher
  scores passing. The old manual contradiction-fraction calculation is not used.
- Knowledge retention runs the native extraction stage before its verdict.
- Invalid model responses count as undecided and wrong, never as a default pass.

The parser normalizes a singleton object to a one-element list for native verdict
lists and audit checks. This layout-only rule applies to every contestant. It changes
no decision, status or evidence. Responses remain available with the documented operator-identifier redaction.
The role template itself shows a singleton object despite declaring a list.

The default metrics and our criteria have different policies. Turn relevancy
rejects only wholly irrelevant replies. Completeness, faithfulness, task completion
and hallucination can accept a partly correct result at 0.5. Hallucination rejects
contradictions, not every unsupported addition. Faithfulness can accept unsupported
claims as borderline. Our criterion requires every active request or claim to
meet its rule. The measured default-policy comparison is not a pure prompt-quality
comparison. `score.py` also reports a free threshold-1 sensitivity count from the
same native scores, without changing any answers or running another model.

The native role judge can also reject an in-role disclaimer because it does not
help the user choose a plan. Our role criterion permits plain in-role statements
and tests permission boundaries separately from task helpfulness. The corrected
refusal contexts remove the missing-request defect, but not this policy difference.

Task truth checks the reported result in the conversation, without real action
receipts. The native extraction can state that no tools were called, and its
verdict can reject a reported completed action for lacking tool proof. These
cases measure different evidence policies; they do not prove better real action
verification on our side.

The equal-evidence task variant preserves every conversation and label, adding
one matching fictional `acme.task_receipt` result to each case. `receipts.py`
copies the conversation's reported result without reading its truth label.
Incomplete and queued results remain incomplete and queued in their receipts.
The shipped judge sees the tool call and result, the candidate sees the same
receipt object, and the native metric receives it through `tools_called`.
Both the 120-case clarified hard variant and 72-case held-out variant are frozen before
their calls. These are constructed receipts, not real action executions.

## Record, then replay

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install deepeval==4.2.8
python3 comparisons/deepeval/hard/generate-v1.py
python3 comparisons/deepeval/hard/generate-v2.py --output sets-v2.json
python3 comparisons/deepeval/hard/generate.py
pnpm exec tsx comparisons/deepeval/hard/render.mts
python3 comparisons/deepeval/hard/generate.py --seed 20261019 --pairs-per-family 3 --output sets-heldout.json
pnpm exec tsx comparisons/deepeval/hard/render.mts heldout
python3 comparisons/deepeval/hard/receipts.py
pnpm exec tsx comparisons/deepeval/hard/render.mts v3 receipt
pnpm exec tsx comparisons/deepeval/hard/render.mts heldout receipt
.venv/bin/python comparisons/deepeval/hard/run.py --tag baseline-v3 --record --cap-usd 4
.venv/bin/python comparisons/deepeval/hard/run.py --variant audit --tag audit-v3 --record --cap-usd 4
.venv/bin/python comparisons/deepeval/hard/run.py --sets task --evidence receipt --tag baseline-task-receipts --record --cap-usd 4
.venv/bin/python comparisons/deepeval/hard/run.py --sets task --evidence receipt --variant audit --tag audit-task-receipts --record --cap-usd 4
python3 comparisons/deepeval/hard/freeze.py
.venv/bin/python comparisons/deepeval/hard/run.py --corpus heldout --tag baseline-heldout --record --cap-usd 4
.venv/bin/python comparisons/deepeval/hard/run.py --corpus heldout --variant audit --tag audit-heldout --record --cap-usd 4
.venv/bin/python comparisons/deepeval/hard/run.py --corpus heldout --sets task --evidence receipt --tag baseline-task-receipts-heldout --record --cap-usd 4
.venv/bin/python comparisons/deepeval/hard/run.py --corpus heldout --sets task --evidence receipt --variant audit --tag audit-task-receipts-heldout --record --cap-usd 4
```

The recorder permits one call at a time. It locks the entire run and reserves
the full 0.05 USD invocation cap before a fresh call. A cumulative 8 USD cap applies
to this folder's recorded calls. Unreported failures reserve 0.05 USD and remain
visible. Reported costs come from each CLI response. The final owner instruction stops new calls at 06:30 local time. The original runs used a 07:00 cutoff; later runs load the earlier deadline before starting.
Successful calls persist immediately, so a restart replays them. Result files
checkpoint after each measured row. A failed call is not cached as a success.
Optional `--ledger PATH` appends a row for the run, including zero-cost replays.

Free reproduction uses no `--record` flag. A missing recording stops the run:

```sh
.venv/bin/python comparisons/deepeval/hard/run.py --corpus v1 --tag replay-v1
.venv/bin/python comparisons/deepeval/hard/run.py --corpus v2 --tag replay-v2
.venv/bin/python comparisons/deepeval/hard/run.py --corpus v3 --tag replay-v3
.venv/bin/python comparisons/deepeval/hard/run.py --corpus v3 --variant audit --tag replay-audit-v3
.venv/bin/python comparisons/deepeval/hard/run.py --corpus heldout --tag replay-heldout
.venv/bin/python comparisons/deepeval/hard/run.py --corpus heldout --variant audit --tag replay-audit-heldout
python3 comparisons/deepeval/hard/score.py comparisons/deepeval/hard/baseline-v3.json
python3 comparisons/deepeval/hard/score.py comparisons/deepeval/hard/audit-v3.json
python3 comparisons/deepeval/hard/score.py comparisons/deepeval/hard/audit-heldout.json
pnpm exec vitest run --config comparisons/deepeval/hard/vitest.config.ts --maxWorkers=2
.venv/bin/python -m unittest discover -s comparisons/deepeval/hard
```

`audit-first.py` and `audit-v2-first.json` preserve the first hard candidate.
Its task score is 112/120: it infers meaning from reference prefixes and adds
calendar details the user never requests. Before held-out scoring, the task rule
is revised to keep identifiers opaque and match the requested date precision.
The final procedure is remeasured on the hard corpora before it is frozen.

The per-corpus baseline and audit files contain per-case decisions and call digests.
The recording stream stores identifiers as `request_sha256`; case results
refer to `request_sha256s`. These are prompt digests, not credentials.
The metadata migration preserves every raw prompt, response and envelope.
The recording stream contains the full prompt, redacted response, CLI envelope, actual model
usage and cost for each unique invocation. Per-row costs charge their underlying
calls, including shared recordings. These row costs must not be added as actual
billed spend. Actual spend is the sum of unique recorded invocation costs.

`losses-RECORDING.md` files are free replay audits. The audit variant
is measured on the exact same case set and competitor recordings as the baseline.
It is a selected procedure on this tuning set, not an unseen-test result.

## Operator identifier redaction

Six candidate knowledge answers invent an operator account identifier absent from
the supplied conversations. The CLI runtime context exposes that identifier.
Recordings capture the supplied system and user arguments, not the CLI's implicit
runtime context. The identifier is absent from every recorded input argument.
Every occurrence in public recordings and parsed results is replaced with the
literal `[redacted-operator-email]`. Labels, scores and decisions remain unchanged.
Unredacted originals are stored outside the repository, never committed.
Request digests are verified against the public inputs and remain unchanged;
selection and recording file hashes are recomputed after redaction.

`calls-000.jsonl`, subsequent numbered chunks and the active `calls.jsonl`, when
present, form one recording stream in that order. Whole lines are split losslessly
into files smaller than 8 MiB. `recordings.py` reads the complete stream and rotates
the active file before its next append exceeds that limit. Future responses with
the same operator identifier are privately preserved and publicly redacted before
parsed results are saved. `redaction.json` records the initial six-answer cleanup.

## Additional held-out seed and pooled results

The owner authorizes one additional seed for task and grounding only. Seed
20261020 uses the unchanged `generate.py` with five pairs per family, producing
120 cases per set. Its candidate inputs are all new relative to both the hard
set and original held-out set. Task has 90 distinct inputs; grounding has 75.
`additional/manifest.json` freezes labels, generated data, rendered prompts and
source hashes before any additional call. The original candidate freeze remains
unchanged, and the additional runner verifies both freezes before measurement.

`run-additional.py` reuses the original recorder, native metrics, shipped scorer
and candidate. It shares the same recording stream, serial lock, cumulative
8 USD cap and 06:30 local call deadline. `render-additional.mts` preserves the
original renderer and changes only corpus selection and output paths. Each
contestant receives one evaluation per distinct input; repeated inputs replay
the same answer. Matching fictional task receipts are also given to both sides.

Original held-out counts remain separate. `pool.py` combines the original 72
and additional 120 entries per task and grounding row. It prefixes result IDs
with seed identifiers for collation only; model inputs and labels stay unchanged.
Pooled task inputs total 144 distinct inputs; grounding totals 120. Every
reported interval includes the side-specific distinct-input count. Native
multi-stage counts use unique ordered input-stage sequences. Intervals still
use nominal entries and do not remove dependence between related constructions.

Free replay and pooling, without model calls:

```sh
.venv/bin/python comparisons/deepeval/hard/run-additional.py --tag replay-additional
.venv/bin/python comparisons/deepeval/hard/run-additional.py --variant audit --tag replay-additional-audit
.venv/bin/python comparisons/deepeval/hard/run-additional.py --sets task --evidence receipt --tag replay-additional-receipts
.venv/bin/python comparisons/deepeval/hard/run-additional.py --sets task --evidence receipt --variant audit --tag replay-additional-audit-receipts
python3 comparisons/deepeval/hard/pool.py
```

## Call cutoff and final coverage

New calls stop at 06:30 local time on 2026-10-13. Original held-out and additional
conversation measurements are complete. The additional receipt baseline measures
all 120 cases: shipped 120/120 and default 118/120 over 90 distinct inputs.
The default has one completed-task miss and one unparsed invocation at the cutoff.
The additional receipt candidate makes no model call and remains unrun. Its empty
result records the deadline stop. Three-way pooled receipt counts therefore use
only the original held-out receipt cases; the full additional baseline appears
separately. No missing candidate score is filled in.

The additional conversation task candidate scores 113/120. Six misses add an
explicit target-identification requirement to completed actions. The cases are
`task-move-0-a`, `task-move-3-a`, `task-refund-0-a`, `task-move-4-a`,
`task-refund-4-a` and `task-move-2-a`. A separate invalid-envelope miss occurs on
`task-refund-3-a`. The candidate and labels stay unchanged.

Eight unique answers have an operator identifier redacted: six original hard
answers and two original held-out answers. Their unredacted originals remain
outside the repository. These are invented evidence absent from the supplied
inputs, even where the final classification is correct. Scores remain unchanged.
`final-integrity.json` records chunk hashes, distinct-input counts and source
freezes. One cutoff invocation uses a conservative 0.05 USD failure reservation.

The free `score.py` command preserves the original header of published loss
audits while recomputing their contents. It writes an audit or `--output` file
only when its bytes differ, so an unchanged replay preserves file timestamps.
