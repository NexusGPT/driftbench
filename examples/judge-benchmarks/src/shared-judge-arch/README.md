# Shared judge contract snapshot

The TypeScript files are copied without changes from the commit in SOURCE.json.
This local snapshot keeps the experiment inside its permitted examples directory.
It does not mutate packages/judges or competitor templates.

The owner rejects a52e41e3 after an independent review. The current 35b7ad97
snapshot is approved only for the frozen legacy parser and repair. The decomposed
runner refuses paid scoring while approvedForNew is false. It also checks the
supplied contract SHA against the snapshot before any call.

The next reviewed commit replaces the new-contract files verbatim. The legacy
contract remains pinned to the owner-approved implementation. wp-decomposed.ts
uses the shared object extractor, quote repair, schema parser and weighted rubric
aggregation. It has no terminal-ballot or pass/fail fallback for new scores.

The setup-only WritingBrief schema validates request-derived criteria. Every
explicit requirement carries an exact quote from the request. Replies, labels and
the manual audit are absent from this step. Each requested score has its own item;
four items share a transport call, and AB and BA calls use the same weights.

The monorepo already installs zod and yaml for packages/judges. For this isolated
snapshot, link those installed dependencies into the example's ignored node_modules
directory before running. This uses the existing versions and performs no install:

```sh
mkdir -p examples/judge-benchmarks/node_modules
ln -s ../../../packages/judges/node_modules/zod examples/judge-benchmarks/node_modules/zod
ln -s ../../../packages/judges/node_modules/yaml examples/judge-benchmarks/node_modules/yaml
```
