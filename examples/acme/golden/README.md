# Acme golden set

Ten gated Acme conversations, chosen by `driftbench select` from the gate's output. Fictional data only. Do not edit these files by hand: select again.

```
pnpm driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --k 10 --out examples/acme/golden --force
```

## How the ten were chosen

1. The pool is every gated spec under `examples/acme/gated` that no gate seal lists: 139 specs. The 36 sealed specs never enter it.
2. The cells are the allowed pairs of the map: every pair of values on every two dimensions, after the constraints. There are 840. The pool covers 592 of them.
3. The cover is greedy set cover on those cells, with the required cells first. It takes 86 conversations to cover all 592.
4. Ten is smaller than the cover, so the golden set is the ten best. Each pick takes the spec that adds the most required cells, then the most faults no earlier pick turns red, then the most cells. The faults come from the gate reports.

## What the ten cover

| Measure | Golden set | Whole pool |
|---|---|---|
| Allowed pairs covered | 303 of 840 | 592 of 840 |
| Allowed triples covered | 748 of 7208 | not measured here |
| Required cells covered | 9 of 10 | 9 of 10 |
| Faults turned red | 9 of 9 | 9 of 9 |

The tenth required cell, the price-sheet flow with an instruction in the data, is covered only by a sealed spec. No unsealed spec can bring it into a golden set, so `select` exits 1.

The ten run green on the Acme sales agent: `pnpm driftbench campaign run examples/acme/golden --target function:acme-sales` passes 10 of 10.

## The files

| File | What it holds |
|---|---|
| `specs/` | The ten gated specs, copied unchanged. Run a campaign on this folder. |
| `golden.json` | The rule, the pool, the full cover in pick order, each golden spec with its hash and what it adds, and the coverage of the golden set. |
