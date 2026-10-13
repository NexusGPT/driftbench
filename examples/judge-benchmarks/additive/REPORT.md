# Additive blocks on LongJudge DEV

Finished 2026-10-13 before the 06:40 Europe/Brussels deadline. Branch `research/astra-additive-blocks`, parent `06c2dd86`. Worktree `.worktrees/astra-additive`. TEST remains untouched.

Only the existing cascade + M4 solver control meets the verify bar: **90/95 audited, one fix, zero breaks, zero new false rejections**. It is frozen in `freeze-dev.json`. No learned block veto qualifies. Writing reaches **117/180**, below its 122/180 bar. No writing design is frozen.

The owner's additive requirement is enforced: the frozen judge decides first; a registered rule alone can change it. Full populations are 95 verify items and 90 writing pairs, scored in both orders as 180 games. All model prompts and gates are label-blind.

## Preregistration and scope

- `4a1df605`: all override rules, routing gates, cost definitions, and bars, committed before new scoring.
- `bd9359fd`: owner changes confirmation to GPT-6-luna AND Jev. `58d750ee`: owner approves 1 USD reserved per touched item.
- `520220df`: fixes Jev confirmation at its shipped probability threshold 0.6 before any calls or scores. `35565edf`: executable replay and call driver.
- Earlier aggregate scores and the two false-rejection identities were supplied in the brief. This is a preregistered DEV follow-up, not an unseen validation.
- No thresholds, prompts, weights, or decision rules changed after scoring. Subsequent scorer edits add exact decided-by accounting and independent consistency checks.

## Verify rules

Every row except the frozen cascade includes the same M4 override, which takes precedence when its two formalisations agree. R is the existing recovered-block veto. It touches five cascade acceptances after M4. A requires a narrow failure and explicit recovery agreement on that same block, or a narrow failure on a machine-failing block. Both signals must exist; inherited recovery decisions do not count as a second signal.

B uses the cascade's exact existing uncertainty trigger on its initial comparison text. The cascade has no numerical confidence field or threshold. The owner explicitly approved its existing regex gate instead. Strict prompt-hash replay reproduces all 95 frozen decisions, and a separate implementation reproduces all 95 gate outcomes. The gate fires on three initial comparisons; only one item remains eligible for an additive veto after the cascade and M4 decisions.

C requires both GPT-6-luna and Jev to confirm that the final answer is incorrect. They see the question and complete submitted response, with no block criticism, labels, or cascade decision. GPT must return `pass=false`; Jev must give incorrect-answer probability at least 0.6. Missing or unparsed evidence preserves the cascade. Calls were made only on the five R candidates.

A uses separate procedures, but the narrow and recovery calls share a model family, and recovery sees the criticism. They are not statistically independent. C adds model-family diversity but still retains the observed correlated errors.

## Verify, full 95 DEV items

Fixes, breaks, and new false rejections below are relative to the frozen cascade, using the audited labels. The official fixes/breaks are identical in these rows. The audit supplies ten explicit overrides; other official labels remain unchanged. A false rejection means rejecting an audited-correct answer that the cascade accepted.

| Design | Official | Audited | Fixes / breaks | New false rejections | Extra known USD / 100 | Extra reserved USD / 100 |
|---|---:|---:|---:|---:|---:|---:|
| cascade | 79/95 (83.2%) | 89/95 (93.7%) | +0 / -0 | 0 | 0.0000 | 0.0000 |
| cascade+M4 | 80/95 (84.2%) | 90/95 (94.7%) | +1 / -0 | 0 | 0.0291 | 0.0000 |
| R | 81/95 (85.3%) | 91/95 (95.8%) | +4 / -2 | 2 | 0.2043 | 0.0000 |
| A | 81/95 (85.3%) | 91/95 (95.8%) | +4 / -2 | 2 | 0.2043 | 0.0000 |
| B | 79/95 (83.2%) | 89/95 (93.7%) | +1 / -1 | 1 | 0.0357 | 0.0000 |
| A&B | 79/95 (83.2%) | 89/95 (93.7%) | +1 / -1 | 1 | 0.0357 | 0.0000 |
| C | 79/95 (83.2%) | 89/95 (93.7%) | +2 / -2 | 2 | 0.2043 | 5.2632 |
| A&C | 79/95 (83.2%) | 89/95 (93.7%) | +2 / -2 | 2 | 0.2043 | 5.2632 |
| B&C | 79/95 (83.2%) | 89/95 (93.7%) | +1 / -1 | 1 | 0.0357 | 1.0526 |
| A&B&C | 79/95 (83.2%) | 89/95 (93.7%) | +1 / -1 | 1 | 0.0357 | 1.0526 |

