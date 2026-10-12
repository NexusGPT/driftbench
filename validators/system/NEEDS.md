# Needs of the system bank

Every item family of the system validator, the product need it tests and how many items it holds (bank version 5, 2383 items). The need is the docs page or design section whose promise the family turns into checks; claim families quote the page and section in each item's title. No family is quarantined: each one has a need below.

| Family | Items | Product need |
|---|---|---|
| store-roundtrip | 34 | docs/running.md "The store": a run record written and read back unchanged |
| store-stress | 40 | docs/running.md "The store"; packages/store/src/errors.ts error codes |
| combo-store-file | 90 | docs/running.md "The store", read across every check kind, adapter and mode (docs/validators.md 12.2, combination) |
| combo-store-memory | 90 | the same, on the memory store |
| robust-concurrency | 21 | docs/running.md "The store"; docs/datasets.md (versions pushed by two processes) |
| robust-resume | 20 | docs/running.md "Resume" |
| robust-transfer | 24 | docs/datasets.md "Run a campaign again elsewhere" (export and import) |
| robust-version | 23 | docs/running.md (an older store), docs/reference/spec.md (older spec fields), docs/validators.md (floors format version 1) |
| resume-budget | 21 | docs/running.md "Resume" and the budget option |
| fault-position-mode | 60 | docs/concepts/drift.md and docs/reference/checks.md: a planted fault fails its block on the check that reads it, in every mode |
| fault-adapter | 30 | the same through the http adapter (docs/adapters/http.md) |
| fault-multi | 25 | docs/concepts/drift.md: each failing verdict stays on the block that produced it |
| fault-perturbed | 20 | docs/concepts/recovery.md: positions shift by one from an injected block |
| clean-shapes | 38 | docs/reference/checks.md: a correct reply in any shape passes every check |
| hostile-inputs | 24 | docs/reference/checks.md: a reply that only looks right fails |
| drift-class | 44 | docs/concepts/drift.md "The engine of phase 3 assigns" |
| run-fields | 31 | docs/concepts/block.md and docs/concepts/drift.md: the fields of the run record |
| recovery | 40 | docs/concepts/recovery.md "The label rule" and its fields |
| variance | 31 | docs/concepts/statistics.md: Wilson coverage, the design effect, the parity verdict |
| version-drift | 24 | docs/comparison.md: two versions compared spec by spec |
| replay | 28 | docs/concepts/run-modes.md "Around the modes": replay equals live |
| failure-handling | 20 | docs/retries.md and docs/running.md: a failing agent or transport gives the documented status |
| cli-documented | 45 | docs/running.md "Exit codes" and the option tables |
| scale | 76 | docs/validators.md 12.2 item 4: correct and slow is a failing item (ten and a hundred times the size) |
| report-brute-force | 51 | docs/concepts/statistics.md, docs/concepts/drift.md, docs/scorecards.md: every number the report prints, recomputed from the raw runs |
| claim-report | 39 | docs/scorecards.md, docs/concepts/statistics.md, examples/acme/reports/README.md |
| claim-checks | 156 | docs/reference/checks.md |
| claim-spec | 144 | docs/reference/spec.md, docs/reference/cli.md "Issue codes", docs/concepts/given-when-then.md |
| claim-concepts | 120 | docs/concepts/statistics.md, drift.md, recovery.md, run-modes.md |
| claim-cli | 60 | docs/reference/cli.md, docs/running.md, docs/datasets.md |
| claim-cli-flags | 31 | docs/reference/cli.md and docs/running.md option tables |
| claim-adapters | 79 | docs/adapters/process.md, http.md, function.md, index.md "The contract suite" |
| breaker-checks | 46 | docs/reference/checks.md (blind breaker, from the docs and the command line only) |
| breaker-cli | 48 | docs/reference/cli.md, docs/running.md (blind breaker) |
| breaker-datasets | 59 | docs/datasets.md (blind breaker) |
| breaker-spec | 54 | docs/reference/spec.md, docs/reference/cli.md (blind breaker) |
| breaker-tools | 38 | docs/reference/cli.md, docs/estate.md, docs/adapters/claude-code.md, examples/acme/ci/README.md (blind breaker) |
| breaker2-compare | 38 | docs/concepts/statistics.md, docs/reference/cli.md, examples/acme/ci/README.md (second blind breaker) |
| breaker2-import | 36 | docs/datasets.md, docs/traces.md (second blind breaker) |
| breaker2-ops | 53 | docs/simulated-user.md, docs/attack.md, docs/traces.md, examples/acme/ci/README.md (second blind breaker) |
| breaker2-report | 24 | docs/scorecards.md, docs/aggregates.md, docs/reference/cli.md (second blind breaker) |
| breaker2-viewer | 29 | docs/viewer.md (second blind breaker) |
| exits-campaign | 55 | docs/running.md "Exit codes", docs/reference/cli.md |
| exits-generate | 30 | docs/reference/cli.md (extract, generate) |
| exits-readers | 83 | docs/reference/cli.md (estate, judge, family, queue and the other readers) |
| exits-registry | 21 | docs/reference/cli.md and docs/datasets.md (dataset, prompt) |
| exits-space | 26 | docs/reference/cli.md (space) |
| exits-spec | 28 | docs/reference/cli.md (spec) |
| exits-suite | 53 | docs/reference/cli.md (gate, select, holdout, pilot) |
| exits-users | 37 | docs/reference/cli.md, docs/simulated-user.md, docs/attack.md |
| exits-verdict | 46 | docs/reference/cli.md (report, compare, ci, monitor) |
