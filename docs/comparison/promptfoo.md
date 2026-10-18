# promptfoo: comparison

promptfoo is an LLM evaluation framework. It runs assertions on model replies and tool calls, red-team probes, and a simulated user for conversations. This page compares our checks with its source at commit 8014282. Some rows are measured on the same inputs, or on generated cases with a fixed seed.

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Word count (min and max) | ahead | compared against their docs or code | The reply "one" and "two", on separate lines, counts as 2 words. | Not reproducible from main yet: the test is awaiting merge (PR 50). |
| Character bounds | ahead | compared against their docs or code | "é😀" passes a character minimum and maximum of 2. Counting UTF-16 units gives 3 and fails. | Not reproducible from main yet: the test is awaiting merge (PR 50). |
| Valid JSON, JSON schema, contains-json | ahead | measured head-to-head | 'Here you go: {"price": 35}' fails their is-json check and passes our embedded mode. Our default strict mode fails it, because the whole reply must be JSON. | Not reproducible from main yet: the test is awaiting merge (PR 50). |
| JSON paths | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Tool-call F1 | ahead | compared against their docs or code | Expected catalog.search with plan mobile, called with plan home. Their set check passes it. Ours fails it. | Not reproducible from main yet: the test is awaiting merge (PR 50). |
| Refusal | ahead | compared against their docs or code | "Je ne peux pas vous aider." is a refusal for us. For them it is one only when the provider flags it. | Not reproducible from main yet: the test is awaiting merge (PR 50). |
| XML, HTML and SQL validity | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Regex | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Contains, contains-all, contains-any | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| icontains, icontains-all, icontains-any | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Equals | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Starts-with | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Levenshtein, similar (cosine, dot, euclidean) | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| ROUGE, BLEU, METEOR, GLEU, n-grams | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Perplexity | limit | compared against their docs or code. Reason: needs token log probabilities, which our adapter contract does not carry. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Cost and latency | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trace span count, duration, error spans | limit | compared against their docs or code. Reason: theirs use OpenTelemetry spans, and our adapters report calls, not spans. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| LLM rubric | equal hard; equal held-out | measured 2026-10-13; candidate not yet the shipped default | Hard candidate 120/120 vs promptfoo 115/120; held-out 72/72 vs 69/72. | `python3 comparisons/promptfoo/hard/run.py rubric audit --set heldout --cap-usd 0`; `python3 comparisons/promptfoo/hard/score.py` |
| Factuality, model-graded factuality | ahead hard; equal held-out | measured 2026-10-13; candidate not yet the shipped default | Hard candidate 120/120 vs promptfoo 108/120; held-out 72/72 vs 70/72. | `python3 comparisons/promptfoo/hard/run.py factuality audit --set heldout --cap-usd 0`; `python3 comparisons/promptfoo/hard/score.py` |
| Answer relevance, conversation relevance | limit | compared against their docs or code. Reason: promptfoo generates three questions with a text provider before embedding them, so our local route still needs a text model. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Context faithfulness, recall, relevance (RAG) | limit | compared against their docs or code. Reason: our Max has no retrieval step. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Finish reason | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Classifier, moderation, pi and webhook checks | limit | compared against their docs or code. Reason: theirs call external services, and our checks are local. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Custom code checks (JavaScript and Python assertions) | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Skill used | ahead | measured against our earlier version | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Function-call and tools-call validity | ahead | measured head-to-head | A valid call against its tool's JSON Schema fails promptfoo's check when the provider has no validator. Our schema check passes it. | Not reproducible from main yet: the test is awaiting merge (PR 50). |
| Trajectory: tool used | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: tool sequence | ahead | compared against their docs or code | Promptfoo's exact-mode reason lists the expected and actual tool names, with no call position. Ours names the first difference by call position. | Not reproducible from main yet: the test is awaiting merge (PR 50). |
| Trajectory: tool arguments | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: step count | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: goal success | ahead hard; ahead held-out | measured 2026-10-13; candidate not yet the shipped default | Hard candidate 120/120 vs promptfoo 60/120; held-out 72/72 vs 36/72. Default trajectory summary omits final state; see the equal-evidence ablation. | `python3 comparisons/promptfoo/hard/run.py goal audit --set heldout --cap-usd 0`; `python3 comparisons/promptfoo/hard/score.py` |
| Red-team personal data | equal hard; equal held-out | measured 2026-10-13; candidate not yet the shipped default | Semantic privacy candidate 120/120 vs 120/120; held-out 70/72 vs 71/72. Shipped held-out 72/72; retain that route. | `python3 comparisons/promptfoo/hard/run.py pii audit --set heldout --cap-usd 0` |
| Red-team plugins | behind | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Red-team strategies (encodings, multilingual, multi-turn) | equal | compared against their docs or code | A base64 encoding of an attack, and a French instruction placed in the world notes. Neither changed the findings. | Not reproducible from the repository yet. |
| Simulated user: persona, turn limit, stop token | ahead | compared against their docs or code | The persona's fact reaches the agent only after the agent asks for it. The run fails if the model gives a fact the agent did not ask for. | pnpm -s vitest run packages/users/test/simulated.test.ts -t "gives a fact only after" |
| Simulated user: initial messages | limit | compared against their docs or code. Reason: not measured on a run. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Simulated user: stateful (send only the latest message) | limit | compared against their docs or code. Reason: adapters send the full history by design. | No example recorded in the evidence. | Not reproducible from the repository yet. |

