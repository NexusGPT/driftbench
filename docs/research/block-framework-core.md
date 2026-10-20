# Block framework core experiments

**Research note.** This page records four pre-registered experiments on a prototype of the block framework core: objects with items, layers and a resolve pass. No model was called, so every count is exact on the full population. All data is fictional. The scripts, pre-registration and data are in PR 437 (branch `research/block-framework`, head `808b0a9f1`).

## Results

| # | Claim | Verdict | The number that decides it |
|---|---|---|---|
| HF1 | Backward compatibility. | Supported | 0 of 2,351 example specs change hash. 0 of 4,453 block cache keys change. |
| HF2 | Default parity. | Supported | 0 changed verdicts over 259 stored runs (1,223 gating verdicts re-scored). |
| HF3 | Override precision and stamps. | Falsified | 36 untargeted verdict changes, all on the non-gating `tools.argument_accuracy`. 0 verdicts without a `by` stamp. 0 of 8 overrides of an unknown item accepted. |
| HF4 | Re-judge without the agent. | Supported | 0 adapter calls to re-score 259 runs after a scoring-only change in the project file. |

## HF1: backward compatibility

* The population is the 2,448 files under `examples/` that the loader considers. Main loads 2,351. The prototype loads the same 2,351. Both refuse the other 97.
* The comparison can fail. With a new `uses` key added, all 2,351 hashes differ and main refuses all 2,351. A mutant where `uses` defaults to an empty object changes all 2,351 hashes.
* It holds because every new key is optional with no default. An absent key never reaches the canonical JSON. A schema default would break it.

## HF2: default parity

* Two shipped default objects, a check set of 5 items and a value-check policy, re-score the 259 stored runs.
* Changed verdicts: 0. Re-scored passes: 77, equal to the stored 77.
* The item code calls the same helpers as main, so the comparison agrees by construction. The test proves the rest of the path: the resolver builds the defaults, the check order runs, input assertions route to the value-check rung and the disabled rungs stay out.

## HF3: override precision

* Seven single-item overrides changed 838 verdicts that they target.
* One override, case-insensitive compare on the value-check rung, also changed 36 verdicts of `tools.argument_accuracy`. That verdict is stamped by the check-set item that computes it, not by the rung. The pre-registration predicted this.
* The design gap is that `Verdict.by` names one item. An item cannot name a verdict that is computed from other verdicts.
* Two ways to close it:
  * add `by.reads` on aggregate verdicts, and state precision as "changes only verdicts whose `by.item` is that item, or whose `by.reads` names it";
  * or move such aggregates to a diagnostic, which never changes `pass`.
* Every refusal of an unknown item names the unknown id and the parent's full item list.

## HF4: re-judge without the agent

| Change | Adapter calls | Runs re-scored from storage |
|---|---|---|
| Scoring-only change in the project layer | 0 | 259 of 259 |
| Agent-facing model change (control) | 777 | 0 |
| Same scoring change as `uses` on the spec, with today's cache key | 777 | 0 |
| Same, with the cache key leaving `uses` out | 0 | 259 |

* At the project layer the result holds by construction, since a project object never enters the spec.
* A scoring-only change written as `uses` on a spec changes the content hash that the cache key uses. All runs would rerun.
* The framework must leave `uses`, and any other scoring-only key, out of the cache key, as `version` is left out today. The re-judge compatibility hash was not tested and may need the same rule.
