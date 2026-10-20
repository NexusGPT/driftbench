# Block framework value, blame and diagnosis experiments

**Research note.** This page records five pre-registered experiments on the value-check ladder, blame rules and diagnosis. The agent is a fictional Acme sales agent on `claude-haiku-5-5`. All data is fictional. The scripts, pre-registration and data are in PR 441 (branch `research/block-framework-value`, head `886901c2d`).

The experiments cost 3.80 USD of a 12 USD cap. The pre-registration was pushed before any paid call, and the lane made no deviation in design, models, seeds or thresholds.

## Results

| # | Verdict | Headline |
|---|---|---|
| HF5 | Falsified by the registered rule | The ladder has 0 false passes and 0 false fails. The normaliser also has 0 false passes on the reference set, so the claim "below the normaliser" fails. |
| HF6 | Supported | Rung 1 settles 59 of 116 flips (50.9%): 49 pass, 10 fail, 0 disagreements. |
| HF7 | Supported | Read-first false acceptance: 1 of 432 on `gpt-6-luna`, 0 of 432 on `gemini-3.6-flash`. Side by side: 7 of 432 and 0 of 432. |
| HF8 | Supported | Blame rules as data reproduce the hand classes exactly: agent 45, tool definition 28, prompt 3, pass 106. Automatic evidence agrees on 182 of 182 runs. |
| HF9 | Supported, with a caveat | A tool description fix takes R3 failures from 86 of 249 to 0. A prompt fix removes the wording of the R6 failure but not the behaviour. |

## HF5: the ladder against exact match and the normaliser

* Two labellers, `gpt-6.1-sol` and `gemini-3.6-flash`, labelled all 259 runs. They agree on 249 (Scott's pi 0.903 on pass or fail). The reference set is those 249 runs: 183 pass and 66 fail.
* Exact match has 0 false passes and 106 false fails. The ladder has 0 and 0. The normaliser has 0 and 0.
* All 10 disagreements are runs where the agent sent a street abbreviation and `coverage_check` returned `found: false`. One labeller called them real errors. The other called them format differences, which contradicts its own instructions.
* If the split runs count as fail, the normaliser has 10 false passes and the ladder has 0, and every HF5 condition holds. If they count as pass, the ladder is worse than the normaliser by 10 false fails.
* The data do not separate the ladder from the normaliser. They separate the two labellers on the one case class that the ladder was built for. Rule R3 says a value the tool does not find is a real error.

## HF6 and HF7: rung 1 and the judge design

* Rung 1 replays the tool and reads its answer. It settles 59 of the 116 flips. The 57 phone values go to rung 3, because `notify_sales` only stores the value.
* HF7 used 128 items: 56 positives and 72 near misses, each in 2 orders and 3 repeats.
* On `gpt-6-luna`, the read-first design accepted 1 near miss against 7 for side by side. True positives accepted: 99.4% against 100%.
* On `gemini-3.6-flash` both designs are perfect, so the item set does not separate them on the stronger model.
* Read-first needed its second comparison call in 64% (luna) and 67% (gemini) of judgments. Code alone settles a minority.
* Contentless values were accepted in 0 of 108 judgments in every cell.

## HF8: blame rules as data

* Rules in a data file, applied to the hand table through a fixed mapping, reproduce the hand classes exactly.
* With evidence computed automatically, agreement is 182 of 182 runs.
* The rules that read the agent's next action are not tested on an agent that gives up or states a wrong fact after a miss. The H3 data had 0 such runs.

## HF9: the diagnosis is causal

* Fresh runs: 1,701 runs, 0 transport errors.
* **R3 failures** (a `coverage_check` miss on a failing run). Giving the street type in full in the tool description removes all R3 failures: 86 of 249 to 0 of 249. Letting the tool expand abbreviations also gives 0, but the exact assertions still fail on the abbreviated string.
* **R6 failures** (the agent asks for a town that the tool does not need). A prompt fix removes the word "town" from 20 of 102 failing runs to 0. But runs with no tool call fall only from 20 to 17. The agent now asks the customer to confirm the full street address instead.
* Removing the demand removes the wording, not the behaviour. The R6 diagnosis names the right line but not the whole cause.
* Controls stay within rerun noise. The exact oracle is near its ceiling on those blocks.

## Limits

* One agent (`claude-haiku-5-5`), 10 blocks, one language. Two labellers in HF5 and two judge models in HF7; one reply classifier (`gpt-6-luna`) in HF8.
* The hand table was built with a script plus a hand check. The automatic path shares one declared input with it.
* Two secondary analyses were added after the data. Both sit outside every verdict and are labelled secondary.
