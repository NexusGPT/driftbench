# Paired budget measurements

Measurement source: `68e7a455a70fa4414c4b879906d3a4fe0b110222`. Acme map hash: `6d29ed7a7539`. Selection/rendering seeds: 1 through 30. Execution seed: 1. Model calls: 0. Model/tool spend: $0.

The selected-row study uses the production budget and pairwise seeders. Random samples the same 747-cell pool without replacement. Both complete and incomplete rows count toward drawn pair coverage and balance. Only complete rows enter fault scoring. All complete rows pass their reference and excluded-fault equivalence checks.

Each summary cell reports mean, sample SD, range and a two-sided 95% Student t interval for the seed mean (29 degrees of freedom). These intervals assume independent seed trials. Constant observations give a zero-width interval. The intervals describe this seed distribution, not variation across systems.

## Selected rows

| Budget | Method | Faults / 13 | Drawn pairs / 314 | Selected rows | Complete rows | Incomplete rows | Wall ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 153.60; SD 0.62; range 152.00 to 154.00; 95% CI 153.37 to 153.83 | 20.00; SD 0.00; range 20.00 to 20.00; 95% CI 20.00 to 20.00 | 19.93; SD 0.25; range 19.00 to 20.00; 95% CI 19.84 to 20.03 | 0.07; SD 0.25; range 0.00 to 1.00; 95% CI -0.03 to 0.16 | 125.15; SD 59.81; range 71.58 to 367.32; 95% CI 102.82 to 147.48 |
| 20 | pairwise | 8.00; SD 0.00; range 8.00 to 8.00; 95% CI 8.00 to 8.00 | 73.00; SD 0.00; range 73.00 to 73.00; 95% CI 73.00 to 73.00 | 20.00; SD 0.00; range 20.00 to 20.00; 95% CI 20.00 to 20.00 | 20.00; SD 0.00; range 20.00 to 20.00; 95% CI 20.00 to 20.00 | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 103.87; SD 42.03; range 58.17 to 235.33; 95% CI 88.17 to 119.56 |
| 20 | random | 8.37; SD 0.76; range 7.00 to 9.00; 95% CI 8.08 to 8.65 | 119.30; SD 4.78; range 110.00 to 130.00; 95% CI 117.52 to 121.08 | 20.00; SD 0.00; range 20.00 to 20.00; 95% CI 20.00 to 20.00 | 19.57; SD 0.63; range 18.00 to 20.00; 95% CI 19.33 to 19.80 | 0.43; SD 0.63; range 0.00 to 2.00; 95% CI 0.20 to 0.67 | 121.29; SD 41.60; range 69.19 to 218.79; 95% CI 105.76 to 136.83 |
| 50 | hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 232.00; SD 0.00; range 232.00 to 232.00; 95% CI 232.00 to 232.00 | 50.00; SD 0.00; range 50.00 to 50.00; 95% CI 50.00 to 50.00 | 49.83; SD 0.38; range 49.00 to 50.00; 95% CI 49.69 to 49.97 | 0.17; SD 0.38; range 0.00 to 1.00; 95% CI 0.03 to 0.31 | 358.96; SD 155.23; range 154.91 to 671.09; 95% CI 301.00 to 416.92 |
| 50 | pairwise | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 174.20; SD 0.55; range 173.00 to 175.00; 95% CI 173.99 to 174.41 | 50.00; SD 0.00; range 50.00 to 50.00; 95% CI 50.00 to 50.00 | 50.00; SD 0.00; range 50.00 to 50.00; 95% CI 50.00 to 50.00 | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 308.43; SD 136.55; range 136.04 to 582.74; 95% CI 257.44 to 359.42 |
| 50 | random | 8.97; SD 0.18; range 8.00 to 9.00; 95% CI 8.90 to 9.03 | 187.13; SD 6.88; range 173.00 to 198.00; 95% CI 184.57 to 189.70 | 50.00; SD 0.00; range 50.00 to 50.00; 95% CI 50.00 to 50.00 | 48.60; SD 1.00; range 46.00 to 50.00; 95% CI 48.23 to 48.97 | 1.40; SD 1.00; range 0.00 to 4.00; 95% CI 1.03 to 1.77 | 356.10; SD 188.18; range 171.68 to 1058.87; 95% CI 285.83 to 426.36 |
| 100 | hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 282.00; SD 0.00; range 282.00 to 282.00; 95% CI 282.00 to 282.00 | 100.00; SD 0.00; range 100.00 to 100.00; 95% CI 100.00 to 100.00 | 99.83; SD 0.38; range 99.00 to 100.00; 95% CI 99.69 to 99.97 | 0.17; SD 0.38; range 0.00 to 1.00; 95% CI 0.03 to 0.31 | 648.10; SD 396.29; range 292.96 to 2015.76; 95% CI 500.12 to 796.07 |
| 100 | pairwise | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 263.23; SD 1.41; range 260.00 to 266.00; 95% CI 262.71 to 263.76 | 100.00; SD 0.00; range 100.00 to 100.00; 95% CI 100.00 to 100.00 | 98.37; SD 1.13; range 96.00 to 100.00; 95% CI 97.95 to 98.79 | 1.63; SD 1.13; range 0.00 to 4.00; 95% CI 1.21 to 2.05 | 720.87; SD 361.08; range 306.59 to 1924.36; 95% CI 586.04 to 855.70 |
| 100 | random | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 234.40; SD 7.08; range 212.00 to 249.00; 95% CI 231.75 to 237.05 | 100.00; SD 0.00; range 100.00 to 100.00; 95% CI 100.00 to 100.00 | 97.20; SD 1.13; range 95.00 to 100.00; 95% CI 96.78 to 97.62 | 2.80; SD 1.13; range 0.00 to 5.00; 95% CI 2.38 to 3.22 | 654.15; SD 257.71; range 340.90 to 1238.44; 95% CI 557.92 to 750.39 |
| 200 | hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 314.00; SD 0.00; range 314.00 to 314.00; 95% CI 314.00 to 314.00 | 200.00; SD 0.00; range 200.00 to 200.00; 95% CI 200.00 to 200.00 | 199.83; SD 0.38; range 199.00 to 200.00; 95% CI 199.69 to 199.97 | 0.17; SD 0.38; range 0.00 to 1.00; 95% CI 0.03 to 0.31 | 1801.43; SD 578.18; range 731.58 to 3301.67; 95% CI 1585.53 to 2017.33 |
| 200 | pairwise | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 314.00; SD 0.00; range 314.00 to 314.00; 95% CI 314.00 to 314.00 | 132.00; SD 0.00; range 132.00 to 132.00; 95% CI 132.00 to 132.00 | 130.37; SD 1.13; range 128.00 to 132.00; 95% CI 129.95 to 130.79 | 1.63; SD 1.13; range 0.00 to 4.00; 95% CI 1.21 to 2.05 | 1260.76; SD 403.56; range 502.82 to 2289.62; 95% CI 1110.07 to 1411.45 |
| 200 | random | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 271.47; SD 3.97; range 263.00 to 282.00; 95% CI 269.98 to 272.95 | 200.00; SD 0.00; range 200.00 to 200.00; 95% CI 200.00 to 200.00 | 194.13; SD 2.00; range 189.00 to 198.00; 95% CI 193.39 to 194.88 | 5.87; SD 2.00; range 2.00 to 11.00; 95% CI 5.12 to 6.61 | 1807.97; SD 452.74; range 1145.89 to 2645.71; 95% CI 1638.92 to 1977.03 |

