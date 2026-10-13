# Performance: baseline at origin/main

Written by `node tools/perf-baseline.mjs` on 2026-10-13, at commit `086b60032de6d29f66437dd22da5828546395dac`.
Host: Node.js v24.18.0, darwin arm64, 12 cores, load average 115 before and 163.3 after.

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
| node-bare        | 169.75           | 127.4 to 219.5       | 54.26    | 71.6    | 48.67   | 0       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| cli-help         | 1854.72          | 1724.72 to 2103.4    | 20.42    | 624.81  | 193.57  | 958     | 0     | 0          | 3      | 7         | 3           | 0        | 0       | yes    |
| cli-version      | 1375.87          | 1042.34 to 1490.11   | 32.54    | 622.48  | 193.84  | 958     | 0     | 0          | 3      | 7         | 3           | 0        | 0       | yes    |
| load:adapters    | 212.96           | 200.67 to 288.17     | 41.09    | 157.22  | 69      | 177     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:artifacts   | 833.37           | 828.91 to 847.75     | 2.26     | 418.35  | 126.19  | 747     | 0     | 0          | 0      | 0         | 2           | 0        | 0       | yes    |
| load:battery     | 101.31           | 100.93 to 128.1      | 26.82    | 70.52   | 48.86   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:checks      | 337.73           | 317.86 to 374.52     | 16.78    | 164.62  | 73.13   | 181     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:cli         | 1330.23          | 963.29 to 1413.84    | 33.87    | 614.16  | 188.14  | 957     | 0     | 0          | 3      | 7         | 3           | 0        | 0       | yes    |
| load:core        | 187.9            | 179.35 to 190.14     | 5.74     | 146.68  | 68.33   | 174     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:estate      | 1702.31          | 1492.17 to 1818.66   | 19.18    | 542.27  | 158.03  | 934     | 0     | 0          | 0      | 0         | 2           | 0        | 0       | yes    |
| load:generate    | 1056.4           | 1023.74 to 1231.24   | 19.64    | 505.14  | 154.88  | 933     | 0     | 0          | 0      | 0         | 2           | 0        | 0       | yes    |
| load:judges      | 821.15           | 804.3 to 1005.79     | 24.54    | 464.49  | 143.95  | 920     | 0     | 0          | 3      | 7         | 2           | 0        | 0       | yes    |
| load:report      | 188.39           | 172.3 to 227.59      | 29.35    | 149.53  | 68.3    | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:sandbox     | 170.75           | 157.85 to 173.68     | 9.27     | 143.02  | 68.34   | 176     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:space       | 300.41           | 287.44 to 308.35     | 6.96     | 151     | 68.3    | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:stats       | 84.16            | 81.92 to 86.32       | 5.22     | 69.8    | 49.02   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:store       | 172.14           | 171.03 to 192.32     | 12.36    | 136.84  | 68.27   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:users       | 214.31           | 213.9 to 246.96      | 15.43    | 155.48  | 68.28   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:validators  | 1530.13          | 1447.37 to 1778.61   | 21.65    | 597.24  | 182.94  | 946     | 0     | 0          | 3      | 7         | 2           | 0        | 0       | yes    |
| load:vitest      | 461.5            | 396.75 to 467.84     | 15.4     | 193.93  | 79.66   | 206     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| acme-run         | 4330.08          | 4094.04 to 4331.51   | 5.48     | 945.63  | 231.81  | 961     | 8     | 0          | 206    | 296       | 128         | 18       | 0       | yes    |
| acme-replay      | 1057.43          | 1017.55 to 1424.54   | 38.49    | 804.35  | 222.08  | 960     | 6     | 0          | 142    | 208       | 79          | 0        | 0       | yes    |
| generate-acme-t2 | 4186.27          | 3982.46 to 4435.68   | 10.83    | 1894.52 | 330.8   | 959     | 17    | 2          | 567    | 3400      | 57          | 0        | 0       | yes    |
| judge-replay     | 1806.4           | 1590.89 to 1861.63   | 14.99    | 679.11  | 195.75  | 958     | 13    | 0          | 155    | 81        | 25          | 0        | 0       | yes    |
| validator-smoke  | 31680.52         | 30303.15 to 34614.07 | 13.61    | 1764.54 | 413.02  | 808     | 1427  | 3          | 638    | 8301      | 1944        | 4        | 0       | yes    |
