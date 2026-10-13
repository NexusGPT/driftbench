# Fresh fixed-seed hard rows

Pre-registered protocol, 2026-10-13. No model calls occur before this protocol,
the cases, rendered requests, generators and scoring code are committed.

- Source: origin/main at 5a90bfb698d2200d391fb3d626e316744d22854e.
- Fixed seed: 20261217. Each row has 192 cases, 96 pass and 96 fail.
- Each of the original 12 families contributes eight pass and eight fail cases.
- Cases are fictional and labelled by the original paired code construction.
- No exact payload overlaps either original tuning or held-out set. Prior sets remain unchanged.
- The reference row uses eight profiles, Vela-21 through Vela-28. Its original
  held-out profiles were Vela-49 through Vela-53. No family text is changed.
- Rubric cases come directly from the original make_sets(seed, 192) function.

## Configurations

driftbench uses current main's buildPrompt and parseJudgeText without an optional
answerContract, requirements, factAudit, assessment or system override. Requests
match the reports' default configurations and provide the complete criterion,
transcript and, for reference correctness, trusted reference. Source hashes are
frozen. Production source is not edited.

promptfoo uses its pinned DEFAULT_GRADING_PROMPT and native
deriveVerdictFromGrader with no custom threshold. Provenance and the native
decoder sources remain in comparisons/promptfoo/hard/vendor.

Langfuse uses its pinned managed Correctness template, unchanged, with the best
reported threshold of 0.5. The existing benchmark's JSON decoder and one strict
quote repair are reused. No new threshold is selected from these results.

Both sides use the same claude CLI flags and haiku alias. Resolved model, reported
cost, usage, full request, raw answer and timestamps are retained per call.
There is one answer per request, with no retry, fallback model, optional judge
procedure or tuning. Inconclusive and malformed answers count as wrong.

## Execution and analysis

- Two model calls maximum at once, across both rows and both sides.
- Both sides of a case run together. Cases follow the generated fixed shuffle.
- Each call reserves USD 0.03; the cumulative cap is USD 10. Unknown billing
  retains its full reserve and stops the run. Each side's run is logged.
- Each request is journaled before dispatch and each answer is flushed to disk.
- Accuracy uses all 192 cases per row, including inconclusive judgments.
- The primary test is an exact one-sided paired sign test. Let W be cases where
  only driftbench is correct and L cases where only the peer is correct. Then
  p = sum(comb(W+L,k), k=W..W+L) / 2**(W+L), with p=1 if W+L=0.
- The predeclared alternative is driftbench accuracy greater than peer accuracy.
- Report W, L, exact rational p, decimal p, both accuracy values and USD per 100.
- These are nominal case-level tests on repeated synthetic families. Cases share
  templates and profiles, so independence and generalization are limited. Two
  row tests are reported separately without a family-wide superiority claim.
- No cases, labels, prompts, configurations or parsers change after the first call.

Run `python3 comparisons/astra-hard/run.py --ledger /absolute/path/spend-ledger.md`
for a free preflight. Add `--execute` for the registered run. Score recordings
with `python3 comparisons/astra-hard/score.py`. No scoring command calls a model.
