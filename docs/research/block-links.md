# Block links experiments

**Research note.** This page records two pre-registered experiments on section links and blast radius. They use mutation of the prompt as ground truth on a live fictional agent. All data is fictional. The scripts, frozen mutants, pre-registrations and raw runs are in PR 421 (branch `research/block-links`, head `b3ca5490b`).

The experiments ran 9,690 conversations and cost 5.29 USD of a 40 USD cap. A 7-hour network outage interrupted stage 1. Only the missing jobs ran afterwards, and both parts are logged.

## Results

| Claim | Verdict | Key numbers |
|---|---|---|
| H7: section-level selection is safe and smaller. | Supported on the 90 registered mutants, but fragile | Safety violations on 3 of 90 mutants (3.3%, Wilson 1.1% to 9.3%). Mean selection ratio 0.199. With the 20 two-section mutants added (110), 8.2%, which falsifies the claim. |
| H5: per-root Ochiai beats flat counting. | Falsified on the real suite | Grouped counting is worse on 18 of 98 faults (18.4%, limit 10%). In simulation it is 1.5% worse, which supports H5. Without the block that fails at baseline: 2.4% worse. |

Other sensitivities for H7: 6.7% with stage 1 only, and 13.3% with flaky blocks kept.

## What the data says for the design

* **Declared links are mostly safe, but they miss two kinds of dependency.**
  * Cross-section behaviour. Negating the CONFIRM rule breaks blocks linked only to the recap.
  * Inherited failures in later blocks of the same chain.
* **Forward closure in the chain helps.** In an exploratory run it brings violations to 2.2% (90 mutants) and 3.6% (110), at a mean selection ratio of 0.23.
* **Per-root counting must keep passing children.** Dropping every child of a failing parent removes the passing rows that clear sections. A persistent baseline failure then causes ties at the top. Dropping only inherited failures gives 3.1% worse in an exploratory run.
* **Mutation works as ground truth and is cheap.** Controls stay null: 0 of 60 control variants has a confirmed effect. Negation kills 17 of 30 mutants, drop kills 7 of 30 and rephrase kills 1 of 30.
* **12 of 26 local sections had no killing mutant.** They are candidates for new blocks.
* **Re-anchoring passed its battery.** There were 0 wrong anchors, and every edited section came out stale.
* **Citation offsets need a conversion.** The Citations API counts code points in `start_char_index`. driftbench counts UTF-16 units. After two emoji the values are 23 and 25.