Reserved amounts are **reserved, not measured**. There are no approved token prices for the two confirming judges. Never add a reservation to known costs and call that total measured spend. The cascade's recorded cost is 1.2974 USD per 100 items; add the known increment above for priced recipe cost. Cascade + M4 totals 1.3265 USD per 100.

The new incremental accounting runs blocks only after a cascade acceptance with no decisive M4 result: 24 items, not all 95. B first filters by the existing uncertainty gate, leaving one item. This explains why R costs 0.2043 extra per 100 here, compared with the earlier report's full-population block charge. This is an offline estimate of the routed recipe from recorded per-item costs, not a new live timing measurement. M4 contributes its recorded 0.02763515 USD for the DEV run, or 0.0291 per 100.

| Design | Block-routed items | Confirmed-family items needed | Decided by cascade | Decided by M4 | Decided by block veto |
|---|---:|---:|---:|---:|---:|
| cascade | 0 | 0 | 95 | 0 | 0 |
| cascade+M4 | 0 | 0 | 91 | 4 | 0 |
| R | 24 | 0 | 86 | 4 | 5 |
| A | 24 | 0 | 86 | 4 | 5 |
| B | 1 | 0 | 90 | 4 | 1 |
| A&B | 1 | 0 | 90 | 4 | 1 |
| C | 24 | 5 | 88 | 4 | 3 |
| A&C | 24 | 5 | 88 | 4 | 3 |
| B&C | 1 | 1 | 90 | 4 | 1 |
| A&B&C | 1 | 1 | 90 | 4 | 1 |

M4 decides four items, including three unchanged decisions and the fix `97420293`. C was researched on all five R items. A future B&C recipe needs just the one item B routes; its smaller reservation is a routed recipe estimate. Receipts are shared across ablations and are never counted as separate research spend.

| Design | Audited fixes | Audited breaks and new false rejections |
|---|---|---|
| cascade | none | none |
| cascade+M4 | 97420293 | none |
| R | aef69300, be36325b, 8a7107d6, 97420293 | 9eeb0aa3, 1bd81440 |
| A | aef69300, be36325b, 8a7107d6, 97420293 | 9eeb0aa3, 1bd81440 |
| B | 97420293 | 1bd81440 |
| A&B | 97420293 | 1bd81440 |
| C | be36325b, 97420293 | 9eeb0aa3, 1bd81440 |
| A&C | be36325b, 97420293 | 9eeb0aa3, 1bd81440 |
| B&C | 97420293 | 1bd81440 |
| A&B&C | 97420293 | 1bd81440 |

A retains all five candidate vetoes, including both false rejections. B discards the three correct vetoes and retains the false rejection `1bd81440`. Cross-family confirmation retains the correct veto `be36325b`, but also both false rejections. It loses the other two correct vetoes. No learned veto clears the zero-new-false-rejection bar.

## Cross-family calls and budget

All ten calls returned HTTP 200 through their primary routes. Jev needed no TypeSafe fallback. Maximum observed concurrency was six. Last call started at 06:13:37 and all calls finished by 06:13:43 local, before the 06:35 cutoff. The research reservation is **5 USD, reserved, not measured**, within the 10 USD cap. No new Haiku or writing calls were made.