## Not compared

- ROUGE, BLEU, METEOR, GLEU and n-grams: not compared on this page. The LangWatch comparison builds them.
- Perplexity: needs token log probabilities, which our adapter contract does not carry.
- Trace span count, duration and error spans: theirs use OpenTelemetry spans.
- Context faithfulness, recall and relevance (RAG): our Max has no retrieval step.
- Classifier, moderation, pi and webhook checks: theirs call external services, and ours are not built.
- Red-team reply patterns on injected blocks, and the goal-shift case: promptfoo was not run against them. Its red-team grades each plugin, not each injected block.
- Prompt-extraction half of the personal data check: not measured, and we have no check for it.

## Hard model-judge measurements

Measured 2026-10-13 through `claude -p --model haiku`, resolving to `claude-haiku-5-5`. Hard sets have 120 cases, balanced 60/60. Held-out sets have 72 cases, balanced 36/36, from new seed `20261113`. Labels are fixed before any held-out call. The candidate is **not yet the shipped default**. Its procedure is frozen before held-out scoring, and held-out outcomes do not tune it. The default goal comparison has unequal evidence; its separate equal-evidence ablation appears below.

| Row | Hard shipped / candidate / peer (120) | Held-out shipped / candidate / peer (72) | Highest score hard / held-out | Candidate vs peer verdict hard / held-out | Hard / held-out paired p | Row total USD |
|---|---|---|---|---|---|---|
| LLM rubric | 116 / 120 / 115 | 71 / 72 / 69 | candidate / candidate | equal / equal | 0.0625 / 0.25 | 0.214041 |
| Factuality | 115 / 120 / 108 | 70 / 72 / 70 | candidate / candidate | ahead / equal | 0.00048828125 / 0.5 | 0.214688 |
| Personal data | 120 / 120 / 120 | 72 / 70 / 71 | all tied / shipped | equal / equal | 1 / 1 | 0.208171 |
| Trajectory goal success | 117 / 120 / 60 | 72 / 72 / 36 | candidate / shipped + candidate | ahead / ahead | 1.7347235e-18 / 2.910383e-11 | 0.296043 |

| Set | Row | Shipped 95% Wilson | Candidate 95% Wilson | Default peer 95% Wilson |
|---|---|---|---|---|
| Hard tuning | LLM rubric | 91.74% to 98.70% | 96.90% to 100.00% | 90.62% to 98.21% |
| Held-out | LLM rubric | 92.54% to 99.75% | 94.93% to 100.00% | 88.45% to 98.57% |
| Hard tuning | Factuality | 90.62% to 98.21% | 96.90% to 100.00% | 83.33% to 94.19% |
| Held-out | Factuality | 90.43% to 99.23% | 94.93% to 100.00% | 90.43% to 99.23% |
| Hard tuning | Personal data | 96.90% to 100.00% | 96.90% to 100.00% | 96.90% to 100.00% |
| Held-out | Personal data | 94.93% to 100.00% | 90.43% to 99.23% | 92.54% to 99.75% |
| Hard tuning | Trajectory goal success | 92.91% to 99.15% | 96.90% to 100.00% | 41.19% to 58.81% |
| Held-out | Trajectory goal success | 94.93% to 100.00% | 94.93% to 100.00% | 38.75% to 61.25% |

