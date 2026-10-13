# Pair ledger tie follow-up results

Frozen variant: `reasoning`.
SHA-256: `d115fe7ccf50e269d76e412f7a31843e35c3a4c7af757dc3211a1aa91454de2c`.
Code: `a90c9d8b60d5bf73c73bd5d5c18b33c80c4b60ec`. PR: https://github.com/achammah/driftbench/pull/294.

## Development selection

Equal-weight average over the nine model-by-benchmark cells chooses the variant. Exact selection ties prefer direct.

The [full dev tie accounting](DEV-DETAIL.md) reports 14 final ties: direct resolves 5 correctly, reasoning 6. Both beat the no-follow-up mean of 71.11%; neither beats promptfoo at 73.43%. The selected edge is one net pair in 270 equal-cell scoring units, from 240 actual model-pair evaluations.

| Model / benchmark | Pairs | Baseline | Direct | With reasoning | Promptfoo |
|---|---:|---:|---:|---:|---:|
| gpt-6.1-sol/jb | 30 | 96.67% | 96.67% | 96.67% | 96.67% |
| gpt-6.1-sol/mm | 20 | 75.00% | 75.00% | 75.00% | 80.00% |
| gpt-6.1-sol/wp | 30 | 46.67% | 53.33% | 53.33% | 53.33% |
| gpt-6-luna/jb | 30 | 86.67% | 93.33% | 90.00% | 86.67% |
| gpt-6-luna/mm | 20 | 85.00% | 85.00% | 85.00% | 80.00% |
| gpt-6-luna/wp | 30 | 50.00% | 50.00% | 50.00% | 50.00% |
| gemini-3.5-flash-lite/jb | 30 | 70.00% | 73.33% | 76.67% | 76.67% |
| gemini-3.5-flash-lite/mm | 20 | 80.00% | 80.00% | 80.00% | 82.50% |
| gemini-3.5-flash-lite/wp | 30 | 50.00% | 50.00% | 53.33% | 55.00% |

Selection means: direct 72.96%, reasoning 73.33%.

## Fresh confirmation

MM scores macro-average the five subsets equally. Writing scores exact matches across both directional games. Ledger reconciles its reads into one decision used for both games.
Wins, losses and ties compare the paired scores with promptfoo on unique response pairs. Two-sided exact sign tests exclude score ties. These tests count the direction of each pair difference; they do not weight its magnitude or reproduce the MM subset macro weights. P-values are unadjusted across the seven confirmation cells; no family-wise superiority claim is made.

| Model / benchmark | Pairs | Baseline | Follow-up | Promptfoo | Wins / losses / ties | Exact p | Changed better / worse vs baseline |
|---|---:|---:|---:|---:|---|---:|---|
| gpt-6.1-sol/mm | 92 | 84.00% | 85.67% | 94.33% | 0 / 6 / 86 | 0.03125 | 2 / 0 |
| gpt-6.1-sol/wp | 80 | 47.50% | 56.25% | 56.25% | 6 / 4 / 70 | 0.753906 | 7 / 0 |
| gpt-6-luna/mm | 92 | 90.33% | 91.33% | 93.00% | 6 / 5 / 81 | 1 | 2 / 0 |
| gpt-6-luna/wp | 80 | 61.25% | 61.25% | 62.50% | 11 / 12 / 57 | 1 | 0 / 0 |
| gemini-3.5-flash-lite/mm | 92 | 82.50% | 83.67% | 85.67% | 7 / 8 / 77 | 1 | 4 / 1 |
| gemini-3.5-flash-lite/wp | 80 | 68.75% | 73.75% | 66.88% | 24 / 12 / 44 | 0.0652453 | 4 / 0 |
| claude-haiku-5-5/wp | 50 | 64.00% | 68.00% | 66.00% | 11 / 8 / 31 | 0.647606 | 2 / 0 |

## MM safety

