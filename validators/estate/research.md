# Research: validator estate

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.

## 2026-10-11, the lane that built the validator: what keeps estate specs incomplete

* Question: on an estate nobody wrote by hand, which parts of the loop leave a generated spec incomplete or wrong, once the phrase bank is complete?
* Sources: the estate tests lane handoff (235 of 1338 generated specs of the Northwind fixture complete, gaps by marker); docs/estate.md sections 4 to 8 (the contract per atom kind, generation, replay, maintenance); docs/validators.md section 6 (the seven levels); packages/generate/src/estate/then.ts (the predicate to check table and its markers).
* What others do: the Northwind count mixes two causes, phrases the bank lacks and checks the generator cannot write. A validator that writes a complete bank by construction separates them: on seeds 1 to 20 about half the specs are complete and green, and the rest wait for checks.
* What to try: a "some call matches" tools check first (the largest group on every seed), then the k distinct positive asks per route, then registered custom checks.
* Why: each item of level 4 names the one file whose change completes its specs; the largest group moves the metric most.
