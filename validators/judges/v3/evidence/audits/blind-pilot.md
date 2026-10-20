# Blind causal pilot audit

| Pilot | Verdict | Evidence |
|---|---|---|
| blind pilot | fail | Baseline `results/round-00.feedback.json`: 0/334, level 0. Round 10 `results/round-10.feedback.json`: 327/334, level 3. Hardness requirements fail. |

## Measured rounds

| Round | Single capability addressed | Passing / 334 | Level | Candidate commit |
|---|---|---:|---:|---|
| 0 | Untouched baseline | 0 | 0 | `5823244` |
| 1 | Nominal scorer | 210 | 0 | `c5b7f69` |
| 2 | Immutable replay and required identity helpers | 300 | 1 | `02035ef` |
| 3 | Confusion report | 304 | 1 | `03cd288` |
| 4 | Binary PABAK | 307 | 2 | `a05176e` |
| 5 | Ordinal weighted kappa | 311 | 2 | `09fde30` |
| 6 | Explicit total vocabulary mapping | 315 | 2 | `aec8b4d` |
| 7 | Multinomial delta kappa interval | 319 | 2 | `ae1becb` |
| 8 | Coverage curve and exact binomial intervals | 321 | 2 | `c7caf36` |
| 9 | Threshold selection | 323 | 3 | `67ceab7` |
| 10 | Nominal multi-rater alpha | 327 | 3 | `1867e11` |

## Hardness arithmetic

- Hardness score: passing checks / bank size = 327/334 = 0.979041916168, above the required ceiling 0.4.
- Level is reported separately: 3. It is not the hardness score.
- Remaining failed checks: 7.
- Observed gain rate: (327 - 0)/10 = 32.7 checks per round.
- Linear remaining-check forecast: 7/32.7 = 0.214067278287 rounds, below the required floor 100.
- This arithmetic extrapolation is not a claim about implementation effort or independent causes.
- Distinct remaining causes: not assessed. No author cause tags were inspected. Independent review owns that requirement.

## Boundaries and evidence

- Candidate implementation and all regression tests were written only under `/tmp/astra-judges-causal-blind`.
- The untouched supplied candidate was committed before baseline measurement.
- Inputs read: supplied candidate, BASE.md, ADVANCED.md, own tests and their execution output, bank stdout, and per-round feedback JSON.
- No finished implementation, repository tests, fixture source, cause tags, another executor, previous pilot, or report/summary output was inspected.
- Repository code and HEAD were not edited by this executor. The parent supplied frozen HEAD `6579b72536697bc99bccb5c138d007d4e3a4a44d`.
- Every test and bank command passed through the supplied slot wrapper. No model calls were added to the bank.
- Ten actual capability-fix rounds followed baseline. There are no invented failures or unchanged padding rounds.
- The sample planner and exact permutation test remain their original throwing stubs after round 10.
- Red/green logs: `logs/round01.red.log` through `logs/round10.red.log`, with matching green logs.
- The final combined regression execution exited 0; output is `logs/final-regressions.log`.
- `notes.jsonl` records each round. `timings.jsonl` records elapsed wrapper subprocess durations from round 2 onward.
- Sonnet was unavailable. The inherited Codex executor was used, as disclosed in the assignment.

## Protocol caveats

- Round 1's handwritten test initially used kappa 1/3; its correct value is 5/13. The assertion was corrected before successful green verification.
- Round 2's commit command was submitted while the green test process was still running. That process subsequently returned exit 0. Later rounds awaited green results before committing.
- Baseline and round 1 lack end-to-end process timing records. Their observed tool-call timings are not represented as full process durations.
- During round 10, the parent clarified the public `pairable` field: it counts retained ratings, not units. The parent updated ADVANCED.md. Both assertion and implementation were adjusted before round-10 bank measurement; this was not counted as another cause or round.
- The audit fails the requested hardness bar independently of these procedural caveats.
