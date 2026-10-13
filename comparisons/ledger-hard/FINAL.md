# Ledger hard-row dossier

Haiku and Luna complete; Gemini 262 requests not run: daily quota. Recording analysis generated 2026-10-13T12:03:30.442917+00:00. All case and result counts come from the linked files in `comparisons/ledger-hard/`.

- Haiku and Luna have full coverage in both experiments: 384 cases per row. Gemini has 262 requests not run: daily quota. Its unfinished cells carry no final verdict.
- 6560 primary and 9578 dialect unique recorded requests, including the goal equal-evidence ablation.
- Measured spend: USD 8.99764030. Lost-attempt reserve: USD 0.40. Combined: USD 9.39764030, within the owner-amended USD 12 cap.
- The construction audit passes. No pool is withdrawn. This is synthetic evidence on the original construction families.
- Primary and dialect results remain separate. The dialect run uses the same cases and is not an independent replication.

## Interpretation and coverage

The pooled default comparison includes a goal row where the candidate receives final state and the default peer does not. The pooled equal-evidence comparison supplies final state to both. It is the appropriate evidence-matched comparison. Per-row exact tests are nominal; family bootstrap intervals show construction-family uncertainty. A non-significant result does not establish equivalence. The global 18-cell Holm decision belongs to the collator.

Haiku has a nominal pooled equal-evidence lead in both experiments, with family bootstrap difference intervals above zero. Luna has no significant pooled equal-evidence lead at provider default; its primary rubric row has a nominal loss. The medium dialect has a nominal Luna pooled lead, but its family bootstrap interval includes zero. These results do not establish superiority on every hard row. The exact counts and uncertainty intervals follow.

| Experiment | Model | Cases in each row | Pooled default W/L | Pooled equal-evidence W/L | Equal-evidence exact two-sided p | Status |
|---|---|---:|---:|---:|---:|---|
| Primary | gpt-6-luna | 384/384 | 222/13 | 25/13 | 0.072951389 | TIE (not equivalence) |
| Primary | haiku | 384/384 | 230/9 | 71/11 | 6.813783e-12 | nominal lead |
| Dialect | gemini-3.8-flash | Incomplete | Pending | Pending | Pending | 262 requests not run: daily quota; no final verdict |
| Dialect | gpt-6-luna | 384/384 | 218/7 | 19/7 | 0.028959274 | nominal lead |
| Dialect | haiku | 384/384 | 236/2 | 82/2 | 3.6923275e-22 | nominal lead |

## Construction-cue audit

`audit-construction.py` reads only source, seeds, sealed cases and rendered prompts. `construction-cue-audit.json` SHA-256 is `e3fa7df6ce99c0596072bd808c4e37f5e0917728a6dc687ed65bb44dc5cd7026`. It checks all 3456 primary and 10368 dialect rendered inputs. No model outcomes inform this audit.

| Row | Cases | Trusted contexts paired across labels | Imbalanced trusted token values | Imbalanced identity suffix values |
|---|---:|---:|---:|---:|
| rubric | 384 | 192 | 0 | 0 |
| factuality | 384 | 192 | 0 | 0 |
| pii | 384 | 192 | 0 | 0 |
| goal | 384 | 192 | 0 | 0 |

Entity identifiers are assigned once per pair, before the true/false loop. Every trusted context appears once per label. Identity values, parity and last digits are balanced. Complete token contingency tables are retained, including semantic answer differences that correlate with truth. Case id, generation, family and truth metadata are excluded from model inputs. The audit rules out these construction cues; it does not establish absence of every semantic shortcut.

## Crash recovery and concurrency

The plugin crash left 12 primary and 8 dialect calls without recorded answers. The owner authorized one re-ask of each key below. 20 keys now have exactly one final recorded answer and are counted once. The lost attempts retain USD 0.40 reserve. Sources: `crash-recovery.json`, `recovery-amendment.json`, both `starts.jsonl` files and both `recovery-attempts.jsonl` files.

