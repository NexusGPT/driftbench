# Confidence experiment report

All numbers use recorded practice signals. No model calls or sealed TEST data.

Gold accuracy gives ties half credit. Full agreement is exact verdict agreement with the frozen reference.
Thresholds and named points are selected on tuning only. Validation sweeps are descriptive.

## Validation operating points

| Benchmark | S1 ECE before / after | Point | Gold accuracy | Full agreement | S1 / S2 calls |
|---|---:|---|---:|---:|---:|
| judgebench (n=27) | 0.217 / 0.265 | cheapest | 0.852 | 0.889 | 3.333 / 1.667 |
| judgebench (n=27) | 0.217 / 0.265 | balanced | 0.852 | 0.889 | 3.333 / 1.667 |
| judgebench (n=27) | 0.217 / 0.265 | most_accurate | 0.926 | 0.963 | 4.667 / 3.333 |
| mmeval (n=23) | 0.170 / 0.100 | cheapest | 1.000 | 0.957 | 2.522 / 0.652 |
| mmeval (n=23) | 0.170 / 0.100 | balanced | 1.000 | 0.957 | 2.522 / 0.652 |
| mmeval (n=23) | 0.170 / 0.100 | most_accurate | 1.000 | 0.957 | 2.522 / 0.652 |
| writing (n=28) | 0.243 / 0.187 | cheapest | 0.679 | 0.964 | 2.429 / 0.536 |
| writing (n=28) | 0.243 / 0.187 | balanced | 0.679 | 0.964 | 2.429 / 0.536 |
| writing (n=28) | 0.243 / 0.187 | most_accurate | 0.679 | 0.964 | 2.429 / 0.536 |

S1 ECE is the binary probability ECE for gold event A. It is separate from full-judge agreement.
Writing has no point meeting the requested 0.8 tuning gold-accuracy target. Balanced is explicitly infeasible.

## Validation calibration of every expert

| Benchmark | Expert | Tune / validation n | Gold-event ECE before | Gold-event ECE after | Full agreement target |
|---|---|---:|---:|---:|---|
| judgebench | adv | 41 / 27 | 0.107 | 0.105 | Not fitted by this map |
| judgebench | debate | 41 / 27 | 0.207 | 0.177 | Not fitted by this map |
| judgebench | first | 41 / 27 | 0.130 | 0.117 | Not fitted by this map |
| judgebench | length | 41 / 27 | 0.407 | 0.117 | Not fitted by this map |
| judgebench | ref | 41 / 27 | 0.107 | 0.067 | Not fitted by this map |
| judgebench | s1cf | 41 / 27 | 0.261 | 0.291 | Not fitted by this map |
| judgebench | s1p | 41 / 27 | 0.217 | 0.265 | Not fitted by this map |
| judgebench | s1pr | 41 / 27 | 0.180 | 0.307 | Not fitted by this map |
| judgebench | s1r | 41 / 27 | 0.160 | 0.237 | Not fitted by this map |
| judgebench | s2h | 41 / 27 | 0.210 | 0.083 | Not fitted by this map |
| judgebench | s2l | 41 / 27 | 0.056 | 0.053 | Not fitted by this map |
| judgebench | s2v | 41 / 27 | 0.019 | 0.009 | Not fitted by this map |
| mmeval | adv | 22 / 23 | 0.170 | 0.205 | Not fitted by this map |
| mmeval | debate | 22 / 23 | 0.254 | 0.169 | Not fitted by this map |
| mmeval | first | 22 / 23 | 0.065 | 0.065 | Not fitted by this map |
| mmeval | length | 22 / 23 | 0.609 | 0.065 | Not fitted by this map |
| mmeval | ref | 22 / 23 | 0.088 | 0.149 | Not fitted by this map |
| mmeval | s1cf | 22 / 23 | 0.165 | 0.139 | Not fitted by this map |
| mmeval | s1p | 22 / 23 | 0.170 | 0.100 | Not fitted by this map |
| mmeval | s1pr | 22 / 23 | 0.245 | 0.083 | Not fitted by this map |
| mmeval | s1r | 22 / 23 | 0.358 | 0.226 | Not fitted by this map |
| mmeval | s2h | 22 / 23 | 0.130 | 0.212 | Not fitted by this map |
| mmeval | s2l | 9 / 11 | 0.091 | 0.130 | Not fitted by this map |
| mmeval | s2v | 22 / 23 | 0.087 | 0.121 | Not fitted by this map |
| writing | adv | 22 / 28 | 0.140 | 0.159 | Not fitted by this map |
| writing | debate | 22 / 28 | 0.191 | 0.211 | Not fitted by this map |
| writing | first | 22 / 28 | 0.143 | 0.143 | Not fitted by this map |
| writing | length | 22 / 28 | 0.357 | 0.181 | Not fitted by this map |
| writing | ref | 22 / 28 | 0.143 | 0.216 | Not fitted by this map |
| writing | s1cf | 22 / 28 | 0.339 | 0.202 | Not fitted by this map |
| writing | s1p | 22 / 28 | 0.243 | 0.187 | Not fitted by this map |
| writing | s1pr | 22 / 28 | 0.187 | 0.223 | Not fitted by this map |
| writing | s1r | 22 / 28 | 0.145 | 0.234 | Not fitted by this map |
| writing | s2h | 22 / 28 | 0.286 | 0.232 | Not fitted by this map |
| writing | s2l | 22 / 28 | 0.429 | 0.148 | Not fitted by this map |
| writing | s2v | 22 / 28 | 0.411 | 0.148 | Not fitted by this map |

Each expert JSON includes the monotone map and all ten reliability bins. No empty bin is converted to zero accuracy.