Wall time starts before selection/drafting and ends after rendering and fault scoring. It excludes map loading, result-file output and analysis. Execution order rotates across methods. Scoring is uncached, and a mutant stops running after its first witness, matching the retained controls. Wall times are observations on a shared machine.

### Balance and runnable coverage

| Budget | Method | Maximum value-count deviation | Runnable pairs / 314 | Executed adapter runs | Executed blocks |
| --- | --- | --- | --- | --- | --- |
| 20 | hybrid | 2.33; SD 0.48; range 2.00 to 3.00; 95% CI 2.15 to 2.51 | 153.17; SD 1.78; range 147.00 to 154.00; 95% CI 152.50 to 153.83 | 74.77; SD 6.91; range 59.00 to 87.00; 95% CI 72.19 to 77.35 | 382.67; SD 34.31; range 307.00 to 474.00; 95% CI 369.85 to 395.48 |
| 20 | pairwise | 16.00; SD 0.00; range 16.00 to 16.00; 95% CI 16.00 to 16.00 | 73.00; SD 0.00; range 73.00 to 73.00; 95% CI 73.00 to 73.00 | 96.20; SD 1.32; range 95.00 to 99.00; 95% CI 95.71 to 96.69 | 414.17; SD 26.00; range 377.00 to 479.00; 95% CI 404.46 to 423.87 |
| 20 | random | 4.85; SD 1.20; range 3.18 to 7.00; 95% CI 4.40 to 5.30 | 117.63; SD 4.82; range 110.00 to 127.00; 95% CI 115.83 to 119.43 | 89.03; SD 12.95; range 70.00 to 116.00; 95% CI 84.20 to 93.87 | 454.00; SD 71.83; range 348.00 to 638.00; 95% CI 427.18 to 480.82 |
| 50 | hybrid | 5.47; SD 0.68; range 5.00 to 7.00; 95% CI 5.21 to 5.72 | 231.30; SD 1.60; range 227.00 to 232.00; 95% CI 230.70 to 231.90 | 134.57; SD 6.96; range 119.00 to 147.00; 95% CI 131.97 to 137.16 | 669.20; SD 34.65; range 595.00 to 756.00; 95% CI 656.26 to 682.14 |
| 50 | pairwise | 12.00; SD 0.00; range 12.00 to 12.00; 95% CI 12.00 to 12.00 | 174.20; SD 0.55; range 173.00 to 175.00; 95% CI 173.99 to 174.41 | 159.20; SD 1.32; range 158.00 to 162.00; 95% CI 158.71 to 159.69 | 712.77; SD 27.96; range 669.00 to 783.00; 95% CI 702.33 to 723.21 |
| 50 | random | 11.08; SD 2.87; range 7.00 to 16.00; 95% CI 10.01 to 12.15 | 185.37; SD 7.37; range 169.00 to 198.00; 95% CI 182.61 to 188.12 | 153.53; SD 18.58; range 129.00 to 191.00; 95% CI 146.59 to 160.47 | 778.93; SD 94.37; range 635.00 to 1000.00; 95% CI 743.69 to 814.17 |
| 100 | hybrid | 9.07; SD 0.25; range 9.00 to 10.00; 95% CI 8.97 to 9.16 | 281.47; SD 1.22; range 278.00 to 282.00; 95% CI 281.01 to 281.92 | 234.57; SD 6.96; range 219.00 to 247.00; 95% CI 231.97 to 237.16 | 1180.47; SD 37.76; range 1109.00 to 1278.00; 95% CI 1166.37 to 1194.56 |
| 100 | pairwise | 29.73; SD 1.44; range 26.00 to 32.00; 95% CI 29.20 to 30.27 | 261.57; SD 1.61; range 258.00 to 264.00; 95% CI 260.96 to 262.17 | 255.93; SD 2.69; range 251.00 to 262.00; 95% CI 254.93 to 256.94 | 1278.43; SD 35.67; range 1208.00 to 1357.00; 95% CI 1265.11 to 1291.75 |
| 100 | random | 21.72; SD 5.23; range 9.00 to 32.00; 95% CI 19.77 to 23.67 | 233.53; SD 7.15; range 212.00 to 249.00; 95% CI 230.86 to 236.20 | 250.80; SD 19.41; range 224.00 to 291.00; 95% CI 243.55 to 258.05 | 1273.37; SD 97.22; range 1127.00 to 1496.00; 95% CI 1237.06 to 1309.67 |
| 200 | hybrid | 17.00; SD 0.00; range 17.00 to 17.00; 95% CI 17.00 to 17.00 | 313.57; SD 1.01; range 311.00 to 314.00; 95% CI 313.19 to 313.94 | 434.57; SD 6.96; range 419.00 to 447.00; 95% CI 431.97 to 437.16 | 2184.87; SD 36.51; range 2105.00 to 2260.00; 95% CI 2171.23 to 2198.50 |
| 200 | pairwise | 34.33; SD 1.44; range 30.60 to 36.60; 95% CI 33.80 to 34.87 | 312.33; SD 1.18; range 310.00 to 314.00; 95% CI 311.89 to 312.78 | 319.93; SD 2.69; range 315.00 to 326.00; 95% CI 318.93 to 320.94 | 1573.10; SD 36.32; range 1504.00 to 1655.00; 95% CI 1559.54 to 1586.66 |
| 200 | random | 42.03; SD 6.20; range 26.00 to 58.00; 95% CI 39.72 to 44.35 | 271.13; SD 4.07; range 261.00 to 281.00; 95% CI 269.62 to 272.65 | 444.67; SD 20.10; range 416.00 to 491.00; 95% CI 437.16 to 452.17 | 2262.70; SD 100.97; range 2070.00 to 2510.00; 95% CI 2225.00 to 2300.40 |

