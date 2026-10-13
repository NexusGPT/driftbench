# Package response relevance comparison

This comparison exercises the opt-in `response-relevance` assessment from
`packages/judges`. The package owns prompt construction, quote validation, and
the final decision. The runner supplies transcript data, invokes Haiku through
`claude -p`, records the full response and reported cost, and compares the
package result with the existing construction label.

## Scope and provenance

The source corpus and historical recordings come from
[`../deepeval/hard`](../deepeval/hard/README.md), introduced by PR 123.
Only its G-Eval strict row is compared here. Corpus files, labels, native metric
templates, and historical recordings are unchanged.

The original held-out losses were inspected to diagnose the repair. Consequently,
this is an **exposed repair regression**, not an untouched estimate of
generalization. Prompt revisions use the 120-case tuning corpus only. The final
feature is frozen before one 72-case held-out measurement. No prompt receives a
case ID, family, construction label, or paired alternative.

The historical shipped prompt was frozen at `12801e1`. The additional default
tuning measurement here uses branch-start `9970c938`, whose default already has
the criterion ledger. PR 146 advances the base to `fa05832b`; subsequent main
merges include PRs 164, 165, 166, 167, 169, 170 and 173. The final upstream base
at measurement time is `71c26039`. After the first PR checks pass, main advances
to `b06b5ddb`. Merge `38c5a79f` integrates that base without changing the opt-in
policy, any recorded feature prompt, or any replayed feature result. These
defaults are distinct versions. PR 185 then lands upstream; merge `75755c08`
integrates main `98d82dcf` with the same feature policy and recorded results.

## Recorded results

| Procedure | Tuning | Original held-out row |
|---|---:|---:|
| Historical shipped | 99/120 | 65/72 |
| Historical comparison-only candidate | 120/120 | 69/72 |
| DeepEval G-Eval strict | 119/120 | 70/72 |
| Branch-start default, `9970c938` | 105/120 | Not remeasured |
| Package feature v1, `d0221c12` | 116/120 | Not run |
| Final package feature, `b97fe578` | 118/120 | **72/72** |

The branch-start default has five unparsed responses. Feature v1 has no unparsed
responses; its four misses reject a descriptive identification because it does
not repeat the literal value. Version 2 makes identification versus explicit
literal delivery a separate reasoning step. It also repairs a review-discovered
API defect where a requested symbol-only response cannot ground its exact quote.

Two plugin interruptions lose an in-flight tuning response. Both remain recorded
as unparsed, inconclusive invocation errors and are never retried. Their costs
are conservatively accounted at the full $0.05 reservation each. Partial results
and source freezes remain in `*-v2-interrupted*.json`; the reconciliation files
identify the lost inputs. Model prompt digests match across the recovery merges.
The resumed runner completes only missing inputs, with serial model calls.
All 118 cases with a returned response match their labels. The two invocation
errors remain in the 120-case denominator.

Tuning has 120 nominal cases but 84 distinct prompt inputs. The held-out corpus
has 72 distinct inputs. Repeated tuning inputs reuse one recording. The score
script reports nominal Wilson intervals and paired exact tests; related template
families violate the independence assumption, so these are descriptive only.
A measured count lead does not establish general superiority.

## Compatibility and tests

This feature is opt-in. This branch preserves the default system prompt,
rendered prompt bytes, and cache identity relative to its upstream base.
The legacy prompt/parser golden tests and the 1,028-entry cassette replay remain
unchanged. No default quality claim is made from the feature result.

Red-first feature tests fail before implementation: 28 failures among the
initial 48 tests. The public helper, schema, aggregation, incompatible-request
guards, and cassette behavior are absent. A second red test run exposes three
symbol-only quote failures. The package documentation describes full-context
input requirements and the distinction between relevance, factual truth, and
real execution.

A third red test reproduces a provider-truncated response replaying as pass when
its raw JSON is complete. Relevance cassettes now retain the provider rejection
and its reason. The focused relevance, cassette and legacy run passes 77 tests.
Default and legacy rendering and cache keys match upstream `71c26039` across
1,440 requests. The unchanged `SYSTEM_PROMPT` declaration is verified separately
from the opt-in feature policy. After the `b06b5ddb` integration, 124 focused
tests pass, including pointwise fact-ledger and escalation composition. The
1,440 default and legacy comparisons also match that newer base. A separate
free replay verifies exact feature prompts and complete parsed results for all
192 final tuning and held-out cases. After PR 185, all 151 focused tests pass,
the package build and typechecks pass, and the 1,440 compatibility comparisons
match `98d82dcf`. See `post-merge-replay.json` and
`post-merge-verification.json`.

Unit tests prove schema, source restriction, aggregation and compatibility.
Scripted verdicts do not prove model judgment; the recorded model runs provide
that evidence. Quote grounding cannot prove that the model extracted every
obligation or assigned the correct semantic status.

## Reproduction

From the repository root, verify current package compatibility without model calls:

```sh
pnpm exec tsx comparisons/geval-strict/replay-current.ts
python3 comparisons/geval-strict/score.py tuning heldout
pnpm exec vitest run packages/judges/test/response-relevance.test.ts packages/judges/test/legacy-main.test.ts packages/judges/test/cassette.test.ts packages/judges/test/pointwise-fact-ledger.test.ts packages/judges/test/escalation-composition.test.ts packages/judges/test/escalation.test.ts --maxWorkers=2
```

The original measurement replay below requires checkout `9b0bfaaf`, whose full
package source matches the immutable measurement freezes. Its `integrity.json`
and `verification.json` describe that measurement tree. Later integration does
not overwrite those freezes or measurements:

```sh
pnpm exec tsx comparisons/geval-strict/run.ts tuning feature replay
pnpm exec tsx comparisons/geval-strict/run.ts heldout feature replay
python3 comparisons/geval-strict/score.py tuning heldout
pnpm exec vitest run packages/judges/test/response-relevance.test.ts packages/judges/test/legacy-main.test.ts packages/judges/test/cassette.test.ts --maxWorkers=2
```

The runner refuses changed prompt/corpus/source freezes, overlapping tuning and
held-out inputs, concurrent runs, unresolved costs, and fresh held-out calls
after the completion marker. A failed invocation stays recorded and is never
retried to improve its score. Replay reconstructs requests and re-runs the
package parser; scoring requires identical replayed rows.

`calls.jsonl` contains actual envelopes, including model usage and reported USD.
Feature freezes include package source digests, CLI version and settings.
`*-v1.json` preserves the first feature measurement and its free replay; its
source is checkpoint `d0221c12`. Default recordings and replay are stamped to
`9970c938`, before the upstream evidence-contract change.

Authorized measurement cap: **$5**. Final accounted spend: **$0.25191280**,
comprising **$0.15191280** reported by 322 response envelopes and **$0.10000000**
in conservative reservations for the two interrupted tuning calls. The final
held-out run reports **$0.03847232**, with 72 distinct invocations and no errors.
Both final feature replays reproduce every recorded result with zero fresh calls.
Actual recorded model: `claude-haiku-5-5`.

On the exposed held-out row, the feature gains two cases over DeepEval and loses
none. The nominal paired exact p-value is 0.5. This count lead does not establish
general superiority, and the earlier held-out losses informed the repair.
