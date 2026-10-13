# Performance: after the speed commits

Written by `node tools/perf-baseline.mjs` on 2026-10-13, at commit `f87605638c794d4c98e1ac0eb72e65c6d5caf45a`.
Host: Node.js v24.18.0, darwin arm64, 12 cores, load average 84.7 before and 71 after.

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
| node-bare        | 89.64            | 83.7 to 109.46      | 28.74    | 71.87   | 48.7    | 0       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| cli-help         | 366.81           | 353.52 to 416.4     | 17.14    | 270.93  | 94.61   | 215     | 0     | 0          | 3      | 7         | 1           | 0        | 0       | yes    |
| cli-version      | 321.92           | 304.75 to 332.09    | 8.49     | 271.49  | 94.42   | 215     | 0     | 0          | 3      | 7         | 1           | 0        | 0       | yes    |
| load:adapters    | 175.51           | 171.29 to 191.25    | 11.37    | 169.34  | 69.05   | 177     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:artifacts   | 89.97            | 78.28 to 93.77      | 17.22    | 72.18   | 48.98   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:battery     | 91.64            | 84.85 to 103.91     | 20.8     | 71.44   | 48.75   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:checks      | 185.17           | 184.21 to 202.14    | 9.68     | 173.09  | 73.38   | 181     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:cli         | 355              | 337.72 to 368.88    | 8.78     | 263.8   | 93.53   | 214     | 0     | 0          | 3      | 7         | 1           | 0        | 0       | yes    |
| load:core        | 159.5            | 148.65 to 165.4     | 10.5     | 161.6   | 68.25   | 174     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:estate      | 251.51           | 222.39 to 275.94    | 21.29    | 215.6   | 86.22   | 191     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:generate    | 209.85           | 206.33 to 211.29    | 2.36     | 192.46  | 83.98   | 190     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:judges      | 194.56           | 158.43 to 198.27    | 20.48    | 178.77  | 71.44   | 177     | 0     | 0          | 3      | 7         | 0           | 0        | 0       | yes    |
| load:report      | 180.11           | 165.47 to 180.4     | 8.29     | 165.8   | 68.5    | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:sandbox     | 177.21           | 164.91 to 177.5     | 7.1      | 160.15  | 68.61   | 176     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:space       | 161.28           | 159.33 to 168.89    | 5.93     | 165.69  | 68.7    | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:stats       | 83.07            | 75.41 to 89.98      | 17.53    | 72.91   | 48.92   | 1       | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:store       | 248.87           | 168.8 to 256.23     | 35.13    | 172.54  | 68.39   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:users       | 190.42           | 152.63 to 211.24    | 30.78    | 163.05  | 68.41   | 175     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| load:validators  | 428.61           | 343.07 to 429.73    | 20.22    | 278.46  | 111.8   | 204     | 0     | 0          | 3      | 7         | 0           | 0        | 0       | yes    |
| load:vitest      | 213.02           | 195.8 to 230.19     | 16.14    | 212.21  | 80.73   | 206     | 0     | 0          | 0      | 0         | 0           | 0        | 0       | yes    |
| acme-run         | 4345.54          | 4129.78 to 4673.11  | 12.5     | 812.4   | 144.77  | 848     | 8     | 0          | 206    | 296       | 126         | 18       | 0       | yes    |
| acme-replay      | 453.89           | 392.35 to 489.62    | 21.43    | 430.58  | 124.03  | 217     | 6     | 0          | 142    | 208       | 77          | 0        | 0       | yes    |
| generate-acme-t2 | 2461.24          | 2444.46 to 3061.75  | 25.08    | 1392.87 | 267.58  | 216     | 17    | 2          | 567    | 3400      | 55          | 0        | 0       | yes    |
| judge-replay     | 594.15           | 577.14 to 611.17    | 5.73     | 298.37  | 105.31  | 215     | 13    | 0          | 155    | 81        | 23          | 0        | 0       | yes    |
| validator-smoke  | 27437.2          | 27113.1 to 30187.69 | 11.21    | 1021.19 | 218.77  | 784     | 719   | 3          | 640    | 8329      | 1944        | 4        | 0       | yes    |
