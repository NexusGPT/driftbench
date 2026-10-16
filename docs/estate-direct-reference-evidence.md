# Direct reference graph evidence

Source base: a91598b5e153dc9c734188abc4027f47073eeae6. The product fix is framework-wide: citation storage, lexical ownership, on-demand reach, and project/user skill precedence. No validator identifiers, seed values or planted names enter product code.

## Synthetic graph

The hand-written scale estate has 60 skills and a cross-skill cycle of 3,600 reference files. All 3,661 direct citation records remain. Every owner reaches the same citation set in the old expanded representation and the new query interface. The sum of per-owner reached citations is 216,060 on both sides.

| Measurement | Before | After |
|---|---:|---:|
| Stored reference links | 216,060 | 60 |
| Graph build milliseconds | 1,341.308 | 7.503 |
| All-owner query milliseconds | 1,253.406 | 517.685 |
| Retained graph/index heap bytes after GC | 12,301,200 | 448,632 |
| Process peak RSS KiB | 272,544 | 181,936 |

These are single-process measurements on a shared machine, not timing guarantees. The old builder is extracted unchanged from the source base; the same new-scanned atoms and raw files feed both graph builders. Module import and source scanning precede the measured graph build. Separate processes run each side with exposed GC. Peak RSS includes scanning, module transforms and the test runner, while retained heap measures the graph/index allocation.

The opt-in benchmark lives in packages/estate/test/graph-reference-scale.test.ts. Set ESTATE_REFERENCE_BENCHMARK=before or after, and ESTATE_REFERENCE_REPORT to an absolute JSON output path. Pass --execArgv=--expose-gc to Vitest. For the exact original builder, extract the base revision of packages/estate/src/graph/edges.ts to a temporary adjacent module and set ESTATE_REFERENCE_BASELINE to that absolute path. Without that module, the independent expanded-closure test oracle is used.

## Verification

The focused graph, reader, contract, plan and stats checks pass: 89 tests across 14 files, with the opt-in benchmark skipped. After adding the final canonical trash-file guard, the affected user, ignore and symlink checks pass again: 29 tests across three files. All three adapter copy-isolation checks also pass outside the outer sandbox, including a selected user skill whose run-copy edit leaves the original unchanged. Scoped TypeScript compilation passes.

User-layer regressions cover absolute and home references, separate folder/name precedence, oversized assets, explicitly cited shadowed guides, deep containers, canonical project/user aliases, and ignored directory/file aliases. Five initial cases fail before their fixes. Additional scan/copy collision and trash-file alias checks each fail before their fixes and pass afterward. Independent static review finds no remaining critical issue.

The interrupted all-level estate comparison uses a frozen pre-follow-up source snapshot with the separately reviewed chained-reference oracle overlay. Immutable baseline captures are supplied by the integrator. Seed 1 has 440 compared items; three previously passing items exceed their time budgets while their content assertions hold: wide-folder scan 27,087 ms, long-routing-table scan 8,784 ms, and long-routing-table lint 5,121 ms, each against 5,000 ms. The full comparison is unfinished, and does not include the final user-layer follow-up. No zero-loss claim is made.

The original baseline attempt from a changing worktree is discarded because child CLI invocations can read newer source. Source manifests cover the frozen comparison tree.