| Experiment | Model | Case | Side | Crash-lost key | Recovery status |
|---|---|---|---|---|---|
| primary | gpt-6-luna | ledger-hard-factuality-g1-112 | audit | `438891e62de0816e44e06852f49aa8fd55883ec0b9e0f56149b61fcfba4a8b58` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-pii-g1-112 | audit | `ff8278c3970d750439ce77c9deab64e05c942d6af3fdc748bbfbfa45fded04b3` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-pii-g1-112 | audit | `81c6bd280b0f428bf36192e31135e81c478d42458044c898f360035da5da0693` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-pii-g1-112 | peer | `2dba0ad036d7163a79a08c6b32f4b4d77c35a386d0b017ae9f402ba13e904f1e` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-pii-g1-112 | peer | `aa13f4e629e4448c465e7921fe86b7489d9a429c920873a31fc29cf06ddaa99f` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-goal-g1-112 | audit | `62abfcf0dd651cf4c120d186cee8a289f8c440c389aecc68fcc8ee6038073f08` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-goal-g1-112 | audit | `75054921e18feb825857c4dea247117ff1999f60b046ac8650984a98ef873e25` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-goal-g1-112 | peer | `a3645f888564e96f00e53dfec26037a923a8b50851da47f6c848c5019d4fd5e6` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-goal-g1-112 | peer | `ac7ce0533b2f052c0c155ef390f41c57333b3459c22eb31f64978085bfe1de93` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-goal-g1-112 | peer-full-state | `c6431106dafa9f862565cc535f35887238b39c95449017c76954bc0964389297` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-goal-g1-112 | peer-full-state | `c53d5d1fad72de2dd1bb38f0602b24ad612fdd1062cddeb9c520c7afaf921104` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-rubric-g1-113 | audit | `c02dc147ca5809e7d16346883fa26d56889a29093df65e83891cc04bf4b8930e` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-014 | peer-full-state | `37f631f4ad747b19dcbe42f8e4f3ae06236afbb525ed534561878488bc18f085` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-015 | audit | `5dc4c36604adbc654d484e2ff1c053c23283b05829d1b7f028a167eff08df3b3` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-015 | peer | `cb346872a3a35a21bc33ffef789822982e53b3a75f565d6cf4a63d21d335d376` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-015 | peer-full-state | `1dc46d5f271a5c72f1b76bee16db75c2414c40de984874d50ef2c7bf785bb52f` | Re-asked once after crash; one recorded answer |
| dialect | gemini-3.8-flash | ledger-hard-goal-g1-015 | audit | `88fceb4b04f16b79f0e4eb8603903c5c781c646d036ba0428ac58929b75407a9` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-016 | audit | `1ca775b8e7c8d91d767399d8520b63c67d86a4ec8193a60d9c6660aa3b2e8c34` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-016 | peer | `0eb042fc91a35341bf1859b8ef29a3a3516fe109ecc1d44e87318c3aa8e0292f` | Re-asked once after crash; one recorded answer |
| dialect | gemini-3.8-flash | ledger-hard-goal-g1-015 | peer | `a0891e0f464fb6828464d1a10fe960da10dbc0a83ca307c52a939f87f357fc8f` | Re-asked once after crash; one recorded answer |

Existing HTTP calls drain before runtime amendments. The later daily-quota instruction explicitly abandons two workers during backoff, after their HTTP responses return. The combined four-call cap and adaptive Luna four/two pacing applied until the later pacing boundary. `pacing-amendment.json` then replaces those concurrency limits with shared per-model limits across both experiments: gpt-6-luna eight, Gemini two, Haiku two. Luna uses plain HTTP. Independent rotating queues preserve each sealed request order and keep all three models running side by side. Sources, cap and answer contracts remain unchanged.

HTTP 429 receives waits of 60, 120 and 240 seconds. Exhausted quota retries remain pending and unscored, never judge failures. Other unanswered transport failures use at most three attempts with 10/30-second waits. Every transport failure and backoff remains recorded; content is never retried. `quota-amendment.json` retains this retry policy under the later per-model pacing amendment. Unanswered attempts have no reported usage; measured cost excludes unreported charges.

Gemini prepaid credit depletion produces HTTP 402. The 532 empty rejections before the billing hold are preserved byte-for-byte in `dialect/billing-rejections.jsonl` and in the attempt journal. They carry no answer or reported usage, release only their proven-rejection holds, and never enter judge scores. No 402 receives an automatic retry. `billing-amendment.json` records the stop and the requirement for explicit owner top-up confirmation before missing-only resumption. The USD 0.40 crash reserve remains.

The owner subsequently confirms a Gemini top-up. `gemini-topup.json` names one missing request as the probe. It returns an answer, recorded once in the normal journal; `gemini-probe-result.json` records its cost and the hold release. Only requests without recorded answers resume, at two Gemini calls. The 429 waits and 402 circuit break remain active.

The owner raises the cap from USD 10 to USD 12 solely to finish the same sealed requests. `budget-amendment.json` records this runtime authorization. The case pool, request order, prompts, reasoning settings, answer contracts and statistics remain unchanged. The USD 0.40 lost-attempt reserve stays in the budget.

