# LangWatch: comparison

LangWatch is an evaluation platform with a catalogue of evaluators (langevals). Scenario is its SDK for simulated user conversations, judged against a scenario. This page reads the evaluators at commit e683dd9e and the Scenario SDK at commit ad220e6a.

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Per-criterion judge rules | ahead | measured head-to-head | Same haiku judge, 12 fixture pairs with 3 repeats, 40 hand labels. Criteria at the bar: 11 of 12 (ours) against 10 of 12 (with their rules). Rules not adopted. | Not reproducible from main yet: the test is awaiting merge. |
| Judge verdict prompt | ahead | measured head-to-head | Block coverage_before_offer.2, hand label fail: ours fail, theirs inconclusive. On 40 labelled blocks: ours 39 of 40, theirs 37 of 40. | Not reproducible from the repository: the measurement is a local script outside it. |
| Judge decision phase | limit | compared against their docs or code. Not applicable: blocks are fixed, so there is no per-turn decision. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Simulated user prompt | ahead | measured head-to-head | The agent asks which plan the user wants and never asks for an email. The simulated user gave an email unasked in 3 of 24 cases for LangWatch and 0 of 24 for ours (12 cases, 2 runs each). Replies averaged 9.4 words for LangWatch and 20.9 for ours. | Not reproducible from the repository: the measurement is a local script outside it. |
| Script succeed() and fail() | equal | compared against their docs or code | Matches their end verdict: succeed() or fail() ends the run after the block before it, and the later blocks are reported as skipped, not failed. Nothing beyond the tests has been measured. | Not reproducible from main yet: the test is awaiting merge. |
| Caching | ahead | compared against their docs or code | Their cache key has no repeat index and no block position, so the three repeats of one golden run share a key and repeats 2 and 3 read the answer of repeat 1. Ours differs per repeat. Each block also prints its cache key in the report. No run was measured; the comparison reads their key construction. | Not reproducible from main yet: the test is awaiting merge. |
| Seeding | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| exact_match | ahead | measured head-to-head | Reply "Thanks." line break "Yes", reference "Thanks. Yes", hand label pass: LangWatch fails it, driftbench passes it. On 16 labelled replies: LangWatch 15 of 16, driftbench 16 of 16. The margin is one case. | Not reproducible from main yet: the test is awaiting merge. |
| ROUGE and BLEU | ahead | measured head-to-head | The ragas profile matches the reference to 1e-9 on 8 fixed pairs. Its stemmer matches 1532 of 1533 sample words. Both profiles appear side by side in the verdict evidence, which the reference does not show. | Not reproducible from main yet: the test is awaiting merge. |
| Pairwise comparison | ahead | measured head-to-head | 20 fictional Acme pairs, judged in both orders: ours 20 of 20 correct and consistent, theirs 15 of 20 correct with 5 ties. | Not reproducible from the repository: the measurement is a local script outside it. |
| Prompt-injection and jailbreak detection | in progress | compared against their docs or code. Their classifiers were not run, because their external service was not set up here. | With the final criterion, our judge caught 24 of 24 attacks on each held-out set. It flagged 1 benign message on held-out sets 1 and 3 and none on held-out set 4 (run once, unseen). Pattern rules caught 12 to 13 of 24 on the held-out sets. | Not reproducible from the repository: the measurement is a local script outside it. |
| PII detection | ahead | measured head-to-head | 120 fictional messages, half personal. Judge (haiku, new rubric): recall 60 of 60 on each set, with 1 false positive in 60 on the held-out check and 0 in 60 on the development set. Presidio person names: recall 40 of 50, with 10 false positives in 70. | Not reproducible from main yet: the test is awaiting merge. |
| Retrieval metrics (faithfulness, context precision and recall) | limit | compared against their docs or code. Not applicable: our blocks carry no retrieved contexts. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Annotation anchors | equal | compared against their docs or code | Matches their span anchors when the adapter supplies span ids: a tool call keeps its OpenTelemetry span id, and a label on it resolves to that id. Nothing beyond that has been measured; a live trace import was not tested. | npx vitest run packages/adapters/test/traces/otel.test.ts (on main). Not reproducible from main yet: the test is awaiting merge (the span-anchor and view-anchor tests). |
| Annotation queues with assignment and scores | equal | compared against their docs or code | Matches their queue with take, label and done, and a score on each reviewer's vote, with the reviewers' votes checked for how often they agree. Scales adopted: a score outside a criterion's configured scale is refused and not saved. | Not reproducible from main yet: the test is awaiting merge. |
| Dataset model | equal | compared against their docs or code | Design difference, no common case. Ours keeps a dataset as spec files under version control, identified by a content hash, so a change is a reviewable diff and a run names the exact content it ran. Their rows live in a database and are edited in the platform UI. | Not reproducible from the repository yet. |

## Not compared

- LangWatch's prompt-injection classifiers (Azure jailbreak, prompt injection, OpenAI moderation): not run, because their external service was not set up here.
- Judge prompt, simulated user, pairwise comparison and injection detection: 100+ case measurements on haiku and sonnet are still needed.
- Sonnet with the new PII rubric: pending.
- Scenario's cache: no run was measured. The per-block key view was not found in their cache client, and the cache file cited in the table is not in the clone.
- Live trace import into a run: not measured.
