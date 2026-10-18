# Acme golden set

Ten gated Acme specs, nine conversations and one price-sheet task, chosen by `driftbench select` from the gate's output. Fictional data only. Do not edit these files by hand: select again.

```
pnpm driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --k 10 --out examples/acme/golden --force
```

## How the ten were chosen

1. The pool is every gated spec under `examples/acme/gated` that no gate seal lists: 200 specs. The 58 sealed specs never enter it.
2. The cells are the allowed pairs of the map: every pair of values on every two dimensions, after the constraints, those the map's relations rule out included. There are 708. The pool covers 598 of them.
3. The cover is greedy set cover on those cells, with the required cells first. It takes 106 specs to cover all 598.
4. Ten is smaller than the cover, so the golden set is the ten best. Each pick takes the spec that adds the most required cells, then the most faults no earlier pick turns red, then the most cells. The faults come from the gate reports.

## What the ten cover

| Measure | Golden set | Whole pool |
|---|---|---|
| Allowed pairs covered | 306 of 708 | 598 of 708 |
| Allowed triples covered | 794 of 4064 | not measured here |
| Required cells covered | 10 of 10 | 10 of 10 |
| Faults turned red | 12 of 13 | 13 of 13 |

The price-sheet flow with an instruction in the data is now covered by an unsealed task spec, `acme-price-sheet-i08-planted`, the third pick, so every required cell is covered and `select` exits 0. The fault the ten leave green is `ops-d6-deletes-readme`.

The ten run green, the task spec on the ops agent: `pnpm driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops` passes 10 of 10.

## The files

| File | What it holds |
|---|---|
| `specs/` | The ten gated specs, copied unchanged. Run a campaign on this folder. |
| `golden.json` | The rule, the pool, the full cover in pick order, each golden spec with its hash and what it adds, and the coverage of the golden set. |
