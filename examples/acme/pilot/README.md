# The Acme variance pilot

Where the spread of pass results comes from on the Acme sales assistant, by source, and the noise floor
every difference between two agent versions is read against. Everything here runs in process: no model
is called and nothing is billed. Fictional data only.

| Path | What it is |
|---|---|
| `acme/pilot-report.json` | the pilot on the deterministic Acme agent, `function:acme` |
| `acme-random/pilot-report.json` | the pilot on the seeded random control, `function:acme-random` |
| `random-agent/index.ts` | the control: the Acme agent with failures planted at a known rate per source |

## The design

Per cell of the approved map (`--by behaviour`, the map's first axis: 12 behaviours the suite fills, plus
`-` for the specs that name no behaviour), the first 10 conversations of the generated suite by id, each
through up to 3 approved wordings, each wording run 5 times. A conversation is one generated spec.

A wording is one choice of approved phrase for every block that carries a phrase; wording 0 is the spec as
generated. Another wording is the approved phrase said as the generator would say it:

* its `when` holds in the cell and at the stage the block is said at;
* it states the same `binds` as the generator's own phrase, so the later turns still expect the same plan;
* every `{slot}` is filled from the values the cell binds and the binds said before it.

Every variant is stored as a spec with its factors under `metadata.pilot` (cell, conversation, wording),
and the runner keeps the repeat, so every stored run names all four factors.

| Wordings available | Conversations |
|---|---|
| 1 | 2 |
| 2 | 53 |
| 3 | 72 |

The wording level rests on 125 conversations with two or more (197 degrees of freedom).

## How it was made

```sh
pnpm driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs
pnpm driftbench pilot run --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs \
  --target function:acme --store <db> --out examples/acme/pilot/acme --concurrency 1
pnpm driftbench pilot run --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs \
  --target function:acme-random --store <db> --out examples/acme/pilot/acme-random --concurrency 1
pnpm driftbench pilot analyse --store <db>     # the same analysis again, from the store alone
```

Both runs: 1620 runs over 13 cells, 127 conversations and 324 wordings, none failed to complete.

## What it shows

Variance shares of the pass result (pooled model cell > conversation > wording > repeat; 95% bootstrap
interval over 500 draws of the cells, then conversations inside each):

| Level | Acme, deterministic | Control, `acme-random` |
|---|---|---|
| cell | 0.0% | 0.4% (0.0% to 6.8%) |
| conversation | 0.0% | 13.0% (3.5% to 18.7%) |
| wording | 0.0% | 4.2% (0.0% to 12.0%) |
| repeat | 0.0% | 82.4% (74.9% to 90.1%) |

* **The Acme agent passes every run and has no spread at any level.** Its pass rate is 100.0% over 1620
  runs, and 0 of 1682 blocks flip between repeats. One repeat per block reaches any noise floor. With no
  spread anywhere, the allocation of a 100-conversation pool falls back to proportional.
* **On the control the repeat is the main source.** Its run-to-run variance is 0.1105. A difference between
  two versions of one block reads against a 5% floor after 340 repeats per block, or 34 per block for a
  cell figure over 10 conversations. 1030 of 1682 blocks flip; the mean flip rate is 0.316.
* **The design effect is measured, not assumed.** On the control, two runs of one conversation correlate at
  0.131 inside a cell, so 12.8 runs per conversation give a design effect of 2.54.
* **No cell is wording-sensitive** on either agent (a range above 20% with the cell's wording F test
  holding at a false discovery rate of 0.05).

## The fix of 2026-10-11

An earlier pilot swapped in another approved phrase's raw text. A `{slot}` stayed unfilled, and the
phrase's `when` and `binds` were ignored, so a turn could name another plan than the later turns expect.
The deterministic Acme agent then passed 60.2% of 1895 runs, and the wording level carried 96.5% of its
spread. That was the defect, not a finding about the agent.

## The control

`random-agent/index.ts` wraps the Acme agent. Each block, a variant of the conversation (its Given and the
user texts so far) is fragile with chance 0.5; a fragile block fails with chance 0.5 and a sturdy one with
chance 0.05, drawn fresh each run. A failed block carries a marker the pilot's control check refuses, and
every block states its chance on its raw output, so the pilot computes the planted variance for the exact
design it ran. A run the Acme agent itself fails counts as a certain failure.

On this seed the planted shares are cell 0.9%, conversation 9.1%, wording 7.1% and repeat 82.9%, each
inside its interval.
Across the seeds 1 to 8 (`function:acme-random-1` to `-8`, same design and options), every planted share
lies inside its interval too: 32 of 32 level checks. The test suite runs those eight seeds.

The control hands out its run draws in the order sessions open, so its report is reproducible only with
`--concurrency 1`.
