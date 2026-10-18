# Stub-start scoring pilot

This pilot measures the scoring and replay implementation. It does not measure
a model's ability to read prose. The bank supplies its recorded labeller.
The four base scoring/replay functions and all ten functions in the
[advanced scoring contract](ADVANCED.md) start unimplemented.

## Isolation and feedback

Each executor starts in a fresh session with the same public TypeScript
interfaces, documented mathematical methods and minimal stub. The stub returns zero scoring counters, constant
identity strings and an unimplemented replay error. It contains no deliberately
incorrect algorithm. Executors own separate candidate files and local git
histories. They cannot edit the bank or inspect the finished implementation,
fixtures, repository tests, previous handoffs, cause tags or each other's work.
Their only bank feedback is the failing-item list with fix hints removed.
Self-authored regression tests supply red/green evidence for each attempted fix.

These are procedural access boundaries, not an operating-system sandbox.
The inherited Codex runtime substitutes for the contract's Sonnet runtime;
no Sonnet comparison is claimed. The explicit task requests at least ten
rounds. Any round after natural completion is labelled verification, never
counted as an additional fix or a newly discovered failure.

## Measurement

`packages/validators/test/judges/v3/pilot.ts` snapshots the candidate and starts
a fresh process whose TypeScript alias points the judges package at that
snapshot. The child asserts function identity for all fourteen exports before
running the actual bank. A constant stub cannot silently fall through to the
finished scorer. Snapshots cannot be overwritten.

Each round runs all items on seeds 1 through 20 and the HEAD-derived hidden
seed. It records candidate and bank SHA-256 hashes, the base HEAD, seed,
timestamp, duration, bank counts and the full measurement. Later rounds refuse
a changed bank or hidden seed. A separate feedback file strips cause tags and
fix hints. Executors read that file only; the maintainer assembles the journal
and forecast from measured reports after the climb.

```sh
pnpm exec tsx packages/validators/test/judges/v3/pilot.ts <candidate.ts> <new-output-directory> 0
pnpm exec tsx packages/validators/test/judges/v3/pilot.ts <candidate.ts> <same-output-directory> 1
```

In the shared build environment, prefix every heavy command with the owner's
slot runner. Round numbers continue through 10. Reproduction uses a new output
directory, the recorded source snapshot and the recorded bank revision.

The former measurements against the finished implementation are superseded.
They establish repeatability only and contribute no observations to this
pilot's forecast. The subsequent 300-item stub pilot reaches full score after
two repairs and stops before round 3. Both experiments remain in `history/`;
neither contributes rounds to the expanded bank's pilot.
