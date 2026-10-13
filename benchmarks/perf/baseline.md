# Performance: baseline at origin/main

Written by `node tools/perf-baseline.mjs` on 2026-10-13, at commit `4aba106f55dc4ce2298b0d215ad9496de28ad38c`.
Host: Node.js v24.18.0, darwin arm64, 12 cores, load average 64.4 before and 68.8 after.

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
| node-bare        | 83.03            | 79.82 to 95.06       | 18.35    | 74.5    | 48.69   | 0       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| cli-help         | 1070.12          | 1002.06 to 1207.5    | 19.2     | 646.86  | 194.1   | 958     | 0     | 0          | 3      | 7         | 3           | 0        | 0       | yes    |
| cli-version      | 930.44           | 903.39 to 1039.35    | 14.61    | 634.49  | 194.56  | 958     | 0     | 0          | 3      | 7         | 3           | 0        | 0       | yes    |
| load:adapters    | 188.96           | 157.58 to 215.11     | 30.44    | 161.14  | 68.7    | 177     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:artifacts   | 568.98           | 537.87 to 660.42     | 21.54    | 425.69  | 126.41  | 747     | 0     | 0          | 0      | 0         | 2           | 0        | 0       | yes    |
| load:battery     | 79.48            | 79.31 to 81.78       | 3.1      | 72.15   | 48.78   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:checks      | 168.16           | 166.83 to 205.4      | 22.94    | 170.23  | 73.38   | 181     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:cli         | 836.69           | 828.57 to 854.45     | 3.09     | 615.04  | 187.63  | 957     | 0     | 0          | 3      | 7         | 3           | 0        | 0       | yes    |
| load:core        | 226.56           | 183.1 to 228.24      | 19.93    | 156.93  | 68.41   | 174     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:estate      | 728.91           | 722.66 to 859.68     | 18.8     | 524.21  | 156.44  | 934     | 0     | 0          | 0      | 0         | 2           | 0        | 0       | yes    |
| load:generate    | 875.52           | 654.04 to 933.27     | 31.89    | 519.08  | 149.16  | 933     | 0     | 0          | 0      | 0         | 2           | 0        | 0       | yes    |
| load:judges      | 938.82           | 770.32 to 943.48     | 18.44    | 498.64  | 143.03  | 920     | 0     | 0          | 3      | 7         | 2           | 0        | 0       | yes    |
| load:report      | 156.49           | 156.05 to 163.66     | 4.86     | 165.15  | 68.61   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:sandbox     | 158.34           | 156.17 to 166.74     | 6.67     | 158.69  | 68.53   | 176     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:space       | 191.78           | 153.83 to 214.6      | 31.69    | 156.72  | 68.42   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:stats       | 87.98            | 78.86 to 93.53       | 16.68    | 72.99   | 48.94   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:store       | 169.7            | 168.02 to 213.62     | 26.87    | 163.74  | 68.27   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:users       | 222.05           | 215.06 to 242.92     | 12.55    | 171.02  | 68.42   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:validators  | 1141.21          | 1106.92 to 1151      | 3.86     | 583.88  | 182.41  | 946     | 0     | 0          | 3      | 7         | 2           | 0        | 0       | yes    |
| load:vitest      | 219.33           | 210.63 to 237.24     | 12.13    | 191.57  | 75.64   | 206     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| acme-run         | 3936.08          | 3775.58 to 4279.22   | 12.8     | 1013.98 | 232.42  | 961     | 8     | 0          | 206    | 296       | 128         | 18       | 0       | yes    |
| acme-replay      | 1518.03          | 1479.47 to 1525.36   | 3.02     | 817.38  | 223.13  | 960     | 6     | 0          | 142    | 208       | 79          | 0        | 0       | yes    |
| generate-acme-t2 | 3367.65          | 3220.7 to 3380.03    | 4.73     | 1980.82 | 330.45  | 959     | 17    | 2          | 567    | 3400      | 57          | 0        | 0       | yes    |
| judge-replay     | 1557.86          | 1263.15 to 1576.37   | 20.11    | 702.08  | 197.2   | 958     | 13    | 0          | 155    | 81        | 25          | 0        | 0       | yes    |
| validator-smoke  | 25546.58         | 25084.21 to 27918.23 | 11.09    | 1755.75 | 410.67  | 810     | 1429  | 3          | 640    | 8325      | 1946        | 4        | 0       | yes    |
