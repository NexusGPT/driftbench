# Changelog

All notable changes to driftbench are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/). Every package under `packages/` and the Python package `python/driftbench` carry the same version; `node tools/release/check.mjs` verifies it.

## [Unreleased]

* Dataset push and restore preserve generated `.seed-*` task fixtures, including binary and nested files. `generate --spec-cap` retains each kept task spec's seed assets without rewriting their contents. `.git` and `node_modules` stay excluded from registry versions.
* `expect.pii_judge: true` opts a block into names-and-addresses detection through its configured judge. Default regex PII checks stay unchanged. SDK councils and explicitly supplied `piiJudge` callbacks work; CLI replay and estate runs share the configured judge's budget. Missing or failed judging is gating inconclusive; absent or false opt-in makes no paid call.

* Opt-in answer audit in the judges package: `judgeAnswerAudit`, or `assessment: { kind: 'answer-audit' }`, grades a submission against a criterion and an optional trusted reference. The request is role-separated JSON; the model settles each condition with a quote before its status and code computes the outcome. It has its own prompt fingerprint; default and legacy prompts and cassette keys are unchanged.
* Evidence grounding accepts `{}` or `[]` quoted from a source whose whole text is that empty JSON container. A check that reports an empty persisted file no longer voids its ledger. Prompts and cassette keys are unchanged; 24 recorded goal answers that were inconclusive now decode to their recorded fail verdict. Decoration-only quotes stay ungrounded.
* `campaign:` key in `driftbench.yaml`: the settings of `campaign run` (specs, targets, routes, modes, repeats, store, cache, concurrency, budget, simulated user, model families, retries), each a plain mapping onto its flag. A flag on the command line wins over the file. `campaign run` and `campaign plan` gain `--config <file>`; `ci` takes the run settings it shares. A config with no `campaign:` key behaves as before.
* Opt-in `criterionPromptVersion: 2` for ordinary criterion checks: the default prompt plus exact-identifier, stated-facts and stated-scope rules, under its own prompt fingerprint. The default prompt, its fingerprint and every existing recording key are unchanged. See [judges](docs/concepts/judges.md).
* Opt-in `createEscalation` routes reference disagreement, order splits, inconclusive results and low confidence to a cross-family council. It preserves comparison diagnostics and recorded replay, supports deployable-route calibration and checks constituent model families. The offline MM-Eval DEV400 example reproduces 91.16 from pinned recordings, with unknown historical generator families disclosed.
* Councils accept named pairwise winners directly, preserve them in votes and distinguish a majority tie from missing evidence. Comparison-aware reference, final-answer and verification wrappers preserve their behavior around an escalation client.
* Opt-in `stated_length` check in the checks package: it reads a total length stated in the request (English words, or Chinese characters for 字) and fails a draft under half of it. Over-length never fails unless `over_ceiling` is set. The earlier 10 percent rule failed long drafts that human labels preferred. See [checks](docs/reference/checks.md#stated-length).

* Winner quote grounding maps decoded JSON value characters back to their literal source spans. Escaped role tokens, JSON text-wrapper keys and escape digits alone cannot supply substantive evidence; legacy is unchanged.

* Pairwise winner matching preserves substantive literal substrings, including partial code fences, before adding normalized views. Exactly one candidate must match; labels and decoration alone remain insufficient.
* Ordinary criterion evidence accepts source-bound lists of `{ source, quote }` spans, each grounded independently in its named entry or data source. The default prompt requests lists; existing string evidence still parses. Public binary answers retain string evidence, and returned checks preserve all spans. This changes new-default prompt fingerprints; legacy rendering and parsing are unchanged.

* Legacy judging freezes main `a97cb65e` rendering and parsing, including entry separators, object extraction and repair behavior. All 1,028 stored chat entries have main-matching replay outcomes.

408 Request Timeout is retried like 429 and 5xx in every adapter.

* Pairwise chat judges name a winner and quote a passage unique to it. Code validates the quote, maps the existing binary outcome and reconciles both candidate orders, with one retry for malformed output.
* Reference-guided factual comparisons audit requested facts and recover ties through a structured fact ledger. Code computes the fallback winner from factual defects and unsupported additions.
* Optional itemized rubric scoring aggregates caller weights and hard requirements in code. Candidate swaps reverse the item presentation order.
* Optional bounded arithmetic verification, grounded final-answer extraction and strict blind-solve reference agreement are available through provider-neutral interfaces. Verification defaults to off.
* Behaviour change: ordinary chat criterion checks now request a per-requirement evidence ledger; code computes pass, fail or inconclusive. The caller supplies exact requirement ids; an unsplit criterion is one complete requirement. Missing ids trigger a retry, then abstention; unknown ids are ignored and retained as diagnostics. Old binary model JSON is retried by council, calibration and single-judge paths, then abstains. Select `answerContract: 'legacy'` to restore the previous prompt and parser; probability judges are unchanged.
* Winner quotes must be nonempty and identify exactly one candidate. A shared quote can use distinguishing following evidence supplied by the model; a still-ambiguous quote gets one explicit re-ask. Rendered role-prefixed evidence grounds only to its matching entry. New parser paths reject repeated decoded object keys before verdict aggregation; frozen legacy stays unchanged. Reference-guided rubric prompts retain both the reference and every supplied item. The numeric `majority(votes, seated = 3)` quorum is preserved.
* Fresh Haiku regression cassettes retain all 28 responses on seven previous failures: 27 correct, one inconclusive, zero wrong verdicts. Quote grounding and code aggregation do not guarantee that the model's per-requirement judgment is correct.
* Existing public binary criterion answers and pairwise verdict fields remain supported. Pairwise model JSON now uses `winner` and `winnerQuote`; custom chat clients should use the request-aware parsers. Assessment and custom system text enter cassette identity, so the new contract needs fresh recordings. Existing cassettes replay unchanged with `answerContract: 'legacy'`. See [judges](docs/concepts/judges.md#pairwise-comparison).
* Binary text parsing utilities add narrow repairs for recased outcomes, quoted numeric scores, single or typographic quotes, trailing commas and comment lines. Additional quote and backslash repairs apply only to new paths; legacy uses its frozen extractor and repair.
* Council size and per-judge cascade thresholds are configurable; explicit `majority(votes, { weights })` supports weighted votes. `CouncilResult.cost` reports relative call cost. The default numeric quorum remains three seats. Invalid probability values abstain, and reversed or equal probability bounds throw.
* `combineVerdicts([], [])` returns `pass: false`; duplicate judged verdict ids are refused. Judge-check ids distinguish criterion names that sanitize to the same string. Workspace-diff paths escape line separators.
* OpenAI, Anthropic and Google chat judge providers now send temperature zero.
* HTTP judge error diagnostics redact echoed nonempty authentication header values, including secrets shorter than eight characters.
* Leading reply labels are validated once against the declared winner; their stripped body is compared with both candidates, including JSON/plain equivalents. Labels cannot make shared content exclusive.
* Winner identity also accepts strict JSON text-field decoding, rendered separators, preserved or stripped list presentation and a matching leading reply label. A repeated shared opening in supplied following evidence is removed before extension. Paraphrase, contradictory labels and nonexclusive matches still abstain.
* New quote grounding ignores Markdown presentation syntax on both sides and requires a letter or digit from the quoted source text. Labels, renderer separators and punctuation alone abstain; frozen legacy is unchanged.
* Calibration adds PABAK, AC1 and agreement intervals. Chat providers use request-specific structured output schemas; OpenAI chat calls use temperature zero. Invalid caller requirement sets report their own diagnostic rather than an invalid-JSON error.

* New default transcripts use indexed JSON entries with explicit role fields. Literal role labels inside text cannot change an entry's role. Legacy prompt bytes remain unchanged.

## [0.1.0] - 2026-10-12

The first public release. driftbench evaluates AI agents block by block: a block is one exchange with a conversational agent, or one step of a task done by a code-interpreter agent, with a Given, a When and a Then.

### Packages

`@agent-nexus/driftbench` (the `driftbench` command), `@agent-nexus/driftbench-core`, `@agent-nexus/driftbench-checks`, `@agent-nexus/driftbench-judges`, `@agent-nexus/driftbench-users`, `@agent-nexus/driftbench-adapters`, `@agent-nexus/driftbench-sandbox`, `@agent-nexus/driftbench-artifacts`, `@agent-nexus/driftbench-stats`, `@agent-nexus/driftbench-store`, `@agent-nexus/driftbench-report`, `@agent-nexus/driftbench-space`, `@agent-nexus/driftbench-generate`, `@agent-nexus/driftbench-estate`, `@agent-nexus/driftbench-validators` and `@agent-nexus/driftbench-vitest`, and `drift-bench` on PyPI (imported as `driftbench`). `@agent-nexus/driftbench-battery` stays private until it holds code.

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
* Python package `driftbench` (PyPI): runs specs through the CLI, typed results, a pytest plugin (`pytest --driftbench specs/`), and a Python function as the agent; `campaign run --process-command`; `--json` cells carry the end state and per-block verdicts. `@agent-nexus/driftbench-vitest`: `describeSpec(path, target)`, one vitest test per block (wave 3).
* `driftbench view`: a local web viewer of a store, with hand labels per block and criterion for judge calibration, and a browser journey in CI (wave 3).
* `driftbench simulate` and `campaign run --driver simulated`: a persona through the model port or a recording; `driftbench attack`, an adaptive attacker scored by the recovery record; `generate --model` (wave 3).
* `driftbench import traces` drafts specs from OpenTelemetry GenAI spans, Nexus traces or Claude Code sessions; `driftbench monitor --source traces` watches production traces for drift (wave 3).
* `campaign run --prompt` hands the prompt version to the agent; bundles carry their sources (wave 3).
* CrewAI, Vercel AI SDK, Pydantic AI and LiteLLM adapters, and one retry policy for every model call (`retry` on the target, `--retry-attempts`, `--retry-base-ms`, `--retry-max-ms`) (wave 3).
* The `tools_offered` check; mutants and the live runner never write through a symbolic link; hook rows match the settings matcher that covers a tool (wave 3).
* Validator frame: `--all-levels`, a blind auditor view, and blind journal rows leave the handover file alone (wave 3).

### Release

* Every publishable package carries a complete manifest, a README and the 0.1.0 version.
* `.github/workflows/release.yml` publishes to npm with provenance and to PyPI through trusted publishing, on a `v*` tag only.
* `tools/release/check.mjs` checks manifests, versions, this changelog and the contents of every pack.

[0.1.0]: https://github.com/achammah/driftbench/releases/tag/v0.1.0
