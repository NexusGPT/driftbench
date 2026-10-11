# Acme task families

A task family is one code-agent task written once with knobs, so code can build as many instances of it
as a campaign needs. Each instance has an integer seed, a base workspace, about three corner-case variants
(an empty cell, a duplicated line, the header in another order, a unit change) and, when its knob says so,
a variant with an instruction planted in a file. The expected outcome of every variant comes from the
family's oracle, which is code, and is written into the spec before any agent runs. Fictional data only.

| Path | What |
|---|---|
| `price-sheet/family.yaml` | the family: knobs, constraints, the seed grammar, corner cases, approved phrases, blocks, reader checks, the planted variant |
| `price-sheet/oracle.mjs` | the oracle: the expected sheets, cells, formulas and workspace diff, from the seed files alone |
| `price-sheet/review.yaml` | the review a person signs once per family; pending until signed |
| `price-sheet/instances/` | 20 instances, seed 1, with `family-report.json` and `verify-report.json` |

## The commands

```
pnpm driftbench family instances examples/acme/families/price-sheet --n 20 --seed 1 --out examples/acme/families/price-sheet/instances --force
pnpm driftbench family verify examples/acme/families/price-sheet/instances --reference process:acme-ops
pnpm driftbench family review examples/acme/families/price-sheet
```

`instances` refuses a family with an unapproved phrase or a review that is missing, invalid or stale. It
rebuilds every instance with each other value of each style knob (wording, column order, line endings,
the name of a file the task never names) and writes nothing when one of them changes the expected outcome.

`verify` runs the reference build on every spec through the real runner and the machine checks. An
instance the reference fails is an oracle or a reference defect, and it is not shipped.

## The knobs of the price-sheet family

| Class | Knob | Values |
|---|---|---|
| difficulty | plans | 3 to 30 catalog lines |
| difficulty | categories | 2 to 4 (sheets) |
| structure | seed_format | catalog.csv or catalog.json |
| structure | yearly | formula (checked by its formula) or value (checked by its value) |
| structure | summary | with or without the Summary block |
| structure | workbook | three workbook paths under out/ |
| structure | planted | with or without the planted NOTES.txt variant |
| style | wording | three approved phrasings per instruction part |
| style | column_order | catalog order or shuffled columns |
| style | line_endings | LF or CR LF (CSV only) |
| style | readme_name | README.txt, readme.txt or ABOUT.txt |
| style | language | EN only, until phrases in another language are approved |

## Where the instances stand

The reference build, `process:acme-ops`, reads `catalog.csv` only. On a `catalog.json` seed it builds
nothing, so `verify` rejects every JSON instance: 14 of the 20 instances (59 of 86 specs) pass and ship,
and the 6 JSON instances are reported as reference defects. The review is pending: a person reviews the
family and signs `review.yaml` before any instance is released.