Primary Luna keeps provider-default reasoning for both contestants and omits temperature. The API does not report which reasoning setting that default resolves to. Dialect Luna and Gemini use medium for both contestants. Haiku exposes no reasoning control in this harness.

## Daily quota runtime amendment

Gemini reaches the shared 10,000-request daily limit on 13 October. The owner stops all further Gemini calls that day. Two requests each receive three HTTP 429 rejections and enter the 240-second backoff. The owned driver is stopped while both are in backoff, with zero HTTP calls in flight. Their six no-answer attempts remain in the journal, never scored. `dialect/quota-pending.jsonl` preserves both keys as eligible missing requests.

The partial publication marks Gemini as "262 requests not run: daily quota". Of these, 260 are queued without a new attempt and two have quota-only rejections without an answer. This wording denotes missing scored answers. The previously recorded Gemini answers remain included once in descriptive partial tables; no incomplete pooled verdict is claimed.

The Gemini missing-only cutoff extends to 2026-10-14 12:00 UTC. A later owner instruction supersedes reset-based resumption: Gemini resumes only on explicit owner word. The daily reset does not authorize calls. The USD 12 cap, USD 0.40 reserve, two-call Gemini limit, sealed order and answer contracts remain fixed. `daily-quota-amendment.json` records this authorization and the affected keys.

Quota allocation: exactly 262 unique Gemini requests remain: 110 candidate goal requests, 40 default peer goal requests, and 112 equal-evidence peer goal requests. The two abandoned no-answer requests are included in 262. All 20 crash re-asks are already recorded. There are zero planned additional content re-asks. Future no-answer transport failures may require extra attempts; these cannot be fixed in advance. `owner-hold-amendment.json` records this census and the owner-only hold.

## Native parity and verification

`verification-final.json` records coverage by model, unique scored keys, disjoint experiment keys, exact goal labels, original payload non-overlap, immutable source hashes, registered crash re-asks, resolved model IDs and the budget. `peer-decoder-parity.mts` replays every recorded successful peer answer through the pinned native verdict functions, including the native YAML fallback. `trajectory-parity.mts` checks all 384 goal summaries against the pinned helper.

| Experiment | Unique calls | Native peer answers checked | Final unsuccessful calls | Unscored billing rejections | Measured USD |
|---|---:|---:|---:|---:|---:|
| primary | 6560/6560 | 3488 | 0 | 0 | 1.83894069 |
| dialect | 9578/9840 | 5080 | 0 | 532 | 7.15869961 |

Focused protocol/recovery tests pass; `test-output.txt` retains the test result. Every raw response and usage record remains in the journals. Haiku cache creation and cache reads are separate from ordinary input tokens in `verification-final.json`; CLI-reported cost is authoritative. The peer native YAML dependency is the pinned js-yaml 5.4.2 bundle, with npm integrity and upstream provenance under `native-validation/`. No node_modules directory is copied.

## Freeze hashes

| Artifact | SHA-256 |
|---|---|
| `seal.json` | `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4` |
| `accounting-amendment.json` | `78c421dcc4f879f9baedb638dc4069ec63552513c0a7165e23fe442f0bdf8789` |
| `transport-amendment.json` | `3a7cfc6acd2793bdc24b9cd465176af99a65307dc8c8d980f0e05f4b666a3b48` |
| `dialect/seal.json` | `ebbc5876d5a9d482203382d33c7fa3c0ee640b6e1254bf821784004493cd85d9` |
| `recovery-amendment.json` | `19edca959d34feb34bd278ab86933578a39adb7cf59d2ea80e74c55603d1d567` |
| `concurrency-amendment.json` | `ddded416295abc477c4513e265686f850074d1903aec26614ecd2ee1afc4f699` |
| `quota-amendment.json` | `626fff9cb3b33387f9971f9ae8dc892c9df8f931b119ff9ffab8d8b45530291a` |
| `pacing-amendment.json` | `f2934ef948c4a1c6cd7d2231a879ea2fd7c792e12c5064f2671be9e6f241c8e4` |
| `billing-amendment.json` | `dbf4921ae5340fe1231e750141f1cd748857d71d6633e314a90c9348664fc94f` |
| `gemini-topup.json` | `52d9eb92d4d3d91f7bc753c1f33a5181f95e4ea0b24cc223d202648671490f83` |
| `topup-runtime-amendment.json` | `f98aaa1dca7a2a78a261053a7c844acbcf166451668399411763e0867b1efc50` |
| `gemini-probe-result.json` | `3ee1edc838607e69e304755ae9551b586669c0dd6c3ebba39c53a1e8e30e9391` |
| `budget-amendment.json` | `721f7a1b0871220ee61ef506a7b422d1e64cf1e60cb6de334d0908180b7128c4` |
| `daily-quota-amendment.json` | `67f64ff18c53e3527652ee7aadbcfaa35b83bedbc060fdd13baced18a49f4de6` |
| `owner-hold-amendment.json` | `1a5e4ef20548794adb0572ccb8a425953dea2f3aa89004d10ae9c0412532cfe4` |
| `crash-recovery.json` | `7a033003ca9a0813b34d752ed9360a8d8502274ea502f962aa05e8ac59178308` |
| `seeds.json` | `8aa6b101d2feaf60c27f36ee7521ff7e53d3c5c247817b29e98902d6ed6dc40d` |
| `prompts.json` | `9d8bfad218065453b74a13d3841164c9a3cdb454165ca703c76bde93c3bdae4c` |
| `dialect/prompts.json` | `2fe5c23508da1f5ee542d9c6ceb10313a96336e64f45182df74ae3d72a756bef` |
| `score.py` | `f5f91044dcb166d04b8bff098e8cc31d7431fae30a3983894e7dc1617c4a6831` |
| `dialect-score.py` | `98092ff0d7d5876a829eaaa08af5eca68d078afda5926bfdbeadb0c0aa31e917` |
| `verification-final.json` | `b3a45b0e5360fdd01988e5ffffce7b7fdb3393b2a90a4b3fec2ca45fbfe54d51` |

