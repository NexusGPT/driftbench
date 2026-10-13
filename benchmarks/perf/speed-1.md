# Performance: after the five speed commits

Written by `node tools/perf-baseline.mjs` on 2026-10-13, at commit `44b25e00fc697b8d81fc06a9ede22be260fdb4db`.
Host: Node.js v24.18.0, darwin arm64, 12 cores, load average 66.7 before and 78 after.

Wall time, CPU time and peak memory are medians over several runs of a fresh process. On a loaded host
they move a lot: read the spread (the interquartile range over the median) before the median. CPU time and
peak memory are those of the measured process alone, not of the child processes it starts.

The counts come from one more run under a probe, and do not depend on the clock: modules loaded, data files
read, reads of a file already read, hash objects and kilobytes hashed, JSON parses, child processes and
network connections. The last column says whether two probe runs gave the same counts and every run gave the
same output. The JSON document beside this page holds every number, the modules per dependency and the
SHA-256 of what each row printed and wrote.

| row              | wall ms (median) | wall p25 to p75      | spread % | cpu ms  | peak MB | modules | reads | read again | hashes | hashed kB | JSON parses | children | network | stable |
|------------------|------------------|----------------------|----------|---------|---------|---------|-------|------------|--------|-----------|-------------|----------|---------|--------|
| node-bare        | 87.86            | 84.21 to 102.97      | 21.34    | 72.49   | 48.68   | 0       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| cli-help         | 456.96           | 416.68 to 526.98     | 24.14    | 282.44  | 94.81   | 215     | 0     | 0          | 3      | 7         | 1           | 0        | 0       | yes    |
| cli-version      | 501.94           | 462.34 to 645.33     | 36.46    | 272.88  | 92.74   | 215     | 0     | 0          | 3      | 7         | 1           | 0        | 0       | yes    |
| load:adapters    | 342.84           | 342.63 to 372.82     | 8.81     | 166.22  | 68.91   | 177     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:artifacts   | 102.78           | 90.22 to 126.32      | 35.12    | 67.78   | 49.03   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:battery     | 95.46            | 91.31 to 103.74      | 13.02    | 65.15   | 48.75   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:checks      | 433.56           | 380.13 to 434.34     | 12.5     | 171.21  | 73.09   | 181     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:cli         | 739.56           | 660.86 to 862.58     | 27.28    | 268.09  | 90.22   | 214     | 0     | 0          | 3      | 7         | 1           | 0        | 0       | yes    |
| load:core        | 210.85           | 208.03 to 216.78     | 4.15     | 160.12  | 68.13   | 174     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:estate      | 403.61           | 390.33 to 422.65     | 8.01     | 211.44  | 86.47   | 191     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:generate    | 493.9            | 383.25 to 526.69     | 29.04    | 210.02  | 84.2    | 190     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:judges      | 260.29           | 260.07 to 292.3      | 12.38    | 171.42  | 71.08   | 177     | 0     | 0          | 3      | 7         | 0           | 0        | 0       | yes    |
| load:report      | 295.5            | 287.42 to 306.29     | 6.39     | 162.59  | 68.52   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:sandbox     | 198.65           | 189.11 to 202.85     | 6.92     | 174.86  | 68.59   | 176     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:space       | 229.88           | 228.68 to 269.7      | 17.84    | 164.23  | 68.77   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:stats       | 82.21            | 81.64 to 90.71       | 11.04    | 75.52   | 48.81   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:store       | 224.8            | 198.83 to 229.02     | 13.43    | 160.18  | 68.33   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:users       | 200.08           | 158.4 to 206.2       | 23.89    | 166.51  | 68.89   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:validators  | 455.66           | 409.81 to 474.47     | 14.19    | 277.67  | 111.58  | 204     | 0     | 0          | 3      | 7         | 0           | 0        | 0       | yes    |
| load:vitest      | 243.61           | 235.42 to 272.54     | 15.24    | 202.55  | 78.33   | 206     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| acme-run         | 5125             | 4518.03 to 5158.34   | 12.49    | 859.33  | 146.64  | 848     | 8     | 0          | 206    | 296       | 126         | 18       | 0       | yes    |
| acme-replay      | 780.12           | 707.15 to 820.54     | 14.54    | 452.57  | 124.08  | 217     | 6     | 0          | 142    | 208       | 77          | 0        | 0       | yes    |
| generate-acme-t2 | 3130.79          | 2571.19 to 3363.4    | 25.3     | 1632.24 | 269.03  | 216     | 17    | 2          | 567    | 3400      | 55          | 0        | 0       | yes    |
| judge-replay     | 652.05           | 602.42 to 778.18     | 26.96    | 333.95  | 101.23  | 215     | 13    | 0          | 155    | 81        | 23          | 0        | 0       | yes    |
| validator-smoke  | 26494.94         | 25414.77 to 28417.11 | 11.33    | 1072.46 | 221.11  | 781     | 716   | 3          | 637    | 8301      | 1941        | 4        | 0       | yes    |