Unique recorded spend is 0.93294293 USD across 2496 calls. Unknown costs: 0. Row costs include all unique calls for both sets, the shipped baseline, candidate, peer, equal-evidence ablations, and archived attempts. Both labels and every case remain in the denominator; inconclusive answers count as wrong.

The default peer prompts are unchanged at commit `8014282`. The candidate returns separate requirement checks and computes the verdict in code. The factuality audit addresses label/explanation contradictions, arithmetic and equivalent quantities. Complete inputs and recorded answers remain in `comparisons/promptfoo/hard/recorded/losses.md`. The candidate has not been ported to `packages/judges`.

Goal construction requires exact requested identifiers and field values; a `-Plus` identifier is a distinct plan. Goal success has an information difference: our judge reads the persisted final state, while the default trajectory summary omits arguments and results. The default summary collapses some state-distinct pairs into identical inputs. Giving the unchanged peer prompt the same final state produces this separate ablation:

| Goal equal-evidence set | Shipped (95% Wilson) | Candidate (95% Wilson) | Unchanged peer with final state (95% Wilson) | Candidate vs peer outcome | Paired p |
|---|---|---|---|---|---|
| hard | 117/120; 92.91% to 99.15% | 120/120; 96.90% to 100.00% | 117/120; 92.91% to 99.15% | equal | 0.25 |
| heldout | 72/72; 94.93% to 100.00% | 72/72; 94.93% to 100.00% | 71/72; 92.54% to 99.75% | equal | 1 |

| Default goal summary set | Distinct inputs | Input-only cached accuracy ceiling |
|---|---|---|
| hard | 65 | 65/120 |
| heldout | 39 | 39/72 |

The ceiling sums the larger truth-label count for each identical input. One cached verdict per input cannot exceed it. It describes this constructed set and replay policy, not a universal limit on the peer.

The normal goal result measures this information difference as well as the procedure. The equal-evidence result is the closer comparison of reasoning. Cases share construction families, and identical goal summaries share cached answers. The case-level intervals and tests are nominal summaries of these synthetic sets; they do not prove superiority on arbitrary unseen tasks.

The privacy row measures phone/email model judgments on fictional ownership bindings and reserved values. It does not measure the shipped scanner, which deliberately exempts fictional domains and phone ranges. IBAN and national-register checks are not included. Relevance and RAG retain their limits. Closed QA, G-Eval, external-tool agent rubrics, other red-team plugins and prompt extraction are not hardened separately here.

Held-out privacy shows a candidate regression: it rejects two masked-local-part replies ending in the generic shared domain `contact.test`. The fixed construction labels permit that masking. The peer rejects one such reply, while the shipped judge accepts all of them. This candidate is not a replacement for the shipped privacy route. The held-out errors remain in the census; they do not tune the frozen procedure.

The old peer-only rubric benchmark is **archived and unpublished**. It has 120 case decisions but 88 distinct paid inputs. The owner approves regeneration with distinct offer identities, preserving case labels and family balance. Its 0.02650340 USD remains charged, but its scores are excluded from published outcomes. The reported rubric sets have 120 and 72 distinct payloads.

Candidate freeze: `d7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587`, recorded `2026-10-13T01:13:13+02:00`. Held-out file hashes and label fixation are recorded in `heldout-manifest.json`.

Free reproduction: `python3 comparisons/promptfoo/hard/score.py`. Full coverage and exact prompt verification: `python3 comparisons/promptfoo/hard/verify.py`. Methods and individual replay commands: `comparisons/promptfoo/hard/README.md`.
