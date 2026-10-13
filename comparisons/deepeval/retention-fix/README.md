# Shipped knowledge retention measurement

This harness measures only the `knowledge` cases from the existing hard corpus.
It reads the current shipped criterion YAML and calls the package's `buildPrompt`
and `parseJudgeText`. It adds no benchmark-specific rubric, heuristic, answer
repair, or verdict override. Case labels never enter the model request.

The default is free replay. Paid calls require `--record`, a run cap, and an
absolute external spend ledger path. All commands run from the repository root.

```sh
python3 -m unittest discover -s comparisons/deepeval/retention-fix -p 'test_harness.py' -v

# Optional pre-change tuning, using the archived starting criterion:
python3 comparisons/deepeval/retention-fix/run.py tuning \
  --tag tuning-before --criterion comparisons/deepeval/retention-fix/criterion-before.yaml \
  --record --cap-usd 1 --ledger /absolute/external/spend.md

# Current production candidate; do all tuning before freezing:
python3 comparisons/deepeval/retention-fix/run.py tuning \
  --tag tuning-final --record --cap-usd 1 \
  --ledger /absolute/external/spend.md

python3 comparisons/deepeval/retention-fix/run.py freeze \
  --selected comparisons/deepeval/retention-fix/tuning-final.json

# Exactly one heldout attempt, only after the final candidate freeze:
python3 comparisons/deepeval/retention-fix/run.py heldout \
  --tag heldout-final --record --cap-usd 1 \
  --ledger /absolute/external/spend.md
```

Do not change production source or the runner during a run. Every case checks the
recorded source hashes. The freeze hashes the judge and core TypeScript sources,
package manifests, lockfile, TypeScript configuration, criterion, renderer, and
runner. The inherited TypeScript config and workspace manifests are included. It also hashes both corpus files without inspecting heldout cases.
Historical criterion overrides are tuning-only and cannot be selected for freeze.

Freezing requires a complete current-production tuning report. Freeze prohibits
further tuning. Heldout evaluation writes an exclusive persistent start marker
before parsing heldout cases. A failed or interrupted heldout attempt still
consumes that attempt. No retries or post-result tuning are allowed. Use the
saved report for subsequent analysis; do not remove the marker to rerun.

## Evidence and spending

Each tag writes rendered prompts and a report. `calls.jsonl` stores the full
request, its SHA-256, raw CLI stdout and stderr, response text, requested model,
actual model identities, usage, flags, and reported cost. Reports retain the
production parser result and distinguish failed calls and inconclusive answers.
They count inconclusive answers as incorrect against the fixed denominator.

The budget ledger reserves USD 0.05 before every invocation and settles the
reservation with the reported cost. A crash leaves the reservation charged.
Missing cost remains a reservation and stops the run. One process lock serializes
runs; the cumulative cap is USD 5 for this harness across every tuning and heldout
tag, with an additional caller-selected cap per run. This cap does not cover
unrelated calls made outside this harness. The CLI receives the same per-call
budget limit; an unexpectedly higher reported charge is recorded and stops the
run. The harness cannot undo an upstream overcharge.

Every invocation appends a row to the supplied external Markdown ledger using:
`Time | Run | Calls | Charged USD | Reserved USD | Evidence`. Reserved costs are
reported separately when the CLI did not return a valid cost. The internal
append-only reservation ledger remains the authority after process interruption.

The CLI runs in a fresh empty `/tmp` directory outside the repository and operator
home. It receives a replacement system prompt, no tools, no MCP configuration, no
settings sources, no skills, no session persistence, one turn, safe mode, and no
permission prompts. Safe mode disables automatic project and operator instructions
while retaining normal authentication. Caller session and workspace environment
variables are allowlisted for execution and authentication; provider endpoints and loader overrides are excluded. Authentication is
never recorded. There is no permission bypass. CLI flags were checked against the
installed `claude --help` before implementation.

Response-only email identifiers and the operator home path are redacted if they
appear. Known fictional email values in the input remain evidence. Exact originals
of redacted records stay in `.runtime/private/originals.jsonl`, mode 0600, under a
mode 0700 folder excluded from git. A known operator identifier in the input blocks
publication. Read access to the existing private operator-email file is used only
for this redaction check. Do not commit `.runtime`.

## Historical comparison

Historical heldout knowledge scores are **68/72 for the archived Driftbench
baseline** and **69/72 for DeepEval 4.2.8**, as recorded in
`../hard/baseline-heldout-scores.json`. These are historical comparator scores,
not new measurements of today's shipped criterion or parser.

Only after completing an evaluation does the harness read the corresponding
historical case results. It verifies the corpus hash, case IDs, and labels before
reporting paired correctness counts and an exact two-sided paired binomial test.
Heldout compares against `../hard/baseline-heldout.json`; tuning compares against
`../hard/baseline-v3.json`. Existing DeepEval calls are reused as historical
observations, never rerun. The report names and hashes that historical source.
The current measurement uses the typed production parser, while the archived
baseline used its historical verdict parser. The fresh starting-package tuning run
uses the initial criterion and parser at the starting main revision, before the later
main merge. Its source hashes and rendered requests identify that version. Treat that difference as part of the
measured package change. One heldout run does not establish repeat-run stability.

No model calls or heldout case inspections were performed while building this
harness. Aggregate historical scores were read to establish the comparison.

The final runner also verifies the selected tuning report hash before heldout evaluation,
records CLI/runtime versions, includes the CLI version in cache keys, and verifies source
hashes after the last invocation. The starting-package run predates these recorder guards;
its raw model identity, request hashes and cost remain recorded.

The interrupted `tuning-current` report contains 11 completed cases. The final
tuning tag reuses those exact request recordings, then records the remaining
cases. One interrupted invocation has no returned charge and keeps its USD 0.05
reservation. No heldout attempt had started at that interruption.

The harness makes one CLI invocation per fresh case, with no harness retries.
The CLI's internal transport retry behavior is not independently measured. The
requested `haiku` alias is resolved by the installed CLI; each actual model name
is recorded and must belong to Haiku, but the alias is not version-pinned.