| Model | Pairs | Follow-up | Promptfoo | Wins / losses / ties | Exact p |
|---|---:|---:|---:|---|---:|
| gpt-6.1-sol | 20 | 70.00% | 80.00% | 0 / 2 / 18 | 0.5 |
| gpt-6-luna | 20 | 90.00% | 97.50% | 0 / 2 / 18 | 0.5 |
| gemini-3.5-flash-lite | 20 | 60.00% | 67.50% | 4 / 4 / 12 | 1 |

## Power and limitations

These are conditional exact-sign thresholds given the observed number of discordant pairs. A net-pair-win margin is not a directional-game accuracy difference.
The 80% power column conditions on that discordance count and assumes independently sampled pairs with a common win probability. It is a sensitivity calculation, not post-hoc evidence of no effect.

| Cell | Discordant pairs | Minimum significant net pair wins | Minimum significant net-pair margin | Net-pair margin at 80% power |
|---|---:|---:|---:|---:|
| gpt-6.1-sol/mm | 6 | 6 | 6.52% | 6.05% |
| gpt-6.1-sol/wp | 10 | 8 | 10.00% | 10.42% |
| gpt-6-luna/mm | 11 | 9 | 9.78% | 10.15% |
| gpt-6-luna/wp | 23 | 11 | 13.75% | 16.54% |
| gemini-3.5-flash-lite/mm | 15 | 9 | 9.78% | 11.18% |
| gemini-3.5-flash-lite/wp | 36 | 14 | 17.50% | 21.72% |
| claude-haiku-5-5/wp | 19 | 11 | 22.00% | 25.31% |

- JudgeBench has no fresh held-out pool; no sealed JudgeBench test item was reused.
- MM contains 12 fresh chat pairs and 20 each in the other categories; the macro score preserves equal subset weight.
- Writing contains unseen response pairs, not unseen questions. Prior System1 questions can recur. Original LongJudge exclusions remain.
- Pair-level inference assumes independent pairs. The 80 writing pairs span 67 prompts, the 50 Haiku pairs span 47 prompts, and the 92 MM pairs span 85 prompts. Repeated prompts can correlate errors; the reported pair tests do not adjust for this clustering.
- Dev and fresh pairs are disjoint from each other and the enumerated ledger and System1 seals. Absence from unrecorded calls or model training cannot be proved.
- Baseline calls are shared between variants. The default remains off. The new rule never branches on model identity.
- MM retains the frozen computation port. No harm-policy seat is installed for any model in this experiment; safety is reported separately.
- No claim of equivalence follows from a nonsignificant result. No held-out result changes the selected variant.
- Returned unparsed, refused or truncated judgments count as grader errors at zero; missing transport answers are recovered without re-sending returned answers.

## Cost and execution

- Provider-reported API and CLI cost: USD 11.417162. Unresolved reservations: USD 0.162354.
- Total charged plus held: USD 11.579516 of USD 40. Claude calls: 202 of 400.
- Global concurrency is 2. The detached supervisor records health probes, reservations and raw receipts. Answered requests are never resubmitted.
- Research data and raw receipts remain outside the repository. Public files contain code, hashes and aggregate results only.

## Execution audit

- [Receipt audit](execution-audit.json): 3,252 submissions, 3,250 returned answers, zero repeated answered requests, zero unreserved submissions, peak concurrency 2.
- Five provider/phase health gates each contain ten healthy probes, at least 30 seconds apart. Freeze commit precedes the first fresh call.
- The two unanswered transport attempts retain USD 0.162354 in conservative reservations. Missing-only recovery completes every planned pair.
- Haiku uses 202 CLI calls, all on writing, below the 400 cap. No session-limit stop occurs. Supervisor PID 49521 exits after the completed report.
- Grader errors count at zero. Dev Gemini JudgeBench has one ledger error shared by baseline and both variants, plus two promptfoo errors. Fresh Gemini writing has one ledger error shared by baseline and follow-up. Other cells have no grader errors.
- Fresh follow-up improves six of seven cell scores and preserves Luna writing. Versus promptfoo, two cells score higher, one matches and four score lower. No higher-scoring cell passes the unadjusted two-sided 0.05 sign test.

The [fresh score and overhead table](FINAL-SUMMARY.md) includes per-cell tie counts and marginal calls and cost.
