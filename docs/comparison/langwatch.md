# LangWatch: comparison

LangWatch is an evaluation platform. Its langevals evaluators cover exact match, overlap scores, pairwise comparison, judges, PII and injection checks. Its Scenario SDK runs a simulated user against an agent and judges the conversation. The source read for this page is commit e683dd9e (evaluators) and commit ad220e6a (Scenario).

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Per-criterion judge rules | ahead | measured head-to-head | Case explicit_confirmation.3: the customer types CONFIRM and no order is placed (hand label fail). Without their rules, the judge gave fail, pass and inconclusive across three runs. With their rules, it gave pass in both runs. In the second measurement, pairs separated 3 of 3 on 12 of 12 without their rules and 11 of 12 with them. | Not reproducible from main yet: the test is awaiting merge. |
| Judge verdict prompt | ahead | measured head-to-head | Block coverage_before_offer.2, hand label fail. Ours: fail. Scenario: inconclusive. On 40 hand-labelled blocks (16 pass, 24 fail), one call per prompt: ours agrees with the label on 39 of 40, Scenario on 37 of 40. Neither prompt passes a fail label. Caveat: one run per prompt, one model. | Not reproducible from the repository: the measurement is a local script outside it. |
| Judge decision phase | limit | compared against their docs or code. Reason: driftbench judge blocks are fixed, so there is no per-turn decision. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Simulated user prompt | ahead | measured head-to-head | The agent asks "Which plan would you like to move to?" and never asks for an email. Scenario's simulated user gave "sam.rivera@example.com" unasked, in a reply to an off-topic question and in the closing case. Across 12 cases with 2 runs each, email given unasked: Scenario in 3 of 24 cases, driftbench in 0 of 24. | Not reproducible from the repository: the measurement is a local script outside it. |
| Script succeed() and fail() | behind | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Caching | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Seeding | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| exact_match evaluator | ahead | measured head-to-head | Reply "Thanks.\nYes", reference "Thanks. Yes", hand label pass. LangWatch: fail. Ours: pass. On the same 16 replies with the same hand labels, LangWatch agrees on 15 of 16 and ours on 16 of 16. The labels are the author's, and the line-break case was added after the bug appeared, so the margin is one case. | Not reproducible from main yet: the test is awaiting merge. |
| ROUGE and BLEU | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Pairwise comparison | ahead | measured head-to-head | Fixture pair: the correct reply says "Acme Mobile M is 25 dollars a month with 40 GB", the wrong one says "15 USD a month with 10 GB", and the golden answer is given. On 20 pairs judged in both orders: ours 20 of 20 correct and consistent across orders; LangWatch 15 of 20 correct, with 5 ties. | Not reproducible from main yet: the test is awaiting merge. |
| Prompt-injection and jailbreak detection | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository: the measurement is a local script outside it. |
| PII detection | equal | measured head-to-head | On 20 held-out messages, the judged name detector finds 10 of 10 names with 0 false positives; Presidio finds 8 of 10 with 1 false positive. On the earlier set of 23 messages, the judge finds 5 of 5 names with 4 false positives; Presidio finds 5 of 5 with none. Measured on 43 messages in total. | Not reproducible from main yet: the test is awaiting merge. |
| Retrieval metrics (faithfulness, context precision and recall) | limit | compared against their docs or code. Reason: driftbench blocks carry no retrieved contexts. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Annotation anchors | behind | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Annotation queues with assignment and scores | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Dataset model | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |

## Not compared

- LangWatch's prompt-injection classifiers (Azure jailbreak, prompt injection, OpenAI moderation): not run, because they call an external service that was not available here.
- LangWatch's annotation interface: no run here, so the interface itself is not compared.
- Scenario's caching on a live run: read from source only, because a run needs the Scenario runtime and a model.
- LangWatch's trace-span annotation anchors: driftbench stored runs carry no trace spans, so the span form has no like-for-like case.
- Retrieval metrics (faithfulness, context precision and recall): driftbench blocks carry no retrieved contexts, so there is no like-for-like case.
- Scenario's judge decision step: driftbench blocks are fixed, so there is no per-turn decision to compare.