| Item | Audited truth | GPT says incorrect | Jev probability incorrect | Joint veto | GPT input / output tokens | Jev input / output tokens | Reservation USD |
|---|---|---|---:|---|---:|---:|---:|
| 1bd81440 | correct | True | 0.76 | True | 2087 / 553 | 2459 / 21 | 1.00 reserved |
| 8a7107d6 | incorrect | True | 0.54 | False | 1250 / 324 | 1686 / 21 | 1.00 reserved |
| 9eeb0aa3 | correct | True | 0.83 | True | 1142 / 207 | 1415 / 21 | 1.00 reserved |
| aef69300 | incorrect | False | 0.45 | False | 1527 / 392 | 2086 / 21 | 1.00 reserved |
| be36325b | incorrect | True | 0.70 | True | 12555 / 394 | 14011 / 21 | 1.00 reserved |

Totals: GPT-6-luna 18,561 input and 1,870 output tokens; Jev 21,657 input and 105 output tokens. Output totals include the provider's completion counts, including reported reasoning tokens. Raw usage fields are preserved per call. USD measurement remains unavailable; the spend ledger records the reservation explicitly.

The two retained false rejections are explanatory: on `9eeb0aa3`, GPT demands a translation description instead of accepting the submitted function; on `1bd81440`, it derives "unknown" for the rule game. The geometric inconsistency in `be36325b` is confirmed by both. On `aef69300`, GPT accepts a sales calculation involving fractional gerbils. Jev remains below 0.6 on both `aef69300` and the sign error `8a7107d6`. These are observed failures against the fixed labels, not a reason to change those labels or tune the threshold.

## Writing, full 90 DEV pairs and 180 games

D routes the four pairs whose holistic order ballots disagree: 4.4% of pairs, eight games. Low confidence at most 2 of 5 occurs on 19 pairs. Their union U routes 22 pairs: 24.4%, 44 games, with one overlapping pair. Outside the declared subset, every holistic ballot remains unchanged.

Per-order uses the existing weighted block outcome in each order; ties keep that order's holistic ballot. Consensus overrides only when the two recorded block-stage outcomes agree. Those recorded outcomes include their original holistic tie fallback; consensus is therefore not a claim of two independent raw block votes. Machine uses only the existing machine result. No machine-decisive pair lies in U.

| Design | Official games | Audited games | Routed pairs / games | Subset baseline to design | Fixes / breaks | Net games | Extra USD / 100 pairs |
|---|---:|---|---:|---:|---:|---:|---:|
| holistic | 116/180 (64.44%) | unavailable | 0 / 0 | 0 to 0 | +0 / -0 | +0 | 0.0000 |
| D/order | 117/180 (65.00%) | unavailable | 4 / 8 | 4 to 5 | +1 / -0 | +1 | 0.0439 |
| D/consensus | 117/180 (65.00%) | unavailable | 4 / 8 | 4 to 5 | +1 / -0 | +1 | 0.0439 |
| U/order | 110/180 (61.11%) | unavailable | 22 / 44 | 30 to 24 | +4 / -10 | -6 | 0.2306 |
| U/consensus | 113/180 (62.78%) | unavailable | 22 / 44 | 30 to 27 | +3 / -6 | -3 | 0.2306 |
| U/machine | 116/180 (64.44%) | unavailable | 22 / 44 | 30 to 30 | +0 / -0 | +0 | 0.0285 |

Writing audited accuracy is unavailable because its supplied audit has no corrected label map. It reviews 26 pairs: 19 defensible, four suspect, three ambiguous. Suspect preferences are not silently inverted. New false rejections are not applicable to pairwise preference; fixes and breaks identify changed correct/incorrect games instead. The frozen holistic cost is 0.5718 USD per 100 pairs; D/order totals 0.6157, U/order 0.8024, and U/machine 0.6003.