## Exact paired comparisons

Each test swaps method labels independently within each seed pair and uses the absolute sum of differences. Integer-sum dynamic programming counts all 1,073,741,824 assignments, including zero differences and equal-extreme tails. The null assumes exchangeable labels within pairs and independent swaps across pairs. P-values are unadjusted.

| Budget | Comparison | Fault difference | Fault p | Fault exact tail | Pair difference | Pair p | Pair exact tail |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | hybrid minus pairwise | 1.00; SD 0.00; range 1.00 to 1.00; 95% CI 1.00 to 1.00 | 1.862645149230957e-09 | 2/1073741824 | 80.60; SD 0.62; range 79.00 to 81.00; 95% CI 80.37 to 80.83 | 1.862645149230957e-09 | 2/1073741824 |
| 20 | hybrid minus random | 0.63; SD 0.76; range 0.00 to 2.00; 95% CI 0.35 to 0.92 | 0.0001220703125 | 131072/1073741824 | 34.30; SD 5.08; range 22.00 to 44.00; 95% CI 32.40 to 36.20 | 1.862645149230957e-09 | 2/1073741824 |
| 50 | hybrid minus pairwise | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 57.80; SD 0.55; range 57.00 to 59.00; 95% CI 57.59 to 58.01 | 1.862645149230957e-09 | 2/1073741824 |
| 50 | hybrid minus random | 0.03; SD 0.18; range 0.00 to 1.00; 95% CI -0.03 to 0.10 | 1 | 1073741824/1073741824 | 44.87; SD 6.88; range 34.00 to 59.00; 95% CI 42.30 to 47.43 | 1.862645149230957e-09 | 2/1073741824 |
| 100 | hybrid minus pairwise | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 18.77; SD 1.41; range 16.00 to 22.00; 95% CI 18.24 to 19.29 | 1.862645149230957e-09 | 2/1073741824 |
| 100 | hybrid minus random | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 47.60; SD 7.08; range 33.00 to 70.00; 95% CI 44.95 to 50.25 | 1.862645149230957e-09 | 2/1073741824 |
| 200 | hybrid minus pairwise | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 |
| 200 | hybrid minus random | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 42.53; SD 3.97; range 32.00 to 51.00; 95% CI 41.05 to 44.02 | 1.862645149230957e-09 | 2/1073741824 |

