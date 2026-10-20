# Independent CHEATER audit: combined judges v3 bank

| Check | Verdict | Note |
|---|---|---|
| cheater | pass | 19 attacks; 334 items; seeds 1..20 plus hidden 703475557. |

Measured: 2026-10-18T00:55:54.406Z. Hidden seed source: head; commit: 6579b72536697bc99bccb5c138d007d4e3a4a44d.
The audit uses the combined public bank API, the public request boundary, and the hidden-seed helper. The advanced API contract was read; no generator, gold, or production scorer source was read.
Earlier audits found position-cycle and pair-aware shortcuts. The measured matrix below describes the current combined bank only.

| Family | Items |
|---|---:|
| abstain | 39 |
| adversarial-label | 30 |
| agreement | 47 |
| cache-key | 30 |
| label-set-change | 34 |
| length-bias | 30 |
| near-miss | 31 |
| none | 32 |
| order-bias | 31 |
| replay | 30 |

| Tier | Items |
|---|---:|
| 1 | 60 |
| 2 | 63 |
| 3 | 69 |
| 4 | 74 |
| 5 | 68 |

| Attack | Items passing every seed | Passing item-seed runs | Uninvoked factory runs |
|---|---:|---:|---:|
| empty-string | 0/334 | 0/7014 | 0/7014 |
| constant-none | 0/334 | 0/7014 | 0/7014 |
| always-null | 0/334 | 0/7014 | 0/7014 |
| first-label | 0/334 | 0/7014 | 0/7014 |
| last-label | 0/334 | 0/7014 | 0/7014 |
| constant-route-1 | 0/334 | 0/7014 | 0/7014 |
| constant-route-2 | 0/334 | 0/7014 | 0/7014 |
| position-cycle | 0/334 | 0/7014 | 0/7014 |
| pair-aware-position-cycle | 0/334 | 0/7014 | 0/7014 |
| position-reverse-cycle | 0/334 | 0/7014 | 0/7014 |
| position-blocks | 0/334 | 0/7014 | 0/7014 |
| text-length-modulo | 0/334 | 0/7014 | 0/7014 |
| first-label-word-in-payload | 0/334 | 0/7014 | 0/7014 |
| last-label-word-in-payload | 0/334 | 0/7014 | 0/7014 |
| shortest-description | 0/334 | 0/7014 | 0/7014 |
| longest-description | 0/334 | 0/7014 | 0/7014 |
| numeric-token-as-seed | 0/334 | 0/7014 | 0/7014 |
| metadata-oracle-probe | 0/334 | 0/7014 | 0/7014 |
| request-mutation | 0/334 | 0/7014 | 0/7014 |

Passing item IDs:

First twenty passing item-seed examples per attack (counts above are complete):

Items whose supplied candidate factory was not invoked:

Inspected 813918 requests. Observed fields: label.description, label.name, labelSet.labels, labelSet.name, request.context, request.labelSet, request.text.
Observed object prototypes: Object. Unexpected fields/accessors/prototypes: none.
Mutation attempts: 3399921; accepted writes: 3399921.
Accepted writes alone do not fail this audit: readonly is a TypeScript boundary, and mutable request copies can remain isolated from the oracle. The mutation attack is judged by its score gain.

The factory receives requests only; this audit does not give a cheat the seed or item ID. The numeric-token attack treats visible digits as a seed hint.
Every item-seed run must invoke its supplied candidate factory. A passing item-seed or an uninvoked factory fails the audit, including advanced statistical items.
Payload-name attacks select names appearing in text with fixed-position fallbacks. Position and length attacks ignore classification semantics.
Threat-model limit: arbitrary JavaScript can read repository files. This audit covers only the inspected request boundary, not oracle confidentiality against filesystem access, globals, monkey-patching, or arbitrary process instrumentation.
No live models, external word lists, private data, or paid calls were used.

Reproduce: shared slots/run.sh pnpm exec vitest run packages/validators/test/judges/v3/cheater-audit.test.ts --maxWorkers=2

## Independent verification

- Verdict: PASS for the tested request-boundary attacks. All 19 attacks score zero on every item-seed run.
- Runtime inventory matches the frozen scope: 334 unique item IDs, with all declared family and tier totals matched.
- Vitest exits 0: 1 test file, 2 tests passed; reported duration 108.65 seconds.
- HEAD is unchanged before and after execution: `6579b72536697bc99bccb5c138d007d4e3a4a44d`.
- Scoped bank, judges source, and owned test paths are clean before and after execution. Captured bank/test SHA-256 hashes remain unchanged.
- Per-attack totals are 0/334 items passing every seed, 0/7014 passing item-seed runs, and 0/7014 uninvoked factories.
- The four required attacks each score zero. No request metadata, accessor, or prototype leak is observed in this run.
- This result does not certify arbitrary-JavaScript sandboxing or all possible cheats. The threat-model limits above remain binding.

Source hashes (hashed without inspecting source contents):

| File | SHA-256 |
|---|---|
| `packages/validators/test/judges/v3/cheater-audit.test.ts` | `9af6b74c5486108fe22e785fdea3497c9fb475fae6763c7c34310056e9c4f2db` |
| `packages/validators/src/ladders/judges/v3/advanced-bank.ts` | `4d5b340f1e545d01115c2d16e22f25a79b1cea622f26819e0e6138aa0e58d6ff` |
| `packages/validators/src/ladders/judges/v3/bank.ts` | `c7c5320be0208888e3ecb9744566316803014cf66efcf764bbdaf0bd5f48f482` |
| `packages/validators/src/ladders/judges/v3/fixtures.ts` | `d3b68e6065ba68cba6ecb220f0d8e7c7057b3fc2c19ca5a58cfc1d3b630eb143` |
| `packages/validators/src/ladders/judges/v3/index.ts` | `4ae2c8df2df12b30cb70e886e72df2b3be4ba3b5851e554dfb8ddb950ae81724` |
