# Acme scorecards

Scorecards written by `driftbench report` from stored Acme campaigns. Everything ran in process or in a local sandbox: no model was called and nothing was billed. Fictional data only.

| File | What it is |
|---|---|
| `acme.html`, `acme-junit.xml` | the Acme agents on both targets (`function:acme-sales`, `process:acme-ops`), modes T, F and P, 3 repeats |
| `acme-faults.html`, `acme-faults-junit.xml` | the same campaign with two faults standing in for the agents, read against the first one (`--baseline`, margin 15 points), with the variance pilot of `examples/acme/pilot/acme-random` |
| `pilot-acme-random.html` | the spread view on a small pilot campaign of the seeded random control: cells, conversations and wordings from `metadata.pilot`, so the per-cell intervals, the wording ranges and the noise floor all have data |
| `run-fault-campaign.ts` | the script that stores a campaign with faults of `examples/acme/faults` in place of the Acme agents |

## How they were made

```sh
pnpm driftbench campaign run examples/acme/specs --mode T,F,P --repeats 3 --store <db> --campaign c-acme-proof
pnpm exec tsx examples/acme/reports/run-fault-campaign.ts --store <db> --campaign c-acme-faults-proof \
  --fault x3-skips-recap --fault ops-d6-deletes-readme --mode T,F,P --repeats 3
pnpm driftbench compare --baseline c-acme-proof --candidate c-acme-faults-proof --store <db> --margin 15
pnpm driftbench report c-acme-proof --store <db> --out examples/acme/reports/acme.html \
  --junit examples/acme/reports/acme-junit.xml
pnpm driftbench report c-acme-faults-proof --store <db> --baseline c-acme-proof --margin 15 \
  --pilot examples/acme/pilot/acme-random --max-runs 40 \
  --out examples/acme/reports/acme-faults.html --junit examples/acme/reports/acme-faults-junit.xml
pnpm driftbench pilot run --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs \
  --target function:acme-random --store <pilot-db> --out <dir> --campaign c-pilot-acme-random \
  --conversations 4 --repeats 3 --concurrency 1
pnpm driftbench report c-pilot-acme-random --store <pilot-db> --pilot <dir> --max-runs 30 \
  --out examples/acme/reports/pilot-acme-random.html
```

## What they show

* The comparison finds the faults regressed (exit 1): 14 of 26 paired goldens regressed and none improved, McNemar exact p = 0.0001, and a new `forbidden` or `safety` flag on 14 goldens.
* The Acme agents pass all 78 runs. The fault campaign fails 42 of its 78 runs.
* The same campaign against itself is not shown non-inferior at a 10-point margin (exit 1), and is non-inferior at 15 points (exit 0): 26 goldens can show a margin of 12.9 points at best. A gating criterion decided on fewer than 30 goldens is underpowered and left out of the parity test; `--strict` puts it back.