| Design | Decided-by counts, games | English | Chinese |
|---|---|---:|---:|
| holistic | holistic:not-routed: 180 | 41/82 | 75/98 |
| D/order | holistic:not-routed: 172; holistic:block-tie-fallback: 2; blocks:per-order: 6 | 41/82 | 76/98 |
| D/consensus | holistic:not-routed: 172; holistic:block-order-disagreement: 6; blocks:consensus: 2 | 41/82 | 76/98 |
| U/order | holistic:not-routed: 136; blocks:per-order: 40; holistic:block-tie-fallback: 4 | 34/82 | 76/98 |
| U/consensus | holistic:not-routed: 136; holistic:block-order-disagreement: 16; blocks:consensus: 27; holistic:block-tie-fallback: 1 | 35/82 | 78/98 |
| U/machine | holistic:not-routed: 136; holistic:machine-abstain: 44 | 41/82 | 75/98 |

The disagreement-only gain is one Chinese game, `72a21229cabe1b724eb7:0`, with no breaks. The other three split pairs yield no net gain. The low-confidence expansion loses English games. The best 117/180 is five games below the bar and is not frozen.

Writing change addresses use `rowKey:order`, where 0 is AB and 1 is BA:

- holistic: fixes none; breaks none.
- D/order: fixes 72a21229cabe1b724eb7:0; breaks none.
- D/consensus: fixes 72a21229cabe1b724eb7:0; breaks none.
- U/order: fixes bd7906ddff73678a8091:0, bd7906ddff73678a8091:1, 72a21229cabe1b724eb7:0, 88f369d25b7b0f3e7253:1; breaks 2dc32b654e3a031a8105:1, 560bbd798a3065442e11:0, 74f4748a7a00ddf8ce2d:0, 74f4748a7a00ddf8ce2d:1, 4447da53d93227981c9e:0, 4447da53d93227981c9e:1, 44cf027ab5e997d7282f:0, 44cf027ab5e997d7282f:1, 61dcf707deafa5ebf140:1, e2ed52cc2fc11895657b:1.
- U/consensus: fixes bd7906ddff73678a8091:0, bd7906ddff73678a8091:1, 72a21229cabe1b724eb7:0; breaks 74f4748a7a00ddf8ce2d:0, 74f4748a7a00ddf8ce2d:1, 4447da53d93227981c9e:0, 4447da53d93227981c9e:1, 44cf027ab5e997d7282f:0, 44cf027ab5e997d7282f:1.
- U/machine: fixes none; breaks none.

## Evidence, validation, and freeze

All paths below are relative to `examples/judge-benchmarks/additive/` in the owned worktree.

- `scores-dev.json`: all full-population decisions, scores, addresses, groups, routing, costs, and bar outcomes. `preregistration.md`: exact rules and owner amendments.
- `cascade-gates-dev.json`: exact frozen replay with each initial answer and gate. `recordings/`: DEV-filtered frozen cassettes. `source-hashes.json`: copied input hashes.
- `cross-family-receipts.jsonl` and `cross-family-dev.json`: every provider response, usage, route, timing, and parsed decision. No credentials are stored.
- `validate.py` and `validation-dev.json`: independent recounts, all 95 gate reconstructions, unchanged out-of-subset ballots, valid DEV membership, ten-call scope, concurrency, and cutoff checks. All pass.
- `freeze-dev.json`: freezes only cascade + M4 against the stated 90/95 and zero-new-false-rejection bar. TEST authorization is false; Cue decides any later TEST action.

Reproduce scores and validation offline, from the worktree root:

```sh
python3 examples/judge-benchmarks/additive/score.py 2>&1
python3 examples/judge-benchmarks/additive/validate.py 2>&1
```

`replay-cascade.ts` performs the deeper runtime replay using the read-only sibling codex-verify source plus the committed DEV-only cassettes. `validate.py` independently checks the saved gate texts without that sibling. `cross-family.py` preserves receipts and reuses them on rerun; no rerun is needed.

This report meets the requested full-DEV comparison. It does not establish unseen generalization or a new learned-block improvement. The passing control is the already-known symbolic solver addition.