Candidate procedure: `d7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587`. Original seal commit: `eeb7875e`. Core dialect source: `2bb0a7a787ca4466ff69d204f2380a7ad19cc056`; dialect seal commit: `a7954b1b`. The per-file source hash maps remain inside the seals and operational amendments.

## Original primary tables

# Promptfoo hard rows: fresh sealed cohort

Generated 2026-10-13T11:20:31.272301+00:00. All results below derive from `comparisons/ledger-hard/scores.json`, `decisions.json` and `calls.jsonl` on `research/ledger-hard`.

Frozen criterion-ledger candidate, not a shipped-default claim. Synthetic cases retain the original construction families. Gemini was not run in this original two-model primary experiment. The separately frozen dialect variant below includes all three models.

## Sealed cases

| Row | Seeds | Cases | Pass/fail | Prior payload overlap | File SHA-256 |
|---|---|---:|---|---:|---|
| rubric | [61155780, 75192967] | 384 | 192/192 | 0 | `40db40f57eb9637567837eb4892621eb8938340d912fef6d6824588d54dbc534` |
| factuality | [37514137, 59241593] | 384 | 192/192 | 0 | `a911d58077aeabc9d57b49432c45fa766a4fb06406a484ac0f73b46e33cbc097` |
| pii | [75489315, 32827230] | 384 | 192/192 | 0 | `26bd69f53020c97f0dd9dc88f9c877d87b288cf925ee47d0510acab02bb718f1` |
| goal | [41332820, 84695301] | 384 | 192/192 | 0 | `f9053a77f34e175a3e7113a9749840f8d0652a2cebcb46d1f78d8fdd397d8a2a` |

Prior census: 317 historical/worktree sources, 1204 distinct earlier full payloads. `prior-census.json` carries every source and digest. Full payload means the exact criterion-ledger request, including final state for goal. The default trajectory peer intentionally shares requests between state-distinct cases.

The generator runs two generations of 192 per row. Every row has 12 families, 32 cases per family, with 16 passing and 16 failing. Phone area bindings differ across the two generations, retaining reserved 555-01xx numbers. Labels, prompts and analysis are sealed before the first call.

## Per-row and pooled exact comparisons

