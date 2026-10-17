# Reproducing the variables bank repair

The committed test helpers are limited witnesses. They do not claim a full correct implementation, an independent audit, or an executor pilot.

Run on Node 24 with pnpm dependencies installed:

```sh
pnpm exec vitest run packages/validators/test/variables --maxWorkers=2
pnpm exec biome check packages/validators/src/ladders/variables packages/validators/test/variables validators/variables/baseline.ts validators/variables/compare-cheats.ts
pnpm exec tsx validators/variables/baseline.ts
```

The baseline imports the real default adapter, currently an empty export, directly. Its hidden seed is the repository's canonical `hiddenSeed(root)` derived from the measured HEAD. `journal.jsonl` records that HEAD and the bank source SHA-256; later evidence-only commits do not change the measured source.

To compare the pre-contract-correction bank at `07b3a1402c263af1ac1360bffeb377aeae4e816b` with the current source, extract the old bank into an isolated temporary directory. Preserve both package manifests so the old subprocess uses the same ESM mode:

```sh
mkdir -p /private/tmp/astra-banks-variables-before
git archive 07b3a1402c263af1ac1360bffeb377aeae4e816b package.json packages/validators/package.json packages/validators/src/ladders/variables packages/validators/src/ladder.ts | tar -x -C /private/tmp/astra-banks-variables-before
pnpm exec tsx validators/variables/compare-cheats.ts /private/tmp/astra-banks-variables-before
```

The comparison requires identical item IDs and order. Each implementation is loaded unchanged in subprocesses. It records all credited IDs and fails if any profile gains an item. `contract-cheats.json` is builder regression evidence, not an independent cheater audit.

The suite retains 51 constant-operation mutation cases, nine nonempty wrong-output cases and four correct-parent/empty-child cases. Contract tests additionally exercise five omitted normalization steps across six items, case and punctuation relaxation across eight items, six raw-match cases, two additional case-fold cases, one punctuation-erasure case, two distinct granularity defects, and two missing-provenance forms. These are mutation test cases, not independent repair counts.

The historical `reference-and-mutants.json` reports external code that is unavailable here. Its numbers are preserved as history, explicitly unverified. `audit.md` lists the remaining integration and independent gates.
