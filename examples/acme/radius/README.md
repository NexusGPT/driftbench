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