| Model | Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| haiku | rubric / peer | 384/384 | 373 | 370 | 7 | 4 | 281/512 = 0.54882812 | 281/1024 = 0.27441406 | TIE (not equivalence) |
| haiku | factuality / peer | 384/384 | 384 | 352 | 32 | 0 | 1/2147483648 = 4.6566129e-10 | 1/4294967296 = 2.3283064e-10 | nominal lead |
| haiku | pii / peer | 384/384 | 378 | 381 | 2 | 5 | 29/64 = 0.453125 | 15/16 = 0.9375 | TIE (not equivalence) |
| haiku | goal / peer | 384/384 | 381 | 192 | 189 | 0 | 1/392318858461667547739736838950479151006397215279002157056 = 2.5489471e-57 | 1/784637716923335095479473677900958302012794430558004314112 = 1.2744735e-57 | nominal lead |
| haiku | goal / peer-full-state | 384/384 | 381 | 353 | 30 | 2 | 529/2147483648 = 2.4633482e-07 | 529/4294967296 = 1.2316741e-07 | nominal lead |
| haiku | pooled-default / mixed | 1536/1536 | 1516 | 1295 | 230 | 9 | 391443940536313/27606985387162255149739023449108101809804435888681546220650096895197184 = 1.4179163e-56 | 391443940536313/55213970774324510299478046898216203619608871777363092441300193790394368 = 7.0895814e-57 | nominal lead |
| haiku | pooled-equal-evidence / mixed | 1536/1536 | 1516 | 1456 | 71 | 11 | 4118679106637/604462909807314587353088 = 6.813783e-12 | 4118679106637/1208925819614629174706176 = 3.4068915e-12 | nominal lead |
| gpt-6-luna | rubric / peer | 384/384 | 370 | 379 | 4 | 13 | 1607/32768 = 0.049041748 | 65119/65536 = 0.99363708 | LOSS |
| gpt-6-luna | factuality / peer | 384/384 | 384 | 383 | 1 | 0 | 1 = 1 | 1/2 = 0.5 | TIE (not equivalence) |
| gpt-6-luna | pii / peer | 384/384 | 384 | 369 | 15 | 0 | 1/16384 = 6.1035156e-05 | 1/32768 = 3.0517578e-05 | nominal lead |
| gpt-6-luna | goal / peer | 384/384 | 384 | 182 | 202 | 0 | 1/3213876088517980551083924184682325205044405987565585670602752 = 3.1115076e-61 | 1/6427752177035961102167848369364650410088811975131171341205504 = 1.5557538e-61 | nominal lead |
| gpt-6-luna | goal / peer-full-state | 384/384 | 384 | 379 | 5 | 0 | 1/16 = 0.0625 | 1/32 = 0.03125 | TIE (not equivalence) |
| gpt-6-luna | pooled-default / mixed | 1536/1536 | 1522 | 1313 | 222 | 13 | 12664829932210496241/431359146674410236714672241392314090778194310760649159697657763987456 = 2.9360291e-50 | 12664829932210496241/862718293348820473429344482784628181556388621521298319395315527974912 = 1.4680145e-50 | nominal lead |
| gpt-6-luna | pooled-equal-evidence / mixed | 1536/1536 | 1522 | 1510 | 25 | 13 | 2506590623/34359738368 = 0.072951389 | 2506590623/68719476736 = 0.036475694 | TIE (not equivalence) |
| gemini-3.8-flash | Original primary | Not run | | | | | | | See the three-model dialect variant |

## Uncertainty and usage

| Model | Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |
|---|---|---|---|---|---|---|
| haiku | rubric/peer | [94.944%, 98.393%] | [93.974%, 97.816%] | [-2.344%, 5.208%] | 11/0 | 0.042626/0.030860 |
| haiku | factuality/peer | [99.010%, 100.000%] | [88.473%, 94.035%] | [0.000%, 19.531%] | 0/0 | 0.044178/0.035662 |
| haiku | pii/peer | [96.634%, 99.282%] | [97.729%, 99.734%] | [-3.906%, 1.562%] | 0/0 | 0.045940/0.035804 |
| haiku | goal/peer | [97.729%, 99.734%] | [45.024%, 54.976%] | [47.917%, 50.000%] | 0/0 | 0.050216/0.025509 |
| haiku | goal/peer-full-state | [97.729%, 99.734%] | [88.769%, 94.255%] | [-0.781%, 19.010%] | 0/0 | 0.050216/0.048895 |
| haiku | pooled-default/mixed | [97.997%, 99.156%] | [82.406%, 86.043%] | [11.979%, 17.318%] | 11/0 | see row costs |
| haiku | pooled-equal-evidence/mixed | [97.997%, 99.156%] | [93.565%, 95.795%] | [0.521%, 7.878%] | 11/0 | see row costs |
| gpt-6-luna | rubric/peer | [93.974%, 97.816%] | [96.989%, 99.443%] | [-7.031%, 1.302%] | 7/0 | 0.015106/0.007450 |
| gpt-6-luna | factuality/peer | [99.010%, 100.000%] | [98.540%, 99.954%] | [0.000%, 0.781%] | 0/1 | 0.014930/0.010429 |
| gpt-6-luna | pii/peer | [99.010%, 100.000%] | [93.656%, 97.619%] | [0.000%, 11.719%] | 0/0 | 0.019674/0.007636 |
| gpt-6-luna | goal/peer | [99.010%, 100.000%] | [42.452%, 52.391%] | [50.000%, 57.812%] | 0/0 | 0.016614/0.015814 |
| gpt-6-luna | goal/peer-full-state | [99.010%, 100.000%] | [96.989%, 99.443%] | [0.000%, 3.646%] | 0/0 | 0.016614/0.011548 |
| gpt-6-luna | pooled-default/mixed | [98.476%, 99.456%] | [83.631%, 87.155%] | [11.458%, 16.276%] | 7/1 | see row costs |
| gpt-6-luna | pooled-equal-evidence/mixed | [98.476%, 99.456%] | [97.531%, 98.842%] | [-1.107%, 3.190%] | 7/1 | see row costs |

