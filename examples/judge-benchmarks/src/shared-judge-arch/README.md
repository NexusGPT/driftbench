# Shared judge contract snapshot

The TypeScript files are copied without changes from the commit in SOURCE.json.
This local snapshot keeps the experiment inside its permitted examples directory.
It does not mutate packages/judges or competitor templates.

The owner rejects a52e41e3 after an independent review. The 35b7ad97
snapshot first supplies the frozen legacy parser and repair. The owner subsequently
authorizes explicit per-criterion scoring on 35b7ad97, without winnerQuote matching,
then authorizes 1270e1cb1eb324b2f3efbca816aa43fbcb092ae6 while its independent
re-review is running. All current TypeScript files match that latter commit verbatim.
The runner checks that authorization and the supplied source SHA before any call.
Raw model score replies and every requested criterion are retained for free re-scoring
when the next reviewed contract arrives. The original replies remain in recordings.

The legacy contract remains byte-identical to the owner-approved 35b7ad97
implementation. wp-decomposed.ts
uses the shared object extractor, quote repair, schema parser and weighted rubric
aggregation. It has no terminal-ballot or pass/fail fallback for new scores.

The setup-only WritingBrief schema validates request-derived criteria. Every
explicit requirement carries an exact quote and a mandatory flag. Optional items
receive no requirement weight. Replies, labels and the manual audit are absent
from this step. All criteria for one reply share one transport call. The two
independent scorecards are reused for code comparisons in both orders, with fixed
45% requirement, 35% development and 20% craft weights. This is not a second
independent model vote. Raw score ledgers remain available for free re-scoring.

The monorepo already installs zod and yaml for packages/judges. For this isolated
snapshot, link those installed dependencies into the example's ignored node_modules
directory before running. This uses the existing versions and performs no install:

```sh
mkdir -p examples/judge-benchmarks/node_modules
ln -s ../../../packages/judges/node_modules/zod examples/judge-benchmarks/node_modules/zod
ln -s ../../../packages/judges/node_modules/yaml examples/judge-benchmarks/node_modules/yaml
```
