# H7 on the section selection, fresh sample: 300 new mutants

Lane: pointer-chain. Branch: feature/pointer-chain-h7-fresh. The commit that adds this file is the pre-registration. Nothing below was run before it.

## Why

The second sample (`PREREG.md`, `RESULT.md`, PR 957) missed 14 of 290 (Wilson upper 7.94%) with the declared links. Two product changes followed, calibrated on those 290 as the development set:

* the block writer links a block that expects a tool call to the sections that name the tool (PR 960);
* a block that fails at baseline, or that is fragile, always reruns; the marks come from a procedure and are frozen (PR 961, `packages/core/test/fixtures/sections/h7-rerun-marks.json`: `p1` fails at baseline; `of1`, `of2`, `pl3` are fragile).

This sample measures whether that generalizes. The development set cannot.

## The code and the marks under measurement

* Head of PR 961: `967d16707932e68514daf651a1c12acc9ce36b9d` (independent PASS by sonnet-review-c-2). PR 961 holds PR 960. The code under measurement is that head; a later fix to a review never changes what is measured.
* The marks file is the one at that head. The fresh sample never changes it, and no link, registry entry or threshold changes after the run.

## Fixed before the run

* Population: 300 new single-section mutants of the Acme stand-in prompt (`examples/acme/prompts/acme-sales.md`, sha256 `cd17d54f499f5b03a829f71bd1f66639f3e602335140818a66322b442757c544`): for each of the 30 sections, 5 `negate` and 5 `rephrase` variants.
* Draw: the same generator (`gpt-6-luna`) and the same two prompts as the 90 and the 290 (`research/block-links` commit `3db52eb52`, `mutants.py`). New seeds: variant j (0 to 4) of a section and operator takes seed `20261100 + 100 * j`; a variant that fails the validity gate is retried with `+1`, at most 5 retries. The gate of the 90 applies. A body counts as a failed try when it equals the original, a body already drawn for the same section and operator in this sample, a body of the 90, or the section text of any of the 290 (the whole mutant text is compared with every mutant text of the first two samples; the 110 are pairs of bodies of the 90). Nothing is picked by hand and nothing is replaced after the first suite run.
* A variant that fails after its tries is listed and leaves the sample; n is then below 300 and is reported with the list.
* Runs: the registered flip definition, unchanged. The baseline verdicts v0 and the flaky blocks (`af1`, `d1`) are the registered ones. Same suite (19 conversations, 37 blocks, deterministic checks), same agent model `claude-haiku-5-5`, effort `low`. Each mutant runs the whole suite 3 times; a block that flips against v0 in at least 2 of 3 runs is confirmed by 3 more runs of its conversation, and it is in E when it flips in at least 2 of those 3 (fail to pass included). Flaky blocks are excluded from E and from the selection.
* The selection: section selection with forward closure (`sectionSelection`), over the declared links of the suite, the tool-name links of PR 960 (the sections that name a tool the block's checks expect, among the five Acme tools), and the marks above. Advisory units are not added.
* Miss: a mutant whose E holds a block that the selection does not hold. Misses are counted per mutant.
* Result, one number: k misses of n, the Wilson 95% upper bound of k / n, and the mean selection ratio. At or below 5%: the bar is met. Above 5%: it is not met; the result is reported as it is. No second run, no change after the run. Every miss is listed with its block and section.
* Budget: 9.50 USD for this run (generator, suite runs and confirmations together); the run stops there and n is then what was measured, reported as incomplete. Measured cost of the second sample was 0.030 USD per mutant. A run lost to a provider error is run again once; both attempts stay in the raw data.
