# Performance: round-2

Written by `node tools/perf-baseline.mjs` on 2026-10-13, at commit `004586f91d0ef2d787cf2b71c1888c59b6f126e3`.
Host: Node.js v24.18.0, darwin arm64, 12 cores, load average 47.6 before and 50.2 after.

Wall time, CPU time and peak memory are medians over several runs of a fresh process. On a loaded host
they move a lot: read the spread (the interquartile range over the median) before the median. CPU time and
peak memory are those of the measured process alone, not of the child processes it starts.

The counts come from one more run under a probe, and do not depend on the clock: modules loaded, data files
read, reads of a file already read, hash objects and kilobytes hashed, JSON parses, child processes and
network connections. The last column says whether two probe runs gave the same counts and every run gave the
same output. The JSON document beside this page holds every number, the modules per dependency and the
SHA-256 of what each row printed and wrote.

| row              | wall ms (median) | wall p25 to p75     | spread % | cpu ms  | peak MB | modules | reads | read again | hashes | hashed kB | JSON parses | children | network | stable |
|------------------|------------------|---------------------|----------|---------|---------|---------|-------|------------|--------|-----------|-------------|----------|---------|--------|
| node-bare        | 69.03            | 68.31 to 69.57      | 1.82     | 66.51   | 48.59   | 0       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| cli-help         | 86.75            | 84.69 to 89.55      | 5.61     | 82.34   | 50.97   | 14      | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| cli-version      | 87.36            | 84.26 to 92.17      | 9.06     | 85.29   | 50.97   | 14      | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:adapters    | 166.53           | 159.11 to 175.86    | 10.06    | 168.66  | 69.08   | 177     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:artifacts   | 73.27            | 73.01 to 78.74      | 7.83     | 70.09   | 49.09   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:battery     | 74.07            | 73.33 to 78.42      | 6.87     | 71.12   | 48.8    | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:checks      | 170.52           | 166.12 to 188.95    | 13.39    | 162.36  | 68.92   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:cli         | 278.53           | 257.73 to 288.76    | 11.14    | 174.87  | 69.38   | 187     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:core        | 311.29           | 274.46 to 312.89    | 12.35    | 158.29  | 68.33   | 174     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:estate      | 260.16           | 245.47 to 272.31    | 10.32    | 231.57  | 86.64   | 191     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:generate    | 215.33           | 203.46 to 216.02    | 5.84     | 219.23  | 84.17   | 190     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:judges      | 216.17           | 207.35 to 234.1     | 12.38    | 202.75  | 73.58   | 178     | 0     | 0          | 5      | 13        | 1           | 0        | 0       | yes    |
| load:report      | 190.84           | 174.09 to 219.1     | 23.58    | 172.67  | 68.58   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:sandbox     | 186.48           | 184.27 to 194.41    | 5.44     | 181.18  | 68.63   | 176     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:space       | 189.45           | 181.47 to 198.98    | 9.24     | 170.78  | 68.31   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:stats       | 107.98           | 92.51 to 121.96     | 27.28    | 74.87   | 48.94   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:store       | 162.47           | 161.37 to 167.26    | 3.63     | 158.6   | 68.53   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:users       | 176.42           | 172.37 to 203.43    | 17.61    | 165.36  | 69.41   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:validators  | 250.11           | 249.3 to 263.26     | 5.58     | 266.42  | 111.28  | 198     | 0     | 0          | 5      | 13        | 1           | 0        | 0       | yes    |
| load:vitest      | 248.35           | 224.35 to 279.26    | 22.11    | 205.07  | 76.97   | 200     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| acme-run         | 3397.78          | 3167.91 to 3582.69  | 12.21    | 810.66  | 146.25  | 848     | 8     | 0          | 205    | 295       | 125         | 18       | 0       | no     |
| acme-replay      | 735.39           | 664.42 to 792.62    | 17.43    | 396.06  | 115.56  | 217     | 6     | 0          | 141    | 207       | 76          | 0        | 0       | yes    |
| generate-acme-t2 | 2236.2           | 2185.72 to 2327.96  | 6.36     | 1564.61 | 257.33  | 212     | 17    | 2          | 571    | 3426      | 54          | 0        | 0       | yes    |
| judge-replay     | 324.53           | 319.24 to 358.26    | 12.02    | 262.53  | 82.31   | 192     | 13    | 0          | 157    | 89        | 23          | 0        | 0       | yes    |
| validator-smoke  | 23950.97         | 23078.96 to 24658.8 | 6.6      | 1059.9  | 208.81  | 762     | 704   | 3          | 627    | 7979      | 1929        | 4        | 0       | yes    |