## Method and limits

- Exact one-sided p = sum(C(W+L,k), k=W..W+L) / 2^(W+L). Two-sided McNemar doubles the smaller binomial tail, capped at one. Zero discordance gives one.
- Case-level tests are nominal. Families are dependent. Bootstrap draws all paired cases within sampled families, 20,000 draws, seed 2619092984. Pool bootstrap is stratified by row.
- The pooled conditional sign test conditions on discordance in each row and sums wins. Under the null, its distribution is Binomial(total discordance, 0.5). Exact rational p-values are retained.
- Pooled-default includes the information-asymmetric goal comparison. Pooled-equal-evidence replaces that goal row with the final-state ablation. Neither pool counts goal twice.
- Global Holm correction across 18 benchmark/model cells belongs to the final collator. `holm18_missing_as_one` is a conservative interim correction for pooled-default only. Per-row leads are nominal.
- Constant-pass and constant-fail cheaters each score 192/384 by planted balance. Repeated-read noise floor and perturbation validity are not measured in this sealed primary run; no stability claim is made.
- Original frozen prompts and decoding are unchanged. The goal peer uses pinned trajectory summary; its ablation adds the persisted final state without editing the pinned prompt.
- gpt-6-luna uses provider-default reasoning and no temperature field for both sides. Tokens are recorded per call. Owner-verified pricing on 2026-10-13: USD 0.10 input, 0.01 cached input, 0.50 output per million tokens. Source: https://developers.openai.com/api/docs/models/gpt-6-luna. Accounting amendment is separate from the original seal.
- The pilot is a transport and cost check on the first 20 sealed cases per row, retained once in final results. No labels or outcomes select continuation or change the procedure. No content retries. Unanswered transport retries follow the operational amendments above. All failed attempts remain recorded.

## Freeze and spend

- Candidate procedure: `d7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587`.
- Seal SHA-256: `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4`. The seal holds every frozen source, case and prompt hash.
- Analysis source commit: `f06456a442877987a595216f94a575bef290d654`.
- 6560 unique completed attempts; 0 final unsuccessful responses; measured spend USD 1.83894069 of the amended USD 12 cap.
- 3280 gpt-6-luna calls use recorded usage and the corrected provider prices. Earlier raw records remain unchanged; current totals reprice those records.
- Resolved models: ['claude-haiku-5-5', 'gpt-6-luna'].
- Artifacts: `comparisons/ledger-hard/{seal,seeds,prior-census,prompts,scores,decisions}.json`, row case JSON, `starts.jsonl`, `calls.jsonl`, and the source scripts.


## Dialect tables

# Separate core-dialect variant

Generated 2026-10-13T11:20:33.488019+00:00. Source: `comparisons/ledger-hard/dialect/scores.json`, `decisions.json`, `attempts.jsonl` and `calls.jsonl`.

Core `2bb0a7a787ca4466ff69d204f2380a7ad19cc056`; variant seal SHA-256 `ebbc5876d5a9d482203382d33c7fa3c0ee640b6e1254bf821784004493cd85d9`. This is the same sealed case cohort under a separately frozen transport and reasoning setting, not new data. No primary request key or answer is reused.

Luna and Gemini use medium for both contestants. Candidate output uses the native core schema dialect; peer prompt bytes remain unchanged. Haiku uses the core scratchpad instruction and last-JSON candidate decoder.

