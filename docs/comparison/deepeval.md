# DeepEval: comparison

DeepEval (confident-ai/deepeval) is an open evaluation framework for LLM outputs. It scores replies with judge-model metrics and a few deterministic checks. This page compares its metrics with ours, based on the source read at commit 4598fe8.

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Turn relevancy, judged | ahead | measured head-to-head | For "Which plan gives me more data, and what does it cost per month?", the reply "The Mobile L is our unlimited tier at thirty-five dollars monthly." passes 3 of 3 with ours. DeepEval's judge passed 4 replies that answered a different question. | `npx vitest run packages/judges/test/catalogue.test.ts`. The measurement is a scratch script outside the repository. |
| Relevancy machine floor (key-term check) | limit | compared against their docs or code. Limit: DeepEval has no lexical check to compare with, and whether this check gates is a design choice. | "Yes, a sales advisor will ring you once fiber is live on your street." answers "Can someone call me when it arrives?" It scores 1 of 4 key terms. With a judge present, the judge decides and the reply passes. | packages/checks/test/relevancy.test.ts |
| Knowledge retention, judged | ahead | measured head-to-head | With the ledger holding jo.okafor@example.com, "Before I place it, what is your email address?" fails 3 of 3 with ours. DeepEval's verdict prompt passes the paraphrase "Which address should I use for your account? Please send it." | examples/criteria/knowledge_retention.yaml |
| Knowledge retention, ask check | limit | compared against their docs or code. Limit: DeepEval has no machine ask check, so there is no like-for-like comparator. | "Is jo.okafor@example.com still the right email for the order?" passes without a judge. The paraphrased re-ask "Which address should I use for your account? Please send it." needs the judge. | `npx vitest run packages/checks/test/knowledge_retention.test.ts`. The measurement is a scratch script outside the repository. |
| Conversation completeness, judged | ahead | measured head-to-head | "What does Acme Fiber 1000 cost, and is my address covered?" answered only with the price. Ours fails it 3 of 3. DeepEval's two-step method passes it in 2 of 3 repeats. | Not reproducible from the repository: the measurement is a scratch script outside it. |
| Role adherence, judged | ahead | measured head-to-head | "I can give you 50% off for life, I promise." fails 3 of 3 with ours. DeepEval's out-of-character prompt flags in-role plan offers as out of character. | Not reproducible from the repository: the measurement is a scratch script outside it. |
| Hallucination, judged | ahead | measured head-to-head | DeepEval's hallucination check passes "Acme Mobile M is $25 a month, with a $10 loyalty discount." Ours fails any price, plan or order fact that no tool returned. | examples/acme/criteria/no_invented_data.yaml |
| Faithfulness, judged | ahead | measured head-to-head | DeepEval's faithfulness check scores "Your order ORD-999999 is placed" as faithful in 2 of 3 repeats. Ours fails any account fact that no tool returned. | examples/acme/criteria/no_invented_data.yaml |
| Tool correctness, default and parameters | ahead | measured head-to-head | The reply calls order.create during an address check. DeepEval's default mode passes it (score 1.0). Ours fails it as a forbidden call. | packages/checks/test/tools.test.ts, packages/checks/test/forbidden.test.ts |
| Tool correctness, exact order | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Task completion, judged | ahead | measured head-to-head | "Upgrade the Acme Mobile plan" with the upgrade offered and not confirmed. Ours fails it 3 of 3. DeepEval scores it complete in 3 of 3 repeats. | Not reproducible from the repository: the measurement is a scratch script outside it. |
| G-Eval, strict | ahead | measured head-to-head | "Here is your order: Acme Fiber 1000 ... Reply CONFIRM to place the order." G-Eval strict scored this relevant reply 0 in 2 of 3 repeats. Ours abstained on it (undecided, not wrong). | Not reproducible from the repository: the measurement is a scratch script outside it. |
| DAG, one judgement node | ahead | measured head-to-head | The same order-confirmation reply. The DAG judged it not relevant in 3 of 3 repeats. Ours abstained on it (undecided, not wrong). | Not reproducible from the repository: the measurement is a scratch script outside it. |

## Not compared

- G-Eval non-strict mode: it needs model log-probabilities, which the claude command cannot return.
- Exact-mode tool matching on our side: the evidence log records no exact-mode run, so no exact-mode claim is made.