## Validation methods and confidence levels

| Benchmark | Method | Level | n | Share | Gold accuracy | Full agreement |
|---|---|---|---:|---:|---:|---:|
| judgebench | fixed_0.9 | stop | 4 | 0.148 | 1.000 | 1.000 |
| judgebench | fixed_0.9 | one_more | 8 | 0.296 | 1.000 | 1.000 |
| judgebench | fixed_0.9 | full | 15 | 0.556 | 0.933 | 1.000 |
| judgebench | guaranteed | stop | 0 | 0.000 | n/a | n/a |
| judgebench | guaranteed | one_more | 0 | 0.000 | n/a | n/a |
| judgebench | guaranteed | full | 27 | 1.000 | 0.963 | 1.000 |
| judgebench | cross_validated | stop | 18 | 0.667 | 0.833 | 0.833 |
| judgebench | cross_validated | one_more | 0 | 0.000 | n/a | n/a |
| judgebench | cross_validated | full | 9 | 0.333 | 0.889 | 1.000 |
| mmeval | fixed_0.9 | stop | 8 | 0.348 | 1.000 | 1.000 |
| mmeval | fixed_0.9 | one_more | 8 | 0.348 | 1.000 | 0.875 |
| mmeval | fixed_0.9 | full | 7 | 0.304 | 1.000 | 1.000 |
| mmeval | guaranteed | stop | 0 | 0.000 | n/a | n/a |
| mmeval | guaranteed | one_more | 0 | 0.000 | n/a | n/a |
| mmeval | guaranteed | full | 23 | 1.000 | 0.913 | 1.000 |
| mmeval | cross_validated | stop | 20 | 0.870 | 1.000 | 0.950 |
| mmeval | cross_validated | one_more | 0 | 0.000 | n/a | n/a |
| mmeval | cross_validated | full | 3 | 0.130 | 1.000 | 1.000 |
| writing | fixed_0.9 | stop | 4 | 0.143 | 0.750 | 1.000 |
| writing | fixed_0.9 | one_more | 14 | 0.500 | 0.643 | 1.000 |
| writing | fixed_0.9 | full | 10 | 0.357 | 0.600 | 1.000 |
| writing | guaranteed | stop | 0 | 0.000 | n/a | n/a |
| writing | guaranteed | one_more | 0 | 0.000 | n/a | n/a |
| writing | guaranteed | full | 28 | 1.000 | 0.607 | 1.000 |
| writing | cross_validated | stop | 25 | 0.893 | 0.680 | 0.960 |
| writing | cross_validated | one_more | 0 | 0.000 | n/a | n/a |
| writing | cross_validated | full | 3 | 0.107 | 0.667 | 1.000 |

## Random-split sensitivity, 1,000 practice splits per method

| Benchmark | Method | Mean gold accuracy | Mean full agreement | Full target >= 0.90, splits | Early target held / nonempty early splits | Nontrivial certificates |
|---|---|---:|---:|---:|---:|---:|
| judgebench | fixed_0.9 | 0.969 | 0.983 | 1000 / 1000 | 953 / 1000 | 0 |
| judgebench | cross_validated | 0.860 | 0.873 | 259 / 1000 | 121 / 1000 | 0 |
| judgebench | guaranteed | 0.987 | 1.000 | 1000 / 1000 | 0 / 0 | 0 |
| mmeval | fixed_0.9 | 0.913 | 0.980 | 1000 / 1000 | 999 / 1000 | 0 |
| mmeval | cross_validated | 0.931 | 0.965 | 1000 / 1000 | 866 / 1000 | 0 |
| mmeval | guaranteed | 0.893 | 1.000 | 1000 / 1000 | 0 / 0 | 0 |
| writing | fixed_0.9 | 0.616 | 0.921 | 739 / 1000 | 655 / 1000 | 0 |
| writing | cross_validated | 0.642 | 0.955 | 839 / 1000 | 811 / 997 | 0 |
| writing | guaranteed | 0.570 | 1.000 | 1000 / 1000 | 0 / 0 | 0 |

Full-only passes the full-agreement target by identity, with no certified savings.
Empty early-exit sets are not successes. Fixed and CV policies carry no guarantee.
Random splits overlap. Their rates are descriptive, not independent trials or a proof of population risk control.

## Certification sample sizes

| Benchmark | Practice n | Tune / validation n | Independent certification n | Error-free accepted labels needed per enabled exit | Full target / risk | Gold accuracy guarantee |
|---|---:|---:|---:|---:|---|---|
| judgebench | 68 | 41 / 27 | 21 | 70 | 0.9 / 0.05 | None |
| mmeval | 45 | 22 / 23 | 11 | 70 | 0.9 / 0.05 | None |
| writing | 50 | 22 / 28 | 11 | 70 | 0.9 / 0.05 | None |

The grid uses 72 simultaneous one-sided binomial bounds. A single prespecified region needs at least 29 error-free labels; two prespecified regions need 36 each.
At the implemented split ratios, one enabled exit needs at least 280 practice items and two need at least 560, even before any disagreement.
The guarantee assumes fixed judges and independent, identically distributed calibration and future items.

## Missing signals and cost interpretation

- MM-Eval contains 45 recorded pairs in this snapshot, not 50.
- The first-token top-two log probabilities are absent; only the binary Jev margin is measured.
- Some recorded baseline costs and Jev prices are absent. Cost units use the declared S2 weight, not invented fees.
- Per-benchmark SVG and CSV curves retain gold accuracy and full agreement as separate series.
- The full reference and its calibration reserve stay frozen. Changing the reference requires recertification.
