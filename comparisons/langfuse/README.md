# Langfuse: reproduce the comparison rows

Langfuse was compared against its public documentation (docs read 2026-10-12, source commit cb2cebae). No Langfuse server instance is run. The original capability commands test driftbench alone; the hard evaluator experiment below measures both prompt procedures through the same Haiku CLI path. Each row in `docs/comparison/langfuse.md` names the command below that reproduces our side. Run every command from the repository root.

| Row | Result | Command |
|---|---|---|
| Dataset items with input, expected output and metadata | documented advantage | `pnpm exec vitest run packages/cli/test/registry.test.ts --maxWorkers=2` |
| Dataset versioning and restore | documented advantage | `pnpm exec vitest run packages/cli/test/registry.test.ts --maxWorkers=2` |
| Dataset from production traces, linked to source observations | documented advantage | `pnpm exec vitest run packages/cli/test/import-traces.test.ts packages/generate/test/drafts/draft.test.ts --maxWorkers=2` |
| LLM-as-judge evaluator | ahead with the experimental procedure; easy unmeasured | `python3 comparisons/langfuse/hard/run.py baseline --cap-usd 0` |
| Judge replay and determinism | documented advantage | `pnpm exec vitest run packages/judges/test/cassette.test.ts --maxWorkers=2` |
| Judge model choice | documented parity | `pnpm exec vitest run packages/judges/test/clients.test.ts --maxWorkers=2` |
| Experiment run over a dataset | documented advantage | `pnpm exec vitest run packages/report/test/aggregate.test.ts --maxWorkers=2` |
| Run comparison | limit; competitor page unread | `pnpm exec vitest run packages/report/test/compare.test.ts --maxWorkers=2` |
| Prompt management: versions | documented parity | `pnpm exec vitest run packages/cli/test/registry-prompt.test.ts --maxWorkers=2` |
| Prompt labels | limit | No command. The competitor's labels behaviour is named only in a caption in its docs, so there is nothing to compare. |
| Prompt linkage to traces and experiments | limit | No command. The competitor's docs describe no such linkage. |
| Annotation queues and human scores | documented advantage | `pnpm exec vitest run packages/judges/test/queue.test.ts packages/cli/test/queue.test.ts packages/cli/test/queue-view.test.ts --maxWorkers=2`, and `npx tsx tools/browser/viewer-journey.ts --out <dir>` for the browser steps |
| Reviewer concordance (Cohen's kappa) | limit | `pnpm exec vitest run packages/judges/test/queue.test.ts --maxWorkers=2` |
| Trace and observation schema | documented advantage | `pnpm exec vitest run packages/adapters/test/traces --maxWorkers=2` |
| CI regression gate | documented advantage | `pnpm exec vitest run packages/cli/test/ci.test.ts -t "aggregate|run.sh writes the verdict" --maxWorkers=2` |

A row marked limit has no command because the comparison does not apply, or the competitor's docs do not describe the behaviour. Original ahead and equal outcomes are documented capability comparisons: the competitor's documentation is the other side, and the command checks our side only. The page now labels these documented evidence classes explicitly. The run-comparison row is a limit because the relevant competitor page was not read.

## Hard and held-out measurements

| Procedure | Tuning hard | Fresh held-out | Tuning USD / 100 | Held-out USD / 100 |
|---|---|---|---|---|
| Shipped judge | 111/120 | 109/120 | $0.049067 | $0.049150 |
| fact-ledger procedure (not yet the shipped default) | 120/120 | 120/120 | $0.043389 | $0.043523 |
| Template, preregistered 1.0 | 83/120 | 83/120 | $0.052505 | $0.052484 |
| Template, best reported setting 0.5 | 113/120 | 115/120 | $0.052505 | $0.052484 |

The fact-ledger procedure is not yet the shipped default. The shipped judge's tuning result remains 111/120. Template threshold rows share calls and cost. Both sets, raw and repaired numbers, confidence intervals and scope appear in `docs/comparison/langfuse.md`. Construction and free replay are in `hard/README.md`.