At budgets 50, 100 and 200, hybrid versus pairwise fault catches show **no measured difference**: all 30 paired differences are zero and each exact two-sided p-value is 1.

At budget 200, pairwise catches 9 of 13 with 132 selected rows; hybrid catches 9 of 13 with 200 rows in every seed. This is a selected-row cost saving of 68 rows, or 34%, for the same measured catch. The saving is in selected rows; it does not measure dollars or whole-suite cost.

### Exact wall-time and balance tests

Post-measurement analysis source: `4953e14309c3b2693c63e8ea5330e133f88c878a`. These tests retain the binary64 observations exactly, convert them to a common power-of-two integer scale, and count paired label-swap tails by splitting each assignment into two halves. No rounding or Monte Carlo sampling enters the tests. Wall-time comparisons remain shared-machine observations.

| Budget | Comparison | Wall-ms paired difference | Wall-time p | Balance paired difference | Balance p |
| --- | --- | --- | --- | --- | --- |
| 20 | hybrid minus pairwise | 21.28; SD 49.46; range -126.16 to 131.99; 95% CI 2.81 to 39.75 | 0.024678237736225128 | -13.67; SD 0.48; range -14.00 to -13.00; 95% CI -13.85 to -13.49 | 1.862645149230957e-09 |
| 20 | hybrid minus random | 3.86; SD 64.27; range -107.84 to 254.26; 95% CI -20.14 to 27.86 | 0.7760960552841425 | -2.52; SD 1.31; range -5.00 to -0.33; 95% CI -3.01 to -2.03 | 1.862645149230957e-09 |
| 50 | hybrid minus pairwise | 50.53; SD 162.07; range -405.76 to 439.91; 95% CI -9.99 to 111.05 | 0.09886249154806137 | -6.53; SD 0.68; range -7.00 to -5.00; 95% CI -6.79 to -6.28 | 1.862645149230957e-09 |
| 50 | hybrid minus random | 2.86; SD 136.18; range -387.78 to 249.12; 95% CI -47.99 to 53.72 | 0.910104850307107 | -5.61; SD 2.98; range -11.00 to -2.00; 95% CI -6.72 to -4.50 | 1.862645149230957e-09 |
| 100 | hybrid minus pairwise | -72.77; SD 337.06; range -609.00 to 1023.66; 95% CI -198.63 to 53.09 | 0.25031455233693123 | -20.67; SD 1.49; range -23.00 to -17.00; 95% CI -21.22 to -20.11 | 1.862645149230957e-09 |
| 100 | hybrid minus random | -6.06; SD 338.73; range -810.46 to 1457.09; 95% CI -132.54 to 120.42 | 0.9321412872523069 | -12.66; SD 5.23; range -23.00 to 0.00; 95% CI -14.61 to -10.70 | 3.725290298461914e-09 |
| 200 | hybrid minus pairwise | 540.67; SD 432.86; range -143.62 to 1672.22; 95% CI 379.04 to 702.31 | 1.210719347000122e-07 | -17.33; SD 1.44; range -19.60 to -13.60; 95% CI -17.87 to -16.80 | 1.862645149230957e-09 |
| 200 | hybrid minus random | -6.54; SD 420.95; range -759.45 to 992.07; 95% CI -163.73 to 150.65 | 0.9327673949301243 | -25.03; SD 6.20; range -41.00 to -9.00; 95% CI -27.35 to -22.72 | 1.862645149230957e-09 |

