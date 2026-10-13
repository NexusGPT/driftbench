# Offline harness verification

Command:

```sh
python3 -m unittest discover -s comparisons/deepeval/retention-fix -p 'test_harness.py' -v
```

Observed red-first result: the heldout dry-run test failed because evaluation
attempted to open the freeze file before rejecting a non-recording heldout run.
The guard now rejects that call before reading or consuming heldout state.

Observed result after the fix: all 10 tests pass. They cover durable reservations,
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
