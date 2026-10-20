# Offline MM-Eval escalation replay

This example reproduces the historical DEV400 cascade score, **91.16**, through the public
`createEscalation` and `judgePairwise` APIs. Its frozen baseline is **89.65**.
It makes no provider calls, needs no credentials, and has no live fallback.

From the repository root, after installing the repository dependencies:

```sh
pnpm exec tsx examples/escalation/replay.ts > replay.json
pnpm exec vitest run examples/escalation/test/replay.test.ts
```

The command exits unsuccessfully if the scores, paired changes or row coverage differ.
The JSON report includes every row's two games, baseline score, final score, trigger and decision.
The public package owns escalation and its majority decision. The example only decodes recordings
and applies the historical benchmark scoring rule.

## Results and coverage

| Subset | Rows | Frozen baseline | Cascade |
| --- | ---: | ---: | ---: |
| Chat | 37 | 70.27 | 70.27 |
| Language mixing | 99 | 99.24 | 99.49 |
| Linguistics | 35 | 94.29 | 98.57 |
| Reasoning | 151 | 95.03 | 94.54 |
| Safety | 78 | 89.42 | 92.95 |
| Mean of subset scores | 400 | 89.65 | 91.16 |

- All 400 pinned development IDs are included, with 11 improved item scores and 4 worse scores.
- The frozen first seat uses native direct judgements, replacing all 37 chat rows with vote3.
- Two recorded Haiku provider refusals score zero in the baseline; they remain in the denominator.
- The frozen first seat escalates 26 rows. The native-direct-only council experiment's 28 is a different base.
- There are 878 adapter invocations: 800 first-order readings and 78 later-seat readings. These are local reads.

A game earns 1 for the labelled candidate, 0 for the other candidate and 0.5 for a tie.
Each item averages its two games. Each subset averages its items. The overall score averages the
five subset means equally. An unresolved first-seat refusal stays zero, rather than becoming a tie.
The replay preserves fractional first-order scores when the later seats cannot decide.

## What is recorded

[`fixtures/mm-dev400.jsonl`](fixtures/mm-dev400.jsonl) is a compact extraction, not the research corpus.
Its first line contains provenance, DEV IDs and historical score assertions. Each remaining line is
one item with its label, subset, language and recorded model decisions.

- Haiku: raw declared winner, presentation order, parse status, request key and response SHA-256.
  Repair attempts and all three chat samples are retained. The last attempt for each order counts.
- GPT and Gemini: exact historical response text and request keys for the 26 potentially escalated rows.
  The public `parseAnswerText` parser derives each order's result. The seat uses their net preference.
- Jev: the three separately recorded, decoded seat outcomes, already mapped to the original candidate order.
  The seat derives a two-of-three preference. These are not the aggregate `sides` field or label-derived scores.
- No prompt templates, dataset questions or complete candidate responses are copied. Model explanations
  can contain short quotations from candidates.

The historical first-seat policy escalates every undecided game, including a consistent explicit tie.
The adapter therefore maps first-seat ties and refusals to `winner: 'inconclusive'`. This preserves the
historical policy; the package itself can distinguish an equal-quality tie from an inconclusive result.
Stored `rawWinner` values remain unchanged. Later-seat `tie` means an order disagreement or missing Jev
quorum and also enters the public API as `winner: 'inconclusive'`, an abstention.
A missing recording is a replay error, even though a production council can tolerate a failed seat.
No label, subset or expected score is passed to a judge or to the escalation gate.

The historical Haiku recorder identifies order by comparing candidate text. For the identical-candidate
item `3099`, both calls therefore carry `AB` and the same request and response hashes. The replay uses
their recorded call positions. It does not invent a missing judgement.

## Provenance and extraction

The scoring source is
[`140f406a55a8ce46b24f1b51c5c32c23daf035b7:examples/council/stack/mm_stack.py`](https://github.com/NexusGPT/driftbench/blob/140f406a55a8ce46b24f1b51c5c32c23daf035b7/examples/council/stack/mm_stack.py).
Its cascade assertion is in `examples/council/results/mm-stack-replay.json` at the same commit.
Council IDs, later-seat raw recordings, Jev per-seat outcomes and labels come from that commit.

The original script reads its frozen first-seat recordings from a separate research checkout.
Those inputs are pinned here to Git object `0278595cb5b5a6b49830a1cacdbfd22bb951c0de`:

- `examples/judge-benchmarks/experiments/mm-results/native-dev400-c576-direct-decisions.jsonl`
- `examples/judge-benchmarks/experiments/mm-results/vote3-dev400-c576-chat-decisions.jsonl`
- `examples/judge-benchmarks/experiments/mm-results/native-dev400-c576-provider-refusals.jsonl`
- `examples/judge-benchmarks/experiments/mm-results/native-dev400-c576-items.json`

The fixture records each source's full commit ID, Git blob ID and SHA-256. Its own SHA-256 is
`a18685b738d4bd2a08e8ea9ccac9a07b17330eeedfaaaaa3a0a0c7ed3d24e771`.
The test pins these fixture bytes. To regenerate, with those objects already present locally:

```sh
python3 examples/escalation/extract-fixture.py
```

Extraction uses only `git show` and `git rev-parse`. Replay itself requires neither Git history,
another worktree, network access nor the original dataset. Jev's raw HTTP cassette contains only request
hashes and lacks item IDs; this extraction therefore preserves the historical decoded per-seat results
instead of claiming to reparse the Jev HTTP bodies. Haiku's content-grounding validation is also historical:
its recorded parse status is retained, while candidate text is omitted.

## Limits

**Generator-family independence is unverified for every historical row.** The DEV400 metadata did not
provide the generator families. The example passes the explicit sentinel `agentFamily: 'unknown'` and
reports that limitation. It cannot certify the package's no-same-family policy for these historical calls.
Live callers must supply their real generator family; known conflicts remain rejected by the package.

This is a development-set reproduction, not an unseen test, new model evaluation, fairness claim or
guaranteed accuracy. The research compared multiple designs on these same rows. This example does not
include the harm gate or the larger 91.58 stack, and does not recompute bootstrap intervals.

The repository's MIT license covers its code. This extraction retains recorded results and
minimal benchmark metadata, not the source dataset or prompts. It makes no claim that third-party
dataset content or model-output quotations are relicensed; their upstream terms still apply.

## Verification evidence

The replay test was written before its implementation and failed on the missing replay module.
After implementation it reproduced the pinned scores. A routing mutation replacing the trigger list
with `[]` made the score test fail: expected 91.16, received 89.65. The trigger list was then restored.
Tests also invert every label and require identical predictions and routes, reject incomplete coverage
and missing later-seat recordings, pin fixture bytes, check subset scores, and make `fetch` throw.
An independent comparison executed the original `mm_stack.py` function definitions from the pinned
Git object against its source inputs. Both games and both item scores match on all 400 rows.