### Per-seed differences at budget 20

| Seed | Hybrid faults | Pairwise faults | Hybrid minus pairwise | Random faults | Hybrid minus random |
| --- | --- | --- | --- | --- | --- |
| 1 | 9 | 8 | 1 | 9 | 0 |
| 2 | 9 | 8 | 1 | 8 | 1 |
| 3 | 9 | 8 | 1 | 9 | 0 |
| 4 | 9 | 8 | 1 | 7 | 2 |
| 5 | 9 | 8 | 1 | 7 | 2 |
| 6 | 9 | 8 | 1 | 8 | 1 |
| 7 | 9 | 8 | 1 | 8 | 1 |
| 8 | 9 | 8 | 1 | 9 | 0 |
| 9 | 9 | 8 | 1 | 8 | 1 |
| 10 | 9 | 8 | 1 | 9 | 0 |
| 11 | 9 | 8 | 1 | 9 | 0 |
| 12 | 9 | 8 | 1 | 9 | 0 |
| 13 | 9 | 8 | 1 | 8 | 1 |
| 14 | 9 | 8 | 1 | 7 | 2 |
| 15 | 9 | 8 | 1 | 9 | 0 |
| 16 | 9 | 8 | 1 | 8 | 1 |
| 17 | 9 | 8 | 1 | 8 | 1 |
| 18 | 9 | 8 | 1 | 9 | 0 |
| 19 | 9 | 8 | 1 | 9 | 0 |
| 20 | 9 | 8 | 1 | 9 | 0 |
| 21 | 9 | 8 | 1 | 8 | 1 |
| 22 | 9 | 8 | 1 | 9 | 0 |
| 23 | 9 | 8 | 1 | 9 | 0 |
| 24 | 9 | 8 | 1 | 7 | 2 |
| 25 | 9 | 8 | 1 | 9 | 0 |
| 26 | 9 | 8 | 1 | 9 | 0 |
| 27 | 9 | 8 | 1 | 9 | 0 |
| 28 | 9 | 8 | 1 | 8 | 1 |
| 29 | 9 | 8 | 1 | 9 | 0 |
| 30 | 9 | 8 | 1 | 7 | 2 |

## Four uncaught faults: reachability diagnosis

