# Benchmark floors for the shipped judge

`driftbench bench` records the shipped default judge on fictional cases with labels fixed by construction. Committed recordings replay without credentials or model calls. CI refuses a missing recording, stale evidence, or a result below its floor.

This checks the behavior available through the public package. It does not establish that one model is best for every user's task. Calibrate on your own criteria and labels as described in [judges](concepts/judges.md).

## Replay the committed recordings

Run from a checkout of this repository:

```sh
pnpm driftbench bench replay --slice all --check-floor
pnpm driftbench bench replay --slice fresh-reference --model haiku --json
pnpm driftbench bench floors
```

`--slice` defaults to `all`. Without `--model`, replay selects every active model. `--root <path>` selects another repository checkout containing `benchmarks/`. The command reads raw recorded responses through the current public parser.

Each result prints the correct count, Wilson interval and bootstrap interval over construction families. `--check-floor` adds the absolute floor and paired comparison. JSON output includes individual case results, checks, problems and skipped models. No network request is made.

A changed dataset hash, prompt fingerprint, client setting, or cassette integrity check requires a new recording. A stale cassette fails with `re-record needed`; it cannot silently pass the previous score.

## Immutable slices

The [manifest](../benchmarks/manifest.json) lists 14 slices and 1,798 binary cases per active model. Every slice is version 1. The complete population is retained.

| Slice | Cases | Source file |
|---|---:|---|
| `fresh-rubric` | 192 | A: `promptfoo-rubric-cases.json` |
| `fresh-reference` | 192 | A: `langfuse-reference-cases.json` |
| `map-rubric` | 156 | A: `map/promptfoo-rubric-cases.json` |
| `map-reference` | 180 | A: `map/langfuse-reference-cases.json` |
| `hard-rubric` | 120 | B: `rubric.json` |
| `hard-factuality` | 120 | B: `factuality.json` |
| `hard-pii` | 120 | B: `pii.json` |
| `hard-goal` | 120 | B: `goal.json` |
| `heldout-rubric` | 72 | B: `heldout-rubric.json` |
| `heldout-factuality` | 72 | B: `heldout-factuality.json` |
| `heldout-pii` | 72 | B: `heldout-pii.json` |
| `heldout-goal` | 72 | B: `heldout-goal.json` |
| `planted-verify` | 190 | C: `bank-verify.json` |
| `planted-rubric` | 120 | C: `bank-rb.json` |

Source roots and frozen commits:

* A: [`comparisons/astra-hard/`](https://github.com/achammah/driftbench/tree/89425c88b12e5fd7516ed9cdbf6d37b9b0261595/comparisons/astra-hard), commit `89425c88b12e5fd7516ed9cdbf6d37b9b0261595`, from `research/astra-hard-fresh`.
* B: [`comparisons/promptfoo/hard/`](https://github.com/achammah/driftbench/tree/82cc403c01aa2992b109a24d739e2febe4bd33f5/comparisons/promptfoo/hard), commit `82cc403c01aa2992b109a24d739e2febe4bd33f5`, from `codex/hard-promptfoo`.
* C: [`research/planted/`](https://github.com/achammah/driftbench/tree/d88113cb33cef242b068e630b176651b97a7e743/research/planted), frozen commit `d88113cb33cef242b068e630b176651b97a7e743`, from `research/astra-planted-truth`. Its [audit and metrics](https://github.com/achammah/driftbench/tree/492fce432e1d34a62c5f5c5586d23026133b390b/research/planted) are at `492fce432e1d34a62c5f5c5586d23026133b390b`.

The planted verify bank retains all 95 pairs, including repeats; its source audit reports 91 distinct pairs. The planted rubric bank retains all 60 pairs. Each clean response becomes a pass case and each defective response becomes a fail case. These are fictional re-instantiations of executable templates, not complete public benchmark dev splits. The rubric bank tests an objective requirement, not full-rubric preference accuracy.

Each folder `benchmarks/slices/<name>/<version>/` holds:

* `cases.spec.json`: a valid conversation spec whose `metadata.bench` contains the cases.
* `source.json`: the source file copied byte for byte.
* `provenance.json`: the commit, source path, source hash, population and conversion method.

The folder hash is the [dataset registry](datasets.md#the-registry) content hash. Replay and record recompute it with the public store API. A changed folder requires a new dataset version. `--store <file>` also registers the exact version in a local store and rejects a version conflict.

```sh
pnpm driftbench dataset push fresh-rubric benchmarks/slices/fresh-rubric/1 --store bench.db
pnpm driftbench bench replay --slice fresh-rubric --store bench.db
```

## Labels and the public API boundary

A case carries its id, construction family, expected pass or fail, and a `JudgeRequest`. Only the request reaches the judge. Family names, labels, source proofs and mutation metadata remain outside it. A planted defective response is judged without its clean counterpart or construction oracle.

Reference slices supply their trusted reference as an input file. Factuality slices preserve the original contradiction criterion. Goal slices supply the persisted final order. These inputs express the task, while the binary truth remains separate.

The harness accepts only the default request fields: `criterion`, `transcript`, `inputs`, `reference`, `artifact` and `given`. Dataset cases cannot select another assessment or answer contract.

[The public API check](../tools/bench-lint.mjs) limits production benchmark imports to allowed judge exports, public statistics, Node builtins and local production benchmark modules. It rejects internal package imports, runtime module loaders, and imports from benchmark tests or preparation scripts. The scoring and recording code cannot substitute a benchmark-specific judge prompt.

## Active models

| Model id | Recorded model | Status |
|---|---|---|
| `haiku` | `claude-haiku-5-5` | Active, through the public CLI judge |
| `gpt-6-luna` | `gpt-6-luna` | Active, public OpenAI judge, medium reasoning |
| `gemini-3.8-flash` | `gemini-3.8-flash` | Active, public Google judge, medium thinking, 300 second timeout |

All three models use the same shipped prompt fingerprint. Explicit reasoning settings participate in each client's cassette key.

## Record and resume

Recording is a maintainer action that makes live model calls. Select one model and supply an approved spending limit. Haiku needs an installed, authenticated `claude` executable. OpenAI needs `OPENAI_API_KEY`; Gemini needs `GEMINI_API_KEY` in the environment.

```sh
pnpm driftbench bench record --slice fresh-rubric --model haiku --spend-cap-usd <approved-cap>
pnpm driftbench bench record --slice all --model gpt-6-luna --spend-cap-usd <approved-cap> --resume
```

`--concurrency` defaults to 4 and accepts 1 through 16. The first live request completes before concurrent recording starts. The budget reserves spending before each live call, including concurrent calls. It refuses an unmetered answer. An error without measured usage charges the reservation conservatively. The cap applies to this invocation; a resumed invocation needs its own cap.

Successful calls checkpoint partial cassettes and spending evidence. `--resume` reuses completed recordings only after validation. For partial recordings, it replays matching successful responses and requests only the missing responses. It rejects stale fingerprints, datasets or client settings. Omit `--resume` when intentionally re-recording changed code; the previous completed cassette is archived by content hash.

The command writes:

| File | Content |
|---|---|
| `benchmarks/cassettes/<slice>@<version>/<model>.json` | Raw responses and public client identity |
| `benchmarks/evidence/<slice>@<version>/<model>.json` | Score report, cassette hash, resolved models, measured and charged spending, and call records |
| `benchmarks/evidence/spend.jsonl` | Append-only spending rows; override with `--spend-ledger <path>` |

The report records the dataset identity, prompt fingerprint, client settings, commit and timestamps. The command checks that recording and replay produce identical case results before accepting the completed cassette. A transport-truncated response remains inconclusive during replay even if its raw JSON is parseable. A regression retains its evidence for diagnosis and returns a failure.

The manual [bench record workflow](../.github/workflows/bench-record.yml) accepts a slice, model and cap. Its cap must be positive and at most 5 USD. OpenAI and Gemini use their repository secrets on a hosted runner. Haiku uses a preconfigured self-hosted runner labelled `driftbench-bench` and `claude-cli`. The workflow uploads cassettes and evidence for review; it does not commit them or raise floors.

## Floors and uncertainty

[The floor file](../benchmarks/floors.json) holds a separate floor for each slice version and model. A floor stores the correct count, case count, Wilson lower bound, fingerprint, commit, individual results and evidence hash.

`--check-floor` requires both checks to hold:

1. The correct count is at least the recorded floor.
2. Paired results pass the automatic non-inferiority margin and do not show a significant drop under exact, two-sided McNemar at 0.05.

The automatic margin uses the baseline's self-comparison, rounded upward in half percentage point increments. Pairing requires identical case ids, labels and construction families. Wilson intervals and bootstraps over whole families accompany the result. Perfect accuracy still carries a zero-failure bound that assumes independent cases. Related constructions and repeated pairs can violate that assumption.

These intervals describe this finite, constructed population. They do not measure all-domain reliability or eliminate label-design errors. Retaining source data and family membership makes those limits inspectable.

To establish or raise a floor, first inspect a complete recording and its replay. Then provide current evidence:

```sh
pnpm --silent driftbench bench replay --slice fresh-rubric --model haiku --json > bench-replay.json
pnpm driftbench bench floors --raise fresh-rubric haiku --evidence bench-replay.json
pnpm driftbench bench replay --slice all --check-floor
```

`--evidence` also accepts the individual record evidence file. The command validates the evidence against the current cassette replay before writing. Within one dataset version, the correct count cannot fall. An equal count can update the evidence after a fingerprint change; an unchanged count at the same fingerprint is refused. Previous floor records remain in history.

## CI and protected files

The [CI workflow](../.github/workflows/ci.yml) runs the public API check and `bench replay --slice all --check-floor` on pull requests and pushes to main. It makes no live model calls.

[`validate protect`](validators.md#82-the-command) rejects changes from `exec/` branches to the benchmark folders, CLI implementation, public API check and enforcing workflows. Maintainers change recordings and floors from a maintainer branch, with the evidence run in the commit message. Review the raw responses and measured results before committing a new floor.

The full flag and exit-code reference is under [`driftbench bench`](reference/cli.md#driftbench-bench).

Gemini metering counts candidate and thinking tokens, and discounts cached input. Reservations allow the [model's full 65,536-token output ceiling](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), so a call requires that much budget headroom even though only measured usage is charged. The introductory rates expire after December 31, 2026; recording then refuses until the rates are updated. See [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).
