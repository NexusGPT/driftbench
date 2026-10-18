# Acme change manifests

Change manifests for `driftbench radius`, one per kind of change the Acme agents can suffer. Fictional data only. Each manifest names a change; the command prints the blocks of a suite that change can affect. See [blast radius](../../../docs/concepts/blast-radius.md).

```
pnpm driftbench radius examples/acme/gated/specs --change examples/acme/radius/stage-recap.yaml
```

| Manifest | The change | The planted fault it stands for |
|---|---|---|
| `stage-recap.yaml` | the recap stage | `x3-skips-recap` |
| `tool-coverage-check-input.yaml` | the input of `coverage.check` | `x5-drops-coverage-check` |
| `tool-coverage-check.yaml` | `coverage.check`, with no part named | none: it shows the conservative default |
| `tool-catalog-search-input.yaml` | the input of `catalog.search` | `x2-keeps-first-email`, which no block of the gated suite sees |
| `states-offer.yaml` | what the offer states: the plans and their prices | `x1-invents-price` |
| `reply-language.yaml` | the reply language rule: the whole suite | `x4-wrong-language` |
| `confirmation-rule.yaml` | what counts as a confirmation at the recap | `d4-order-on-loose-yes` |
| `deviation-goal-shift.yaml` | the D2 handler | `d2-ignores-goal-shift` |
| `deviation-instruction-in-data.yaml` | the D6 handler | `d6-obeys-instruction` |
| `deviation-tool-failure.yaml` | the D8 handler | `d8-hides-tool-failure` |
| `deviation-out-of-scope.yaml` | the D9 handler | `d9-answers-out-of-scope` |
| `price-sheet-family.yaml` | the price sheet task family | the four ops faults |
| `model.yaml` | the model: the whole suite | none |
| `new-tool.yaml` | a tool no block names: the whole suite | none |

`examples/acme/test/radius/contained.test.ts` checks, for every scored fault of `gated/gate-report.json`, that each block the full suite turns red lies inside the radius of its manifest, at the pinned size.

## Running a radius and carrying the rest

`driftbench radius` only prints a radius. `campaign run --change <manifest> --from <campaign>` runs it: the cells in the radius run on the new agent, and the stored runs of the other cells are carried from the baseline campaign. `--audit <n>` first runs n of the cells about to be carried and compares each with its stored run. From the repository root, on the conversations of the gated suite, with no model call:

```
$ G=examples/acme/gated/specs
$ pnpm -s driftbench campaign run $G/boundary $G/cover $G/deviation $G/graph $G/metamorphic $G/twise \
    --target function:acme-sales --agent-version acme-v1 --campaign c-base --store acme.db
...
171 cells: 171 pass, 0 fail, 0 failed. Spent $0.00.
$ pnpm -s driftbench campaign run $G/boundary $G/cover $G/deviation $G/graph $G/metamorphic $G/twise \
    --target function:acme-sales --agent-version acme-v2 --campaign c-v2 --store acme.db \
    --change examples/acme/radius/deviation-goal-shift.yaml --from c-base --audit 20
...
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
Audit: 20 cells drawn from the 162 outside the radius (seed 1) and run fresh: 0 misses. At 95% confidence, under 13.9% of the carried cells would disagree.
9 of 171 cells in the radius. 29 cells run fresh, 142 carried from c-base.
  20 cells outside the radius run fresh: drawn for the audit.
171 cells: 171 pass, 0 fail, 0 failed, 20 reused, 142 carried. Spent $0.00.
Fresh: 29 cells, 142 blocks sent to the agent. Carried from c-base: 142 cells, 690 blocks not sent (agent version acme-v1; this campaign runs acme-v2).
Saved: 690 of 832 blocks, 82.9%. The pass and fail counts above merge fresh and carried results.
```

`--audit-seed <n>` changes which cells the audit draws (default 1). `--max-carry` and `--max-age` bound how long a result stays carried. `driftbench ci --change` gates on the same radius. The rules are on the [blast radius](../../../docs/concepts/blast-radius.md) page.
