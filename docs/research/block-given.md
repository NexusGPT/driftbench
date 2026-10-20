# Block given experiments

**Research note.** This page records three pre-registered experiments on the Given of a block: how a past tool call is shown, how large the context is, and whether a verifier finds hidden Given errors. The agent is a fictional Acme agent on `claude-haiku-5-5`. All data is fictional. The scripts, pre-registrations and raw runs are in PR 417 (branch `research/block-given`, head `d12beda3c`).

The experiments cost 9.53 USD of a 30 USD cap. The agent is the lane's own live Acme agent, not the shared one, so results do not transfer to the shared agent without a re-run.

## Results

| # | Claim | Verdict | Key numbers |
|---|---|---|---|
| H6 | A recorded tool call and the same fact in prose give different behaviour. | Supported | 6 of 15 blocks differ (Holm p below 0.05). The prose arm calls tools again in 332 of 450 runs. The record arm does so in 0 of 450. |
| H8 | Context size and fact position change the pass rate. | Falsified | 2,995 of 3,000 fact runs pass from 2K to 64K tokens at every depth. 0 of 95 tests are significant. All 600 control runs fail, so a pass means the agent used the planted fact. |
| H9 | A Given verifier finds hidden Given errors. | Falsified by the clean-flag rule | 48 of 48 planted defects caught. 2 of 12 clean specs flagged by an over-strict id rule. |

## H6: record against prose

* The pooled gap, record minus prose, is +0.196 (block-cluster bootstrap +0.080 to +0.322).
* The prose arm distrusts its own prose. In 264 of 450 prose replies the agent says the earlier message was wrong or not real.
* The prose arm repeats side effects. In all 90 prose runs of the three lead blocks the agent called `notify_sales` again. The record arm did so in 0 of 90.
* The prose arm costs more: 789 model calls against 450 for the same 450 runs.
* A judge model and a blinded hand reading agreed on 37 of 40 replies, above the bar of 36.
* A Given that seeds a fact as prose is a different test from one that seeds it as a recorded call. The origin of the prefix belongs in the Given hash, and the two never pool.

## H8: context size and position

* The context layer works as an instrument. Measured input tokens sit within -2.3% to +0.3% of the target. Fact depth sits within 0.0096 of the declared depth.
* On this model and task, size and depth change nothing up to 64K. The task is one verbatim fact asked for directly, which is at the ceiling.
* The `context` layer should stay optional. A test that wants to see an effect needs a harder fact task or larger sizes.

## H9: the Given verifier

* The verifier caught every planted defect: a dropped tool result, a fact absent from its message, a flipped world row and an unknown tool. Each is 12 of 12.
* Both flags were the duplicate tool id rule. The Acme agent numbers calls per turn, so `call-1` repeats across turns. A two-turn history with `call-1` twice was accepted by three provider wires, so the rule was too strict at the time. The rule was later scoped to one message.
* `value_in_message` matches substrings. It grounded `lang: EN` in 7 of the 12 clean specs through unrelated words. It needs token boundaries.
* Over the 2,351 example specs that load, `requires: auto` finds 0 specs that would become `not_run`.
* Teacher-forced history writes 2,698 tool calls over the example specs. 2,688 have no result. The Anthropic adapter sent such a call with empty input and a result whose text was `null`. That is a Given the spec never wrote. An adapter should refuse a call without a result, never send `null`. PR 422 later fixed this on main: a history call with no recorded result is never sent as `null`.

## Limits

* One agent model and one prompt. The prompt says facts must come from a tool result or the customer. A prompt without that rule may distrust prose less.
* The API rejected temperature 0 on this model, so runs use default sampling.
* The prose template writes results as "key value" sentences. A free paraphrase was not tested.
* A 7-hour network outage hit H8. The failed jobs ran again once, and each job counts once.
