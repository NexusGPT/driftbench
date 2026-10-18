---
title: "Monitor drift over time"
summary: "Watch pass rate, cost or latency across the campaigns of a store, or production traces, and alarm when two of three detectors agree."
commands:
  - monitor
see_also:
  - results-statistics
  - results-ci
  - results-exports
next:
  - results-radius
---

## What it is

`driftbench monitor` reads a series of points and looks for a shift with three detectors:

* a two-sided CUSUM (allowance k 0.5 sd, threshold h 5 sd);
* a two-sided Page-Hinkley test (delta 0.5 sd, lambda 5 sd);
* a sliding two-sample Kolmogorov-Smirnov test between the `--window` points before each index and the
  `--window` points from it, each split tested at 0.05 divided by the number of splits.

It alarms when two of the three alarm, because one detector alone false-alarms too often on a short
warmup. The series is one of two sources:

* `--source store` (default): one point per campaign of `--store`, oldest first by creation time. The
  value is the share of runs that pass (`pass_rate`), the mean cost per run (`cost`) or the mean latency
  per run (`latency`). A campaign with no run is left out and named.
* `--source traces <path>`: production traces cut into time windows of `--every`. Each window is one
  point: the mean of the metric over its conversations. Traces carry no verdict, so there is no pass rate.

The in-control level comes from the first `--window` points. Its standard deviation is the largest of
three: the spread of those values, the standard error of each point from its own runs, and a floor for the
metric (pass rate 0.005, cost 1e-6, latency 1 ms, tokens 1, tool calls 0.01, tool errors 0.005, turns 0.05,
or 1% of the in-control mean when larger).

## When to use it

On a schedule, after each nightly campaign into the same store, to catch a slow drift no single `ci` run
shows. On production traces, to catch a latency, cost or tool error shift in live traffic.

## Commands and every option

```
driftbench monitor --store <file> --metric pass_rate|cost|latency [--window <n>] [--series] [--json]
driftbench monitor --source traces <path> --metric <metric> [--from otel|nexus|claude-code] [--every <duration>] [--window <n>] [--prices <file>] [--series] [--json]
```

| Argument or option | Default | Meaning |
|---|---|---|
| `[path]` | none | with `--source traces`: a trace file or a folder of them. Refused with `--source store` |
| `--store <file>` | none; required with `--source store` | the store whose campaigns form the series |
| `--source <kind>` | `store` | `store` or `traces` |
| `--from <source>` | `otel` | with `--source traces`: `otel` (OpenTelemetry GenAI spans), `nexus` or `claude-code` |
| `--every <duration>` | `1h` | with `--source traces`: the time window of one point, a whole number and `s`, `m`, `h` or `d` |
| `--prices <file>` | none | with `--source traces`: JSON prices per million tokens by model, for `cost` |
| `--metric <metric>` | required | store: `pass_rate`, `cost`, `latency`. Traces: `latency` (mean turn latency, ms), `cost` (USD, when every turn has a cost), `tokens`, `tool_calls` (per turn), `tool_errors` (share of failed calls), `turns` |
| `--window <n>` | `20` | points that set the in-control level, and the length of each KS segment; at least 2. The series needs at least twice as many points |
| `--series` | off | also print every point with its statistics |
| `--json` | off | print one JSON document |

Global: `--plugin <module>`.

| Exit | When |
|---|---|
| 0 | no shift: fewer than two detectors alarmed |
| 1 | a shift: two or three detectors alarmed |
| 2 | bad input: an unknown metric for the source, no store or no path, a bad `--every` or `--window`, too few points |

## Inputs

A store with at least `2 x --window` campaigns that have runs (4 at `--window 2`, 40 at the default), or
traces that fill at least that many windows.

## Outputs and how to read them

* The first line names the metric, the number of points, the source and the window.
* `In control (the first n): mean ..., sd ... (<which of the three set it>)`, then the detector settings.
* A table with one row per detector: the index of its first alarm, the campaign (or window) and its
  creation time, the direction (`up` or `down`) and a detail (for CUSUM where the shift began and how many
  alarms; for KS the largest D statistic, where, and its p).
* With `--series`: every point with its value, runs, the CUSUM up and down statistics and the
  Page-Hinkley up and down statistics.
* `Alert at <index> (<time>), when <detector> and <detector> had both alarmed.` on a shift: the point
  where the second detector first alarmed.
* `Shift detected: <n> of 3 detectors alarmed. Exit 1.` or `No shift: <n> of 3 detectors alarmed, 2
  needed. Exit 0.`

`--json` holds `metric`, `store` (or the trace path), `window`, `campaigns`, `skipped`, `inControl`,
`series` (each point: `index`, `campaignId`, `createdAt`, `runs`, `value`, `se`, `cusumUp`, `cusumDown`,
`phUp`, `phDown`), `cusum`, `pageHinkley`, `ks` (each with its alarms), `votes`, `alarm` and, on a shift,
`alert` (`index`, `campaignId`, `createdAt`, `detectors`).

Measured on 200 synthetic series of 60 campaigns of 20 runs each, pass rate 90% with binomial noise,
window 20 (`packages/cli/test/monitor.test.ts`): with no shift, 16 of 200 series exit 1; with a drop to 60%
at campaign 30, 193 of 200 exit 1. These rates hold for that series shape only.

