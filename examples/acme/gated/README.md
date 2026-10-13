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

Every generated block but six passes the gate: 1101 of 1107, in 251 specs (195 in `specs/`, 56 sealed in `holdout/`). The six rejected blocks are first-turn probes the echo agent passes: the recovery word the map gives D1 is in the user's own question. The generator derives every Then from the map's relations (the path's next stage, the tool calls and their inputs, what the reply states, the end state, the recovery of a deviation class), and the price-sheet task specs take theirs from the family's oracle, so no block holds judged criteria alone. `gate-report.json` holds the funnel and the verdict of every stage for every block.

Resealed on 2026-10-12: the generator gained the task seeder, which builds the price-sheet task specs from the map's `task_family` relation, so this run seals a new holdout of 58 specs. The select, holdout and ci commands and the golden set read it; their examples were measured again on this run.

What kills the planted faults, from the report:

- 1054 accepted blocks are conversations on the sales agent. Every one reads the reply language the map fixes (English), so the fault that answers in French is red on all 1054.
- 520 of them are also red on another fault: skipping the recap (292), quoting prices five dollars above the catalog (156), dropping the coverage check (117), ordering on a loose yes (61), ignoring a goal shift (31), hiding a tool failure (18), obeying an instruction in a message (15), answering a billing matter itself (14). 534 are red on the language fault only.
- 47 accepted blocks are price-sheet task specs, run on the ops agent through the route. Narrating instead of writing the workbook and skipping the check are red on all 47, a wrong price in the workbook on 43, and deleting the README on 25, the planted variants among them.
- No generated conversation corrects an earlier email, so `x2-keeps-first-email` is equivalent here. Every other fault is killed.

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