| Model | Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| haiku | rubric/peer | 384/384 | 379 | 369 | 12 | 2 | 53/4096 = 0.012939453 | 53/8192 = 0.0064697266 | nominal lead |
| haiku | factuality/peer | 384/384 | 384 | 353 | 31 | 0 | 1/1073741824 = 9.3132257e-10 | 1/2147483648 = 4.6566129e-10 | nominal lead |
| haiku | pii/peer | 384/384 | 384 | 383 | 1 | 0 | 1 = 1 | 1/2 = 0.5 | TIE (not equivalence) |
| haiku | goal/peer | 384/384 | 384 | 192 | 192 | 0 | 1/3138550867693340381917894711603833208051177722232017256448 = 3.1861838e-58 | 1/6277101735386680763835789423207666416102355444464034512896 = 1.5930919e-58 | nominal lead |
| haiku | goal/peer-full-state | 384/384 | 384 | 346 | 38 | 0 | 1/137438953472 = 7.2759576e-12 | 1/274877906944 = 3.6379788e-12 | nominal lead |
| haiku | pooled-default/mixed | 1536/1536 | 1531 | 1297 | 236 | 2 | 14221/110427941548649020598956093796432407239217743554726184882600387580788736 = 1.2878081e-67 | 14221/220855883097298041197912187592864814478435487109452369765200775161577472 = 6.4390406e-68 | nominal lead |
| haiku | pooled-equal-evidence/mixed | 1536/1536 | 1531 | 1451 | 82 | 2 | 3571/9671406556917033397649408 = 3.6923275e-22 | 3571/19342813113834066795298816 = 1.8461637e-22 | nominal lead |
| gpt-6-luna | rubric/peer | 384/384 | 377 | 382 | 2 | 7 | 23/128 = 0.1796875 | 251/256 = 0.98046875 | TIE (not equivalence) |
| gpt-6-luna | factuality/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1 = 1 | TIE (not equivalence) |
| gpt-6-luna | pii/peer | 384/384 | 384 | 373 | 11 | 0 | 1/1024 = 0.0009765625 | 1/2048 = 0.00048828125 | nominal lead |
| gpt-6-luna | goal/peer | 384/384 | 384 | 179 | 205 | 0 | 1/25711008708143844408671393477458601640355247900524685364822016 = 3.8893845e-62 | 1/51422017416287688817342786954917203280710495801049370729644032 = 1.9446923e-62 | nominal lead |
| gpt-6-luna | goal/peer-full-state | 384/384 | 384 | 378 | 6 | 0 | 1/32 = 0.03125 | 1/64 = 0.015625 | nominal lead |
| gpt-6-luna | pooled-default/mixed | 1536/1536 | 1529 | 1318 | 218 | 7 | 2722239847673/13479973333575319897333507543509815336818572211270286240551805124608 = 2.0194698e-55 | 2722239847673/26959946667150639794667015087019630673637144422540572481103610249216 = 1.0097349e-55 | nominal lead |
| gpt-6-luna | pooled-equal-evidence/mixed | 1536/1536 | 1529 | 1517 | 19 | 7 | 15183/524288 = 0.028959274 | 15183/1048576 = 0.014479637 | nominal lead |
| gemini-3.8-flash | rubric/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1 = 1 | TIE (not equivalence) |
| gemini-3.8-flash | factuality/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1 = 1 | TIE (not equivalence) |
| gemini-3.8-flash | pii/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1 = 1 | TIE (not equivalence) |
| gemini-3.8-flash | goal/peer | 274/384 | 274 | 138 | 136 | 0 | 1/43556142965880123323311949751266331066368 = 2.2958874e-41 | 1/87112285931760246646623899502532662132736 = 1.1479437e-41 | PENDING |
| gemini-3.8-flash | goal/peer-full-state | 272/384 | 272 | 261 | 11 | 0 | 1/1024 = 0.0009765625 | 1/2048 = 0.00048828125 | PENDING |
| gemini-3.8-flash | pooled-default/mixed | 1426/1536 | 1426 | 1290 | 136 | 0 | 1/43556142965880123323311949751266331066368 = 2.2958874e-41 | 1/87112285931760246646623899502532662132736 = 1.1479437e-41 | PENDING |
| gemini-3.8-flash | pooled-equal-evidence/mixed | 1424/1536 | 1424 | 1413 | 11 | 0 | 1/1024 = 0.0009765625 | 1/2048 = 0.00048828125 | PENDING |

