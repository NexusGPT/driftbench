# Statistics pilot, rounds 11 to 20 on the PR 771 bank

Measured 2026-10-18 against `docs/validators.md` section 12.4. Rounds 0 to 10 are the earlier pilot 2
(`pilot2-referee.jsonl`, bank `124fd17f`, 1216 items); this pilot continues from its product.

## Setup

* Bank: PR 771 at `9a019bf65`, 1162 items, bank hash
  `eff677df63307f40e39111be394c230ebe39b13c39fe553aa8a577d6702cb8b3`. Between round 10 and round 11 the
  bank changed: the 27 new capabilities that repeat roadmap methods were left out (54 items), and a domain
  item now also requires its value cases to return.
* Product at the start: the statistics package as pilot 2's executor left it after round 10 (it starts
  from `346a8249d`, the base of PR 777, and holds the executor's own repairs, not PR 777's).
* Executor: a fresh Sonnet session at medium effort for each round, in a folder that holds
  `packages/stats`, `docs` and the loop files, and no validator or bank code. It reads the referee's feed
  (the validator's own `--items` listing and a one-line-per-item index) and makes one fix per round, test
  first.
* Referee: copies the executor's `packages/stats` into a checkout of the bank and runs
  `pnpm -s driftbench validate stats --seed 1 --all-levels --items --json`. The bank checkout was
  unreadable while an executor ran. This is not a sandbox: other folders of the machine stayed readable,
  and the executors were told to stay in their folder.
* Round 10b is the round 10 product measured on the new bank, the starting point of rounds 11 to 20.

## Rounds

| Round | Passing | Failing items | Distinct causes | Items fixed | Bank score | Turned green |
|---|---|---|---|---|---|---|
| 10b | 927 | 235 | 118 | | 0.7978 | |
| 11 | 928 | 234 | 117 | 1 | 0.7986 | `exact.clopperPearson.alpha-min-lower` |
| 12 | 930 | 232 | 116 | 2 | 0.8003 | `agrestiCoullInterval` |
| 13 | 932 | 230 | 115 | 2 | 0.8021 | `geometricMean` |
| 14 | 934 | 228 | 114 | 2 | 0.8038 | `harmonicMean` |
| 15 | 936 | 226 | 113 | 2 | 0.8055 | `median` |
| 16 | 938 | 224 | 112 | 2 | 0.8072 | `coefficientOfVariation` |
| 17 | 940 | 222 | 111 | 2 | 0.8090 | `mode` |
| 18 | 942 | 220 | 110 | 2 | 0.8107 | `weightedMedian` |
| 19 | 944 | 218 | 109 | 2 | 0.8124 | `bonferroniAdjust` |
| 20 | 946 | 216 | 108 | 2 | 0.8141 | `sidakAdjust` |

The level stayed 3 of 7 throughout. Every round fixed exactly the items its executor predicted, and no item
turned red. The referee rows are in `pilot3-referee.jsonl`.

## Against section 12.4, rounds 11 to 20 as the pilot

* Items fixed per iteration: (946 - 927) / 10 = 1.9.
* Forecast: 216 / 1.9 = 113.7 iterations.
* Bank score after the pilot: 946 / 1162 = 0.8141.
* Distinct failing causes after the pilot: 108.

| Measure | Result | Contract 100 / 0.4 / 100 | Provisional bar of GATE.md 70 / 0.7 / 60 |
|---|---|---|---|
| forecast | 113.7 | holds | holds |
| score after the pilot | 0.8141 | fails | fails |
| distinct causes | 108 | holds | holds |

Neither gate holds: the score bar fails. 927 of the 1162 items already pass on this product, so the score
after any pilot stays above 0.79 whatever the forecast. The forecast and the cause count hold once the
earlier causes are fixed: from round 12 on, each round implemented one missing function (one cause, two
items). The independent audit of section 12.7 (blind pilot, cheater, cause review, planted bugs) has not
run on this bank; `audit.md` keeps its four checks pending.
