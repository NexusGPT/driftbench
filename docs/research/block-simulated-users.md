# Simulated human experiments for blocks

**Research note.** This page records three pre-registered experiments on simulated users. They ran on ABCD, a public set of human customer service dialogues under the MIT licence, against a `claude-haiku-5-5` support agent built from the ABCD guidelines. The scripts, pre-registrations and raw runs are in PR 418 (branch `research/block-sim`, head `a460cdffa`).

The experiments cost 5.78 USD of a 25 USD cap.

## Results

| # | Claim | Verdict | Key numbers |
|---|---|---|---|
| H11 | Simulated verdicts flip across simulator families. | Falsified | The cross-family flip share is 0.15. The within-family re-run flip share is 0.20. The difference is -0.05 (interval -0.125 to 0.000). 20 blocks, 8 trials each, `gpt-5.4-nano` against `gemini-3.5-flash-lite`. |
| H10 | An agenda engine outside the model beats prompting for simulator realism. | Supported | The engine is closer to human users than the findings prompt on 5 of 6 metrics. Three intervals exclude 0. It is worse on one metric, Uncert%, with an interval that includes 0. No metric is worse with an interval that excludes 0. Short turns are 38.0% against 2.0% (humans 38.2%). |
| H14 | Uncovered production clusters yield more failing blocks than random samples. | Falsified | Failing blocks: 2 of 17 for uncovered clusters, 6 of 17 for random ones. The difference is -0.235 (interval -0.484 to +0.053). |

## What the results mean

* **An agenda engine earns its place.** Models playing users write turns that are too long, ask too many questions and are never terse. Drawing those behaviours outside the model, with untuned human defaults, fixes them. A findings prompt made questions worse, from 21% to 50%.
* **A multi-simulator flag needs a noise baseline.** With pass^4 on 4 trials, flaky blocks flip on a plain re-run as often as on a family swap. Report each block's within-family flip rate beside the cross-family rate. Flag only blocks that exceed it.
* **Coverage gaps do not predict failures here.** A suite written from the prompt covered the agent's hard flows. The uncovered clusters were easy ones. An uncovered cluster stays a coverage signal. Prioritising clusters needs a failure estimate per cluster.

## Limits

* ABCD customers are crowd workers playing scenarios. They met human agents, not this agent.
* No consented production logs exist, so calibration error and abandonment per outcome class could not be computed for H10.
* One agent, one domain, small simulator models.
* The block contract checks gold buttons as a set, not by order or value.
