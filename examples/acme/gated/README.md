# Acme gated suite

The output of the validity gate on the Acme candidates, written by `driftbench gate`. Fictional data only. Do not edit these files by hand: gate the candidates again.

## The generated suite (this folder)

```
pnpm driftbench gate examples/acme/generated/specs \
  --reference function:acme-sales --reference process:acme-ops \
  --route flow:price-sheet=process:acme-ops \
  --faults examples/acme/faults --origin examples/acme/specs \
  --date 2026-10-11 --out examples/acme/gated
```

No generated block passes the gate: 0 of 296. `gate-report.json` holds the funnel and the reason for every block.

- 244 blocks hold only judged criteria and no machine check (stage 1, `no-machine-then`).
- 14 blocks read only the reply's format on a cell that is not about wording (stage 1, `words-only`).
- 36 blocks pass on the constant agent: they expect the start stage, English, or one message per turn (stage 3).
- 2 blocks expect a French reply from an agent that answers in English only (stage 5, `not-green-on-reference`).

The `specs/` folder is absent because no spec has an accepted block. `holdout/seal.json` seals an empty holdout.

## The hand-written control (control-handwritten/)

The same gate on the seven hand-written Acme specs, to show what an accepted block looks like:

```
pnpm driftbench gate examples/acme/specs \
  --reference function:acme-sales --reference process:acme-ops \
  --faults examples/acme/faults --date 2026-10-11 --out examples/acme/gated/control-handwritten
```

21 of 28 blocks pass. Five fail the leakage stage and two pass on the echo agent. The gated specs are in `control-handwritten/specs/`, and two specs are sealed in `control-handwritten/holdout/`.

## The files

| File | What it holds |
|---|---|
| `specs/` | The gated specs. Run a campaign on this folder, not on the whole output folder. |
| `holdout/` | Gated specs sealed for a later, single scoring. `seal.json` lists their content hashes. |
| `gate-report.json` | The funnel, the mutation score per fault class and per fault, and every block with each stage's verdict. |
| `review.yaml` | Blocks whose outcome flips between repeats on the reference, for a person to decide. |
| `label-audit.yaml` | A seeded sample of each family of gated blocks, for a person to check against the spec. |
