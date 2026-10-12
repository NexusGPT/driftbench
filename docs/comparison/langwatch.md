# LangWatch: comparison

LangWatch is an evaluation platform with a catalogue of evaluators (langevals), and Scenario is its SDK for simulated user conversations judged against a scenario. This page reads the LangWatch evaluators at commit e683dd9e and the Scenario SDK at commit ad220e6a.

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Per-criterion judge rules | ahead | measured head-to-head | Block explicit_confirmation.3 (CONFIRM typed, no order placed, label fail). Without the rules, the judge gave fail, pass and inconclusive across three haiku runs; with the rules, pass in both runs. | Not reproducible from main yet: the test is awaiting merge. |
| Judge verdict prompt | ahead | measured head-to-head | Block coverage_before_offer.2, hand label fail. Ours: fail. Theirs: inconclusive. | Not reproducible from the repository: the measurement is a local script outside it. |
| Judge decision phase | limit | compared against their docs or code. Not applicable: blocks are fixed, so there is no per-turn decision. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Simulated user prompt | ahead | measured head-to-head | The agent asks "Which plan would you like to move to?" and never asks for an email. LangWatch's text gave "my email is sam.rivera@example.com" in the reply to an off-topic refusal and in the closing case. | Not reproducible from the repository: the measurement is a local script outside it. |
| Script succeed() and fail() | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Caching | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Seeding | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| exact_match | ahead | measured head-to-head | Reply "Thanks.\nYes", reference "Thanks. Yes", hand label pass. LangWatch: passed false. Driftbench: pass. | Not reproducible from the repository: the measurement is a local script outside it. |
| ROUGE and BLEU | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Pairwise comparison | ahead | measured head-to-head | Fixture pair where the correct reply says "Acme Mobile M is 25 dollars a month with 40 GB" and the wrong one says "15 USD a month with 10 GB", golden answer given. Both orders are judged. | Not reproducible from the repository: the measurement is a local script outside it. |
| Prompt-injection and jailbreak detection | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository: the measurement is a local script outside it. |
| PII detection | ahead | measured head-to-head | Personal recall 60 of 60 on each set. False positives: 1 in 60 on the held-out set, 0 in 60 on the development set. | Not reproducible from the repository: the measurement is a local script outside it. |
| Retrieval metrics (faithfulness, context precision and recall) | limit | compared against their docs or code. Not applicable: our blocks carry no retrieved contexts. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Annotation anchors | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Annotation queues with assignment and scores | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Dataset model | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |

## Not compared

- LangWatch's prompt-injection classifiers (Azure jailbreak, prompt_injection, OpenAI moderation): not run, because they need an API key that was not available.
- Judge prompt, simulated user, pairwise comparison and injection detection: 100+ case measurements on haiku and sonnet are still needed.
- Sonnet with the new PII rubric: pending.
- A live run of Scenario's cache: no run view of theirs was measured, so the comparison reads the key construction.
- Live trace import into a run: not measured.
