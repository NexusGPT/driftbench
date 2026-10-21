# Block framework persona experiments

**Research note.** This page records three pre-registered experiments on personas in the block framework. The agent is a `claude-haiku-5-5` support agent. The blocks come from ABCD, a public set of human customer service dialogues under the MIT licence. All other data is fictional. The scripts, pre-registration and data are in PR 444 (branch `research/block-framework-persona`, head `788d6adca`).

The experiments ran 915 conversations with 0 errors and cost 7.22 USD of a 10 USD cap. One amendment, French polite words in the realiser, was made after a tiny sample and before any HF10 or HF11 data.

## Results

| # | Claim | Verdict | Key numbers |
|---|---|---|---|
| HF10 | The persona grid flags real persona effects and no fake ones. | Falsified | An A/A control, one persona against a byte copy under another id, flags 1 block. The real grid also flags 1 block. |
| HF11 | A global prompt unit routes a prompt change to the right persona cells. | Supported, at the edge | Selected cells flip in 11 of 22 (0.50). Unselected cells flip in 1 of 22 (0.045, bar 0.05). |
| HF12 | Ownership refusal catches real conflicts. | Supported | 30 of 30 planted conflicts caught with the right reason. 0 of 30 clean near misses refused. |

## HF10: the persona grid

* The 20 blocks ran under 4 persona ids with 8 trials each, 640 conversations.
* No persona effect is visible on this agent. Column pass rates are 0.56 to 0.57 for all three personas. The paired differences against the terse persona have intervals around 0.
* The one real flag is what chance predicts. The null expects 1.35 false flags in 20 blocks. A permutation test of the real flag count gives p 0.77.
* The flag rule is not safe as written. Its noise half fires whenever one persona fails once in each half and the other never fails. Both flags came from that half. The exact test raised neither.
* 9 of 20 blocks cannot flag at all, because they pass or fail all 32 of their trials.
* Keep the exact test as the flag, or give the noise rule a margin and a minimum count. Print the expected number of false flags beside the grid. With 8 trials per cell the exact test needs about 7 of 8 against 2 of 8 to fire.
* The personas themselves came through. The ordering is right on short turns, words per turn and question rate. The engine config hash matched the persona file in 640 of 640 conversations.

## HF11: routing a prompt change

* The language rule, linked as a global unit to the persona field `language`, selected exactly the French persona's cells.
* Negating the rule broke 10 of 11 French cells and 0 of 11 English cells. The language check failed in 52 of 55 trials: the agent wrote English to a French customer.
* Dropping the rule changed nothing. Without it the agent still answered the French customer in French. The selector still selects the French cells, so the link means "may matter here", not "will flip here".
* The one unselected flip is block-contract noise on a flaky block. A second flip would have falsified HF11.

## HF12: ownership refusal

* The schema was written first. A separate agent wrote the 60 fixtures from the schema alone. The loader was written from the schema alone before the fixtures were read. Both were committed together and scored once.
* Five classes, 6 planted cases each: ownership violation, slot collision, contradictory belief, persona switch in a chain and an unmet `requires` reported as `not_run` with the requirement named.
* Two independent readings of the rules agree on 60 cases, including near misses.
* The test does not show coverage of conflicts that nobody wrote down. The fixture author resolved three ambiguities that belong in the design note as explicit rules:
  * a child that omits `personas` is checked against the inherited set;
  * an absent `has_account` counts as false;
  * `requires: {}` means no requirement.

## Limits

* One agent, one simulator model, 20 blocks, 8 trials per cell.
* HF11 covers one unit, one link, two languages and 11 blocks chosen to be mostly stable. A unit linked to several fields or to a scenario field is untested.
