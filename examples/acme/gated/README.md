# Acme gated suite

The output of the validity gate on the Acme candidates, written by `driftbench gate`. Fictional data only. Do not edit these files by hand: gate the candidates again.

## The generated suite (this folder)

```
pnpm driftbench gate examples/acme/generated/specs \
  --reference function:acme-sales --reference process:acme-ops \
  --route flow:price-sheet=process:acme-ops \
  --faults examples/acme/faults --origin examples/acme/specs \
  --date 2026-10-11 --out examples/acme/gated --force
```

Every generated block passes the gate: 814 of 814, in 168 specs (134 in `specs/`, 34 sealed in `holdout/`). The generator now derives every Then from the map's relations (the path's next stage, the tool calls and their inputs, the end state, the recovery of a deviation class), so no block holds judged criteria alone and none is passed by a trivial agent. `gate-report.json` holds the funnel and the verdict of every stage for every block.

What kills the planted faults, from the report:

- Every block reads the reply language the map fixes (English), so the fault that answers in French is red on all 814.
- 330 blocks are also red on another fault: skipping the recap (226), dropping the coverage check (71), ordering on a loose yes (64), ignoring a goal shift (22), hiding a tool failure (18), obeying an instruction in a message (13), answering a billing matter itself (13).
- 484 blocks are red on the language fault only.
- No block reads a price, so the fault that invents prices is never red: the X1 class scores 0 of 1. No generated conversation corrects an earlier email, and no complete spec runs on the ops agent, so those faults are equivalent here.

## The hand-written control (control-handwritten/)

The same gate on the seven hand-written Acme specs, to show what an accepted block looks like:

```
pnpm driftbench gate examples/acme/specs \
  --reference function:acme-sales --reference process:acme-ops \
  --faults examples/acme/faults --date 2026-10-11 --out examples/acme/gated/control-handwritten --force
```

24 of 28 blocks pass. Two fail the leakage stage (the number to port, `+12025550150`, is already in the Given) and two pass on the echo agent. With the leakage rule the lead set, three blocks the first run rejected now pass: the customer's own email in the When is a tool input the user supplies, exempt; `home` and `new` are enum words of four letters or fewer, ignored. The gated specs are in `control-handwritten/specs/`, and two specs are sealed in `control-handwritten/holdout/`.

## The files

| File | What it holds |
|---|---|
| `specs/` | The gated specs. Run a campaign on this folder, not on the whole output folder. |
| `holdout/` | Gated specs sealed for a later, single scoring. `seal.json` lists their content hashes. |
| `gate-report.json` | The funnel, the mutation score per fault class and per fault, and every block with each stage's verdict. |
| `review.yaml` | Blocks whose outcome flips between repeats on the reference, for a person to decide. |
| `label-audit.yaml` | A seeded sample of each family of gated blocks, for a person to check against the spec. |
