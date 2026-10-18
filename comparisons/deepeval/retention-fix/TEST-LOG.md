# Offline harness verification

Command:

```sh
python3 -m unittest discover -s comparisons/deepeval/retention-fix -p 'test_harness.py' -v
```

Observed red-first result: the heldout dry-run test failed because evaluation
attempted to open the freeze file before rejecting a non-recording heldout run.
The guard now rejects that call before reading or consuming heldout state.

Observed initial result after the fix: all 10 tests pass. They cover durable reservations,
settlement replacement, the total budget cap, invalid-cost rejection, single-use
heldout state, post-freeze tuning rejection, selection/source matching, private
original preservation, label isolation, and production parser behavior. The
parser tests reject a legacy outcome object and an invented requirement ID, then
accept the actual requested ID with an exact supplied quote.

The renderer was formatted with:

```sh
pnpm exec biome check --write comparisons/deepeval/retention-fix/bridge.mts
```

No paid calls are part of these tests. Synthetic cases are created inline; tests
never read heldout case values or labels.

## Final focused verification

The final offline harness suite passes all 12 tests. The additional tests reject
provider or loader environment overrides and detect a changed selected report.

The focused TypeScript runs pass 23 tests across four files:

```sh
pnpm exec vitest run packages/judges/test/knowledge-retention.test.ts packages/judges/test/criterion-ledger.test.ts packages/judges/test/evidence.test.ts
pnpm exec vitest run packages/checks/test/knowledge_retention.test.ts
```

The three new instruction-boundary assertions failed against the original YAML
before the criterion edit, then passed. These assertions check the served
instructions; they do not simulate semantic accuracy. Four combination tests
exercise the real machine check with explicitly supplied judge verdicts.

`pnpm --filter @agent-nexus/driftbench-judges build` passes ESM and declaration
generation. A direct import from `packages/judges/dist/index.js` returns
`KNOWLEDGE_RETENTION_CRITERION` with name `knowledge_retention` and scope
`conversation`. The catalogue parity test confirms identical prompt rendering.

The earlier full-suite process was interrupted by the plugin crash. It is not
claimed as passing. After resumption, only focused tests run locally.