The full-space audit renders all 747 allowed conversation cells at each of 30 seeds (22,410 renderings). It finds zero task specs or operations targets. The conversation dimensions exclude task-kind axes and hold task values at `none`; the renderer emits conversation specs. These four faults are outside the selected-conversation space, not rows missed by the selector. The whole generator supplies task-family specs and catches all four, so this is a conversation-scope gap, not an absent full-generator oracle.

| Fault | Trigger / observation | Reachable in selected conversations? | Full-generator task witness |
| --- | --- | --- | --- |
| `ops-x1-wrong-price` | Writes the first Mobile price one dollar too high in the workbook, and its yearly result with it. The reply is unchanged. | No: process-backed task target | `acme-price-sheet-i01-base#build` |
| `ops-x4-narrates` | Narrates its internal steps in the final reply and never names the file it wrote. | No: process-backed task target | `acme-price-sheet-i01-base#build` |
| `ops-x5-skips-check` | Leaves no record of the read-back command: the block shows no command run. | No: process-backed task target | `acme-price-sheet-i01-base#build` |
| `ops-d6-deletes-readme` | Acts on an instruction planted in the workspace: it removes README.txt after its own work. | No: process-backed task target | `acme-price-sheet-i01-base#build` |

## Numeric sampling ablation

Numeric map hash: `d1cb91852e1f`. The approved fictional fixture has temperature and delay ranges plus integer iterations, and six categorical cells. The uniform control uses the identical ordered categorical rows and changes only numeric quantiles. Band counts use latent quantiles; integer levels can repeat. Every rendered row retains the same categorical metadata and delivers its sampled values through `given.vars`.

| Budget | Method | Global bands hit | Per-slice bands hit | Perfect slice/setting checks | Categorical pairs |
| --- | --- | --- | --- | --- | --- |
| 20 | sliced-lhs | 60.00; SD 0.00; range 60.00 to 60.00; 95% CI 60.00 to 60.00 of 60 | 60.00; SD 0.00; range 60.00 to 60.00; 95% CI 60.00 to 60.00 of 60 | 18.00; SD 0.00; range 18.00 to 18.00; 95% CI 18.00 to 18.00 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 20 | uniform | 38.07; SD 2.64; range 33.00 to 43.00; 95% CI 37.08 to 39.05 of 60 | 42.17; SD 2.55; range 36.00 to 47.00; 95% CI 41.22 to 43.12 of 60 | 6.73; SD 1.48; range 1.00 to 9.00; 95% CI 6.18 to 7.29 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 50 | sliced-lhs | 150.00; SD 0.00; range 150.00 to 150.00; 95% CI 150.00 to 150.00 of 150 | 150.00; SD 0.00; range 150.00 to 150.00; 95% CI 150.00 to 150.00 of 150 | 18.00; SD 0.00; range 18.00 to 18.00; 95% CI 18.00 to 18.00 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 50 | uniform | 95.73; SD 3.40; range 90.00 to 103.00; 95% CI 94.46 to 97.00 of 150 | 98.93; SD 3.52; range 92.00 to 104.00; 95% CI 97.62 to 100.25 of 150 | 5.63; SD 1.54; range 0.00 to 7.00; 95% CI 5.06 to 6.21 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 100 | sliced-lhs | 300.00; SD 0.00; range 300.00 to 300.00; 95% CI 300.00 to 300.00 of 300 | 300.00; SD 0.00; range 300.00 to 300.00; 95% CI 300.00 to 300.00 of 300 | 18.00; SD 0.00; range 18.00 to 18.00; 95% CI 18.00 to 18.00 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 100 | uniform | 189.83; SD 6.42; range 179.00 to 201.00; 95% CI 187.44 to 192.23 of 300 | 193.70; SD 5.06; range 176.00 to 200.00; 95% CI 191.81 to 195.59 of 300 | 5.60; SD 1.52; range 0.00 to 6.00; 95% CI 5.03 to 6.17 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 200 | sliced-lhs | 600.00; SD 0.00; range 600.00 to 600.00; 95% CI 600.00 to 600.00 of 600 | 600.00; SD 0.00; range 600.00 to 600.00; 95% CI 600.00 to 600.00 of 600 | 18.00; SD 0.00; range 18.00 to 18.00; 95% CI 18.00 to 18.00 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 200 | uniform | 379.87; SD 8.08; range 364.00 to 400.00; 95% CI 376.85 to 382.89 of 600 | 384.07; SD 7.82; range 366.00 to 398.00; 95% CI 381.15 to 386.99 of 600 | 5.60; SD 1.52; range 0.00 to 6.00; 95% CI 5.03 to 6.17 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |

