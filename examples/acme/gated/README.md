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

Every generated block but nine passes the gate: 1092 of 1101, in 225 specs (179 in `specs/`, 46 sealed in `holdout/`). The nine rejected blocks are first-turn probes the echo agent passes: the recovery word the map gives D1 is in the user's own question. The generator derives every Then from the map's relations (the path's next stage, the tool calls and their inputs, what the reply states, the end state, the recovery of a deviation class), so no block holds judged criteria alone. `gate-report.json` holds the funnel and the verdict of every stage for every block.

Resealed on 2026-10-12: the generator gained the cover seeder and the `states` relation, so this run seals a new holdout of 46 specs. The select, holdout and ci commands and the golden set read it; their examples were measured again on this run.

What kills the planted faults, from the report:

- Every block reads the reply language the map fixes (English), so the fault that answers in French is red on all 1092.
- 539 blocks are also red on another fault: skipping the recap (306), quoting prices five dollars above the catalog (162), dropping the coverage check (106), ordering on a loose yes (66), ignoring a goal shift (32), hiding a tool failure (18), obeying an instruction in a message (15), answering a billing matter itself (14).
- 553 blocks are red on the language fault only.
- The turn that enters the offer states each plan with its catalog price, so the fault that invents prices is red: the X1 class scores 1 of 1. No generated conversation corrects an earlier email, and the price-sheet flow has no conversation path, so no complete spec runs on the ops agent: those faults are equivalent here.

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