## Worked example

Four campaigns in one store: two clean runs of the Acme sales assistant, then two `ci` runs where planted
faults stand in for it. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations --store watch.db --campaign c-1
driftbench monitor --store watch.db --metric pass_rate --window 2 # exit 2
driftbench campaign run examples/acme/specs/conversations --store watch.db --campaign c-2 --agent-version acme-v2
driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --baseline c-1 --store watch.db --out ci-3.json # exit 1
driftbench ci --specs examples/acme/specs/conversations --target fault:x4-wrong-language --faults examples/acme/faults --baseline c-1 --store watch.db --out ci-4.json # exit 1
driftbench monitor --store watch.db --metric pass_rate --window 2 --series # exit 1
driftbench monitor --store watch.db --metric latency --window 2
driftbench monitor --source traces packages/adapters/test/traces/fixtures/nexus-traces.jsonl --from nexus --metric latency --every 1s --window 2 # exit 2
```

With one campaign the monitor cannot decide, and says so:

```text
$ driftbench monitor --store watch.db --metric pass_rate --window 2
The store holds 1 campaign with runs; --window 2 needs at least 4. Nothing is wrong with the store: the monitor cannot decide on so few points. Run more campaigns into it: the smallest window, --window 2, needs 4.
(exit 2)
```

After four campaigns, on the pass rate:

```text
$ driftbench monitor --store watch.db --metric pass_rate --window 2 --series
driftbench monitor: pass_rate over 4 campaigns of watch.db, oldest first. Window 2.
In control (the first 2): mean 100.0%, sd 1.0% (the floor of the metric). CUSUM k 0.5 sd, h 5 sd; Page-Hinkley delta 0.5 sd, lambda 5 sd; KS segments of 2, alpha 0.05 over the splits scanned.
  detector      first alarm  campaign        created                   direction  detail
  CUSUM         2            c-0edd29934e63  2026-10-14T14:03:57.848Z  down       shift began at 2; 2 alarms in all
  Page-Hinkley  2            c-0edd29934e63  2026-10-14T14:03:57.848Z  down       1 alarm in all
  KS            none                                                              largest D 1.00 at 2, p 0.33

  index  campaign        created                   pass_rate  runs  cusum up  cusum down  ph up  ph down
  0      c-1             2026-10-14T14:03:23.567Z  100.0%     6     0.00      0.00        0.0%   0.0%
  1      c-2             2026-10-14T14:03:51.931Z  100.0%     6     0.00      0.00        0.0%   0.0%
  2      c-0edd29934e63  2026-10-14T14:03:57.848Z  50.0%      6     0.00      49.50       0.0%   32.8%
  3      c-828cb2e673e4  2026-10-14T14:04:03.416Z  0.0%       6     0.00      99.50       0.0%   0.0%

Alert at 2 (2026-10-14T14:03:57.848Z), when CUSUM and Page-Hinkley had both alarmed.
Shift detected: 2 of 3 detectors alarmed. Exit 1.
(exit 1)
```

On latency the same store shows no shift:

```text
$ driftbench monitor --store watch.db --metric latency --window 2
driftbench monitor: latency over 4 campaigns of watch.db, oldest first. Window 2.
In control (the first 2): mean 1000 ms, sd 1000 ms (the standard error of each campaign from its runs). CUSUM k 0.5 sd, h 5 sd; Page-Hinkley delta 0.5 sd, lambda 5 sd; KS segments of 2, alpha 0.05 over the splits scanned.
  detector      first alarm  campaign  created  direction  detail
  CUSUM         none
  Page-Hinkley  none
  KS            none                                       largest D 0.00 at 2, p 1.0

No shift: 0 of 3 detectors alarmed, 2 needed. Exit 0.
```

The committed trace fixture holds too few conversations for two windows of two points, so the command
exits 2 and says why:

```text
$ driftbench monitor --source traces packages/adapters/test/traces/fixtures/nexus-traces.jsonl --from nexus --metric latency --every 1s --window 2
The traces fill 2 windows of 1s with latency; --window 2 needs at least 4. Nothing is wrong with the traces: the monitor cannot decide on so few points. Read more traces, or pass a shorter --every: the smallest window, --window 2, needs 4.
(exit 2)
```

## Common errors

| Message | Cause and fix |
|---|---|
| `The store holds <n> campaigns with runs; --window <w> needs at least <2w>.` (exit 2) | a young store, not a broken one. Run more campaigns, or lower `--window` (the smallest, 2, needs 4) |
| `--metric takes pass_rate, cost, latency, not "tokens".` (exit 2) | trace metrics are for `--source traces` only |
| `A path is read with --source traces; a store is named with --store.` (exit 2) | add `--source traces`, or drop the path |
| `--source traces needs the path of a trace file or folder.` (exit 2) | give the path |
| `--every takes a whole number and a unit (s, m, h, d), such as 1h` (exit 2) | fix the duration |
| `--window takes a whole number of at least 2` (exit 2) | fix the window |
| `--from takes otel, nexus, claude-code` (exit 2) | fix the trace format |
| one detector alarms but the exit code is 0 | expected: two of three are needed |