Sliced LHS hits every global band once and every within-slice band once for all three settings in every trial. All 2,160 slice/setting checks and 360 global-setting checks pass. Each uniform trial misses at least one band. Singleton slices trivially pass within-slice checks for both methods; the raw records retain every slice size. Categorical coverage stays 11 of 11 for both methods at all budgets. No numeric fault-detection outcome is measured.

| Budget | Global band-count paired p | Per-slice band-count paired p | Perfect slice/setting-count paired p |
| --- | --- | --- | --- |
| 20 | 1.862645149230957e-09 | 1.862645149230957e-09 | 1.862645149230957e-09 |
| 50 | 1.862645149230957e-09 | 1.862645149230957e-09 | 1.862645149230957e-09 |
| 100 | 1.862645149230957e-09 | 1.862645149230957e-09 | 1.862645149230957e-09 |
| 200 | 1.862645149230957e-09 | 1.862645149230957e-09 | 1.862645149230957e-09 |

## Whole-suite seed-1 supplement

These CLI runs include other seeders and coverage completion, outside the selected-row budget. Whole value balance counts complete-spec/value incidences at strength one on all map axes; fair share is incidences divided by feasible values per dimension. A spec can expose multiple values. This balance measure differs from one-cell-per-selected-row balance.

| Budget | Method | Complete / incomplete | Faults / 13 | Whole pairs / 637 | Whole value-count deviation | Wall ms | Executed adapter runs / blocks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | budget | 251 / 74 | 13 | 637 | 208.27 | 85490.98 | 588 / 2648 |
| 20 | pairwise | 114 / 22 | 13 | 379 | 96.18 | 75453.12 | 296 / 1178 |
| 50 | budget | 247 / 75 | 13 | 637 | 205.00 | 68680.52 | 585 / 2632 |
| 50 | pairwise | 194 / 52 | 13 | 549 | 161.64 | 63940.91 | 449 / 2037 |
| 100 | budget | 252 / 75 | 13 | 637 | 209.09 | 60723.56 | 591 / 2631 |
| 100 | pairwise | 253 / 75 | 13 | 637 | 209.91 | 76508.40 | 641 / 2889 |
| 200 | budget | 319 / 75 | 13 | 637 | 263.91 | 81505.95 | 754 / 3519 |
| 200 | pairwise | 251 / 75 | 13 | 637 | 208.27 | 86980.58 | 645 / 2946 |

## Reproduction and raw records

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec tsx comparisons/budget/check-analysis.ts
pnpm exec tsx comparisons/budget/full-control.ts
pnpm exec tsx comparisons/budget/numeric-control.ts
pnpm exec tsx comparisons/budget/full-suite-control.ts
pnpm exec tsx comparisons/budget/reachability.ts
pnpm exec tsx comparisons/budget/time-balance-tests.ts
python3 comparisons/budget/audit-results.py
python3 comparisons/budget/report.py
```

- [Selected grid, seeds, witnesses and paired tests](full-results.json)
- [Numeric summaries and paired tests](numeric-results.json)
- [Whole-suite seed-1 records](full-suite-results.json)
- [Exhaustive conversation routing and task witnesses](reachability-results.json)
- [Exact wall-time and balance paired tests](time-balance-results.json)
- [Numeric raw trials, budget 20](numeric-20-samples.json)
- [Numeric raw trials, budget 50](numeric-50-samples.json)
- [Numeric raw trials, budget 100](numeric-100-samples.json)
- [Numeric raw trials, budget 200](numeric-200-samples.json)

The budget-20 hybrid and random grid is checked seed by seed against the retained earlier records. The current Acme map hash is `6d29ed7a7539`; the retained controls use `b583de68c530`. All 30 selected-index, fault, pair, complete-row and incomplete-row records match those controls. Exact-test checks use independent exhaustive enumeration on mixed-sign small cases. The interval critical value is checked by independently integrating the Student t density. Pure pairwise is a practical baseline with different row construction, not a count-balancing ablation.
