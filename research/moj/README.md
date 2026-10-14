# MoJ sealed confirmation

Copies of three files of the mixture of judges research, from the branch `research/system1-judge` at commit `06fd0edb3b5d8805bca476baf7285d6e5c25b834`, kept here so the README numbers have a source inside the repository. The values are unchanged.

| File | Path on that branch | What it holds |
|---|---|---|
| `RESULTS.md` | `research/moj/RESULTS.md` | The write-up. The section "Sealed confirmation (run once)" holds the numbers the README quotes. |
| `results/sealed/report.json` | `research/moj/results/sealed/report.json` | The sealed scores, with intervals, and the calls and cost per 100 pairs of each contestant. |
| `sealed/freeze.json` | `research/moj/sealed/freeze.json` | The configuration frozen before any sealed score existed. |

The rest of that folder (the recordings, the sealed items, the configurations and the code) is not copied: it holds about 130 MB of recordings. The links inside `RESULTS.md` to those files do not resolve here. Every item used is fictional or from a public benchmark, and the leak guard passes on these files.

`node tools/readme-charts.mjs --check` reads `report.json`, checks that the sealed table of `RESULTS.md` says the same, and lists the numbers in [chart-facts.csv](../../docs/assets/data/chart-facts.csv) under `impact-moj`. MoJ runs from the research harness; the package ships the opt-in escalation API `createEscalation`.
