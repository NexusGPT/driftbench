# Changelog

All notable changes to driftbench are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/). Every package under `packages/` and the Python package `python/driftbench` carry the same version; `node tools/release/check.mjs` verifies it.

## [0.1.0] - Unreleased

The first public release. driftbench evaluates AI agents block by block: a block is one exchange with a conversational agent, or one step of a task done by a code-interpreter agent, with a Given, a When and a Then.

### Packages

`@driftbench/cli` (the `driftbench` command), `@driftbench/core`, `@driftbench/checks`, `@driftbench/judges`, `@driftbench/users`, `@driftbench/adapters`, `@driftbench/sandbox`, `@driftbench/artifacts`, `@driftbench/stats`, `@driftbench/store`, `@driftbench/report`, `@driftbench/space`, `@driftbench/generate`, `@driftbench/estate` and `@driftbench/validators`. `@driftbench/battery` stays private until it holds code.

### Added

* Spec schemas, the spec loader and validator, the block runner, the `driftbench` CLI, the leak guard and CI (phase 0).
* Validator frame for the hardness contract: item families and tiers, item banks, floors per ladder version, the hardness journal and `validate --hardness`; distinct failing causes per family and the 100 distinct causes rule; blind pilot rows, and an independent audit that blocks the hardness gate (#2, #11, #12).
* Simulated and perturbing users, the ten deviation classes, the red-team pack and `driftbench perturb` with the recovery label; the fictional Acme red-team pack approved (#2, #6).
* Mode T keeps the previous block's workspace on sandboxed tasks; a block with its own workspace starts fresh (#3).
* The variance pilot fills wording slots and respects their conditions; golden-set selection by k best, and the sealed holdout with `holdout seal` and `holdout score` (#4).
* Reliability per golden, `driftbench compare` with a non-inferiority test, the one-file HTML scorecard with a spread view, JUnit XML, the `driftbench ci` gate, `driftbench monitor` and a GitHub action (#5).
* The Claude Code estate reader: symlinks, registry tables, process maps, catalogue JSON, dispatcher commands, compact frontmatter, long references, an ignore list, reference bases, bare names, aliases and ambiguous references (#7, #10).
* Blocks can expect files read and helpers dispatched; replay compares the workspace before and after; a code-agent example in the README (#8).
* The docs site on GitHub Pages, built with VitePress from `docs/` (#13).
* The live Claude Code runner, checked against the real headless runtime: stream records, session files, resume and hook decisions (#14).
* Similarity with a local character n-gram TF-IDF embedder and a pluggable embedder port, relevancy with a machine floor and a judged criterion, and knowledge retention from the ledger (#15).
* Relevancy key terms with light stemming in English, French, Spanish, Dutch, German, Italian and Portuguese, with no network call (#17).
* `driftbench import` from CSV and spreadsheets through a mapping file; a content-addressed registry for datasets and prompts with push, list, diff and restore; `campaign run --dataset` and `--prompt` record their sources (#18).

### Release

* Every publishable package carries a complete manifest, a README and the 0.1.0 version.
* `.github/workflows/release.yml` publishes to npm with provenance and to PyPI through trusted publishing, on a `v*` tag only.
* `tools/release/check.mjs` checks manifests, versions, this changelog and the contents of every pack.

[0.1.0]: https://github.com/achammah/driftbench/releases/tag/v0.1.0