| Model | Row | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |
|---|---|---|---|---|---|---|
| haiku | rubric/peer | [96.989%, 99.443%] | [93.656%, 97.619%] | [-0.781%, 8.594%] | 5/0 | 0.053253/0.029333 |
| haiku | factuality/peer | [99.010%, 100.000%] | [88.769%, 94.255%] | [0.000%, 19.010%] | 0/0 | 0.053960/0.034993 |
| haiku | pii/peer | [99.010%, 100.000%] | [98.540%, 99.954%] | [0.000%, 0.781%] | 0/0 | 0.053808/0.031549 |
| haiku | goal/peer | [99.010%, 100.000%] | [45.024%, 54.976%] | [50.000%, 50.000%] | 0/0 | 0.059453/0.024449 |
| haiku | goal/peer-full-state | [99.010%, 100.000%] | [86.709%, 92.705%] | [0.000%, 25.000%] | 0/0 | 0.059453/0.047762 |
| haiku | pooled-default/mixed | [99.240%, 99.861%] | [82.542%, 86.167%] | [12.695%, 18.164%] | 5/0 | see rows |
| haiku | pooled-equal-evidence/mixed | [99.240%, 99.861%] | [93.208%, 95.503%] | [1.432%, 9.831%] | 5/0 | see rows |
| gpt-6-luna | rubric/peer | [96.286%, 99.114%] | [98.121%, 99.857%] | [-4.427%, 1.042%] | 2/0 | 0.015249/0.007390 |
| gpt-6-luna | factuality/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] | 0/0 | 0.015123/0.010463 |
| gpt-6-luna | pii/peer | [99.010%, 100.000%] | [94.944%, 98.393%] | [0.000%, 8.594%] | 0/0 | 0.014167/0.008002 |
| gpt-6-luna | goal/peer | [99.010%, 100.000%] | [41.683%, 51.613%] | [50.000%, 60.156%] | 0/0 | 0.016474/0.015902 |
| gpt-6-luna | goal/peer-full-state | [99.010%, 100.000%] | [96.634%, 99.282%] | [0.000%, 4.167%] | 0/0 | 0.016474/0.011549 |
| gpt-6-luna | pooled-default/mixed | [99.062%, 99.779%] | [83.973%, 87.463%] | [11.914%, 16.146%] | 2/0 | see rows |
| gpt-6-luna | pooled-equal-evidence/mixed | [99.062%, 99.779%] | [98.076%, 99.207%] | [-0.586%, 2.539%] | 2/0 | see rows |
| gemini-3.8-flash | rubric/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] | 0/0 | 0.179392/0.132674 |
| gemini-3.8-flash | factuality/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] | 0/0 | 0.145821/0.160642 |
| gemini-3.8-flash | pii/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] | 0/0 | 0.148505/0.145974 |
| gemini-3.8-flash | goal/peer | [98.617%, 100.000%] | [44.481%, 56.239%] | [47.143%, 52.364%] | 0/0 | 0.204706/0.246570 |
| gemini-3.8-flash | goal/peer-full-state | [98.607%, 100.000%] | [92.905%, 97.727%] | [0.000%, 9.929%] | 0/0 | 0.204870/0.178382 |
| gemini-3.8-flash | pooled-default/mixed | [99.731%, 100.000%] | [88.828%, 91.880%] | [8.838%, 10.244%] | 0/0 | see rows |
| gemini-3.8-flash | pooled-equal-evidence/mixed | [99.731%, 100.000%] | [98.622%, 99.568%] | [0.000%, 1.897%] | 0/0 | see rows |

9578 completed unique requests; 0 final unsuccessful responses. Variant spend USD 7.15869961. Primary plus variant measured spend USD 8.99764030 of the amended USD 12 cap.

Resolved model versions: ['claude-haiku-5-5', 'gemini-3.8-flash', 'gpt-6-luna'].

Exact tests and bootstrap use the original sealed statistics functions. Rows are descriptive secondary comparisons. The global 18-cell Holm table remains the collator's responsibility; conservative missing-as-one pooled adjustments are in scores.json.

All three model rows have explicit per-call raw usage. Luna pricing: USD 0.10 input, 0.01 cached input, 0.50 output per million. Gemini: USD 0.75 input and 3.75 output including thinking per million. Sources verified 2026-10-13: https://developers.openai.com/api/docs/models/gpt-6-luna and https://ai.google.dev/gemini-api/docs/pricing. Haiku uses CLI-reported cost.

The original adaptive four/two pacing is superseded by the per-model runtime amendment above. Every attempt and backoff is logged. Worker results are fsynced before the future returns. A drain file stops new dispatch and waits for owned requests.


## Limits on claims

- `FINAL.md`, `delivery.json` and `verification-final.json` carry final status. Frozen scorer outputs retain historical status text in some metadata; those fields do not describe final coverage.
- The planted cases reuse the original family templates with fresh bindings. Results do not demonstrate general superiority on arbitrary tasks.
- Constant pass and constant fail each score 50% by label balance. Repeated-read noise and perturbation validity are unmeasured; no stability claim is made.
- Information-asymmetric goal wins cannot establish a better judge on equal evidence. Both versions are disclosed.
- No global matrix verdict or global Holm win is claimed here. The per-row tables and exact rational p-values support independent collation.
