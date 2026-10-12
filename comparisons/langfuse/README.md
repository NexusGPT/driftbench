# Langfuse: reproduce the comparison rows

Langfuse was compared against its public documentation (docs read 2026-10-12, source commit cb2cebae). No Langfuse instance was run, so these commands test driftbench alone. Each row in `docs/comparison/langfuse.md` names the command below that reproduces our side. Run every command from the repository root.

| Row | Result | Command |
|---|---|---|
| Dataset items with input, expected output and metadata | ahead | `npx vitest run packages/cli/test/registry.test.ts` |
| Dataset versioning and restore | ahead | `npx vitest run packages/cli/test/registry.test.ts` |
| Dataset from production traces, linked to source observations | ahead | `npx vitest run packages/cli/test/import-traces.test.ts packages/generate/test/drafts/draft.test.ts` |
| LLM-as-judge evaluator | ahead | `npx vitest run packages/judges/test/prompt.test.ts packages/judges/test/criteria.test.ts` |
| Judge replay and determinism | ahead | `npx vitest run packages/judges/test/cassette.test.ts` |
| Judge model choice | equal | `npx vitest run packages/judges/test/clients.test.ts` |
| Experiment run over a dataset | ahead | `npx vitest run packages/report/test/aggregate.test.ts` |
| Run comparison | ahead | `npx vitest run packages/report/test/compare.test.ts` |
| Prompt management: versions | equal | `npx vitest run packages/cli/test/registry-prompt.test.ts` |
| Prompt labels | limit | No command. The competitor's labels behaviour is named only in a caption in its docs, so there is nothing to compare. |
| Prompt linkage to traces and experiments | limit | No command. The competitor's docs describe no such linkage. |
| Annotation queues and human scores | ahead | `npx vitest run packages/judges/test/queue.test.ts packages/cli/test/queue.test.ts packages/cli/test/queue-view.test.ts`, and `npx tsx tools/browser/viewer-journey.ts --out <dir>` for the browser steps |
| Reviewer concordance (Cohen's kappa) | limit | `npx vitest run packages/judges/test/queue.test.ts` |
| Trace and observation schema | ahead | `npx vitest run packages/adapters/test/traces` |
| CI regression gate | ahead | `npx vitest run packages/cli/test/ci.test.ts -t "aggregate|run.sh writes the verdict"` |

A row marked limit has no command because the comparison does not apply, or the competitor's docs do not describe the behaviour. Each row marked ahead or equal is a capability comparison: the competitor's documentation is the other side, and the command checks our side only.
