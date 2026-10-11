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

Per cell of the approved map (`--by behaviour`, the map's first axis: 14 behaviours, plus `-` for the
deviation and metamorphic specs that name no behaviour), the first 10 conversations of the generated suite
by id, each through up to 3 approved wordings, each wording run 5 times. A conversation is one generated
spec. A wording is one choice of approved phrase for every block that carries a phrase; wording 0 is the
spec as generated. Every variant is stored as a spec with its factors under `metadata.pilot` (cell,
conversation, wording), and the runner keeps the repeat, so every stored run names all four factors.

The approved phrase bank holds one phrase for most values, so most conversations have one wording:

| Wordings available | Conversations |
|---|---|
| 1 | 120 |
| 2 | 29 |
| 3 | 1 |

The wording level is identified by the 30 conversations with two or more (31 degrees of freedom). More
approved phrases per value would sharpen it.

## How it was made

```sh
pnpm driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs
pnpm driftbench pilot run --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs \
  --target function:acme --store <db> --out examples/acme/pilot/acme --concurrency 1
pnpm driftbench pilot run --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs \
  --target function:acme-random --store <db> --out examples/acme/pilot/acme-random --concurrency 1
pnpm driftbench pilot analyse --store <db>     # the same analysis again, from the store alone
```

Both runs: 905 runs over 15 cells, 150 conversations and 181 wordings, none failed to complete.

## What it shows

Variance shares of the pass result (pooled model cell > conversation > wording > repeat; 95% bootstrap
interval over 500 draws of the cells, then conversations inside each):

| Level | Acme, deterministic | Control, `acme-random` |
|---|---|---|
| cell | 0.0% (0.0% to 21.6%) | 4.1% (1.3% to 13.8%) |
| conversation | 100.0% (0.0% to 100.0%) | 5.3% (0.0% to 19.0%) |
| wording | 0.0% (0.0% to 0.0%) | 21.9% (4.1% to 39.0%) |
| repeat | 0.0% (0.0% to 0.0%) | 68.7% (54.4% to 78.0%) |

* **The Acme agent has no run-to-run variance.** 0 of 319 blocks flip between repeats, so one repeat per
  block reaches any noise floor. Its only spread is two conversations that fail every run on the
  `lang.expected` check, one in B-002 and one in B-009, whatever the wording. The Neyman allocation of a
  100-conversation estimation pool therefore goes to those two cells, 50 each.
* **The design effect is measured, not assumed.** Two runs of one Acme conversation always agree (within
  cell correlation 1.0), so 6.03 runs per conversation count as one: design effect 6.03, 150 effective
  runs out of 905. On the control the correlation is 0.056 and the design effect 1.28.
* **On the control the repeat is the main source.** Its run-to-run variance is 0.168, so a difference
  between two versions of one block reads against a 5% floor only after 517 repeats per block, or 52 per
  block for a cell figure over 10 conversations. 183 of 319 blocks flip; the mean flip rate is 0.285.
  Four cells are flagged wording-sensitive (a range above 20% and the cell's wording F test holding at a
  false discovery rate of 0.05): B-002, B-005, B-006 and B-010.

## The control

`random-agent/index.ts` wraps the Acme agent. Each block, a variant of the conversation (its Given and the
user texts so far) is fragile with chance 0.5; a fragile block fails with chance 0.5 and a sturdy one with
chance 0.05, drawn fresh each run. A failed block carries a marker the pilot's control check refuses, and
every block states its chance on its raw output, so the pilot computes the planted variance for the exact
design it ran. A run the Acme agent itself fails counts as a certain failure.

On this seed the planted shares are cell 0.7%, conversation 10.3%, wording 18.1% and repeat 71.0%. Three
lie inside their intervals; the cell share does not (0.7% against 1.3% to 13.8%). A 95% interval misses
about one level in twenty by chance. Across the seeds 1 to 8 (`function:acme-random-1` to `-8`, same
design and options), every planted share lies inside its interval: 32 of 32 level checks, 35 of 36 with
this seed. The test suite runs those eight seeds.

The control hands out its run draws in the order sessions open, so its report is reproducible only with
`--concurrency 1`.
