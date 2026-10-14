# Promptfoo hard rows: fresh sealed cohort

Generated 2026-10-13T11:20:31.272301+00:00. All results below derive from `comparisons/ledger-hard/scores.json`, `decisions.json` and `calls.jsonl` on `research/ledger-hard`.

Frozen criterion-ledger candidate, not a shipped-default claim. Synthetic cases retain the original construction families. Gemini 3.8 Flash was dropped by the owner; no pending billing cell remains. The separate dialect variant is pending the core dossier.

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
| gemini-3.8-flash | All rows | 0/1536 | Not reported | Not reported | | | | | dropped by the owner |

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
- The pilot is a transport and cost check on the first 20 sealed cases per row, retained once in final results. No labels or outcomes select continuation or change the procedure. No content retries. Owner-authorized unanswered transport retries use at most three attempts with 10/30-second backoff and at most two concurrent Luna calls. All failed attempts remain recorded.

## Freeze and spend

- Candidate procedure: `d7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587`.
- Seal SHA-256: `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4`. The seal holds every frozen source, case and prompt hash.
- Current branch commit: `f06456a442877987a595216f94a575bef290d654`.
- 6560 unique completed attempts; 0 transport failures; measured spend USD 1.83894069 of USD 10.
- 3280 gpt-6-luna calls use recorded usage and the corrected provider prices. Earlier raw records remain unchanged; current totals reprice those records.
- Resolved models: ['claude-haiku-5-5', 'gpt-6-luna'].
- Artifacts: `comparisons/ledger-hard/{seal,seeds,prior-census,prompts,scores,decisions}.json`, row case JSON, `starts.jsonl`, `calls.jsonl`, and the source scripts.
