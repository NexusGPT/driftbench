# H7 on the ledger, second sample: 300 new mutants

Lane: pointer-chain. Branch: feature/pointer-chain-h7, stacked on PR 830 (the radius on the ledger).
The commit that adds this file is the pre-registration. Nothing below was run before it, apart from one call of each model to check that its key works.

## Why

PR 830 reads the H7 study on the ledger: 2 of 90 single-section mutants have a flipped block outside the selection, Wilson upper bound 7.7%. The row "Move the radius onto the ledger" asks for at most 5%. Ruling of the lead: grow the sample; fix its size before the run; report the miss count and its Wilson upper bound once.

## Fixed before the run

* Population: 300 new single-section mutants of the Acme stand-in prompt (`examples/acme/prompts/acme-sales.md`, sha256 `cd17d54f499f5b03a829f71bd1f66639f3e602335140818a66322b442757c544`): for each of the 30 sections, 5 `negate` and 5 `rephrase` variants. `drop` is left out: it is deterministic and the 90 hold it already.
* Draw: the same generator and the same two prompts as the 90 (`research/block-links`, commit `3db52eb52`, `mutants.py`), model `gpt-6-luna`. The seeds are new: variant j (0 to 4) of a section and operator takes seed `20261020 + 100 * j`; a variant that fails the validity gate is retried with `+1`, at most 5 retries. The validity gate of the 90 applies, and a body equal to the original, to a body already drawn for the same section and operator, or to a body of the 90 counts as a failed try. Nothing is picked by hand and nothing is replaced after the first suite run.
* A variant that fails after its tries is listed and leaves the sample; the sample size n is then below 300 and is reported with the list.
* Runs: the unmutated prompt is not run again; the baseline verdicts v0 and the flaky blocks are the registered ones (`h7-selection.json`: `af1`, `d1`; the baseline runs of `research/block-links`). Same suite (19 conversations, 37 blocks, deterministic checks), same agent model `claude-haiku-5-5`, effort `low`. Each mutant runs the whole suite 3 times; a block that flips against v0 in at least 2 of 3 runs is confirmed by 3 more runs of its conversation, and it is in E when it flips in at least 2 of those 3. Flaky blocks are excluded from E and from the selection, as registered.
* The selection: the one of PR 830. A block links to every ledger unit of the sections it declared and of every global section; the change is read from the mutant text by the ledger; the selection is the radius of that change with the units as they are (advisory units not added).
* Miss: a mutant whose E holds a block that the selection does not hold. Misses are counted per mutant.
* Result, one number: k misses of n, and the Wilson 95% upper bound of k / n. Under 5%: the acceptance "misses at most 5%" is met. At 5% or above: it is not met, a unit change stays advisory, and the gap goes to the owner. The mean selection ratio is reported beside it. No second run, no change of a threshold, no change of a link after the run; a miss is listed with the block and the section link it shows missing.
* Budget: the lead's line is 50 USD; this study stops at 22 USD (generator, suite runs and confirmations together), and its cost is reported. Prices per million tokens: claude-haiku-5-5 input 0.10, output 0.50, cache write 0.125, cache read 0.01. Tiny sample first: one mutant, 3 suite runs, to time it and price it.
* A run lost to a provider error is run again once; both attempts stay in the raw data.
