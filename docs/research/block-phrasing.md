# Block phrasing experiments

**Research note.** This page records four pre-registered experiments on how a customer's wording changes a block's result. The agent is a fictional Acme sales agent on `claude-haiku-5-5`. All data is fictional. The scripts, pre-registrations and raw runs are in PR 415 (branch `research/block-phrasing`, head `f724d5668`).

The experiments used 10 blocks and cost 1.40 USD of a 40 USD cap. Pre-registration came before any paid call. Two amendments were made before the data they touch: gate fixes after three tiny samples, and the switch to the shared live Acme agent.

## Results

| # | Claim | Verdict | The number that decides it |
|---|---|---|---|
| H1 | The seed string overstates the block. | Falsified by the registered count | The seed beats the class in 6 of 10 blocks (threshold 7). The other 4 are ties at 0, because the seed fails all 30 runs. |
| H2 | Phrasing failures follow the 1 or 2 factor rule. | Supported on the primary oracle | "Strength 3 finds a class that strength 2 misses" happens in 2 of 10 blocks (threshold 3). 122 of 124 consistently failing realisations are 1-way. |
| H3 | The exact-match oracle, not the agent, causes most class failures. | Supported | 116 of 182 class failures pass under the normalised oracle (63.7%, cluster bootstrap 34.3% to 89.4%). A hand check found all 116 to be formattings of the gold value. |
| H4 | The gate keeps invalid realisations at or below 2%. | Falsified by the union rule | The gate caught 20 of 20 planted defects. An audit by a second labeller found 9 of 50 invalid, 18% (Wilson 9.8% to 30.8%). 8 of the 9 are the class's own town-less address form. |

In the 6 blocks where the seed passes, the gap between seed and class is +0.15 to +0.74 with the interval excluding 0. The mean gap is +0.30.

## What the experiments show

* **The oracle is the first problem.** Under an exact Then, a reworded customer message mostly fails because the agent copies the customer's formatting into a tool argument. Examples are a phone written with brackets, an email in mixed case and a street with an abbreviated type. These are false failures.
* **The normalised-slot oracle removes them.** It keeps every real failure. It passes 44 of 44 surface forms and fails 10 of 10 minimal pairs.
* **Real phrasing failures here have one factor.** Every failure tied to an axis is the slot surface form. Street types such as `Ave` and `Rd` defeat the Acme coverage tool, and the agent then offers nothing.
* **A strength-2 array alone is weak at locating a 2-way fault.** The localiser found a planted 2-way fault 50 of 50 times on strength-3 arrays, and 34 of 50 times on strength-2 arrays.
* **The class file needs its own audit.** The gate accepts what the class lists. Surface forms are a semantic decision and need sign-off, like the realisations.
* **The diversity threshold needs recalibration.** No block with a character n-gram kernel reaches `min_vendi_ratio: 0.5`. The measured ratios are 0.10 to 0.24.

## Limits

* One agent on one prompt, 10 blocks, teacher-forced prefixes from the deterministic Acme agent.
* The H4 audit used a model labeller, not a human.
* Realisations came from `gpt-6-luna` with retry feedback from the gate.
