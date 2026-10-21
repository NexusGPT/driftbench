# Example scorecards

`driftbench report` writes a scorecard as one HTML page. These were written from stored campaigns of the Acme example: everything ran in process or in a local sandbox, no model was called and nothing was billed. Fictional data only.

* [Acme campaign](../examples/acme/reports/acme.html): the Acme agents on both targets, modes T, F and P, 3 repeats.
* [Acme campaign with faults](../examples/acme/reports/acme-faults.html): the same campaign with two faults standing in for the agents, read against the first one, with the variance pilot.
* [Variance pilot](../examples/acme/reports/pilot-acme-random.html): the spread view on a small pilot campaign of a seeded random control, with per-cell intervals, wording ranges and the noise floor.

How each one was made, and what it shows, is in the [reports README](../examples/acme/reports/README.md). The commands are on the [running](running.md) page.

## Two scores

A scorecard built with diagnoses shows two pass rates side by side. `buildScorecard` takes the diagnoses (a block's own `diagnoses`, or `attribution.diagnoses` by run and block) and a fix plan, and adds an `attribution` object.

| Score | Counts a run as passed when |
|---|---|
| Machine pass rate | every gating verdict passes. It is the verdict as the checks wrote it, final and unchanged |
| Agent-attributed pass rate | every failing gating verdict is set aside by a diagnosis as `setup`, `excluded` or `credited`, so the failure is not the agent's |

A run with a failure that no rule attributed is counted apart as `unassigned`, and folded into neither rate. A run that completed with a block not run or blocked and no failure is in neither numerator nor denominator. It is counted in `unmeasuredRuns` (`notRun`, `blocked`), and its blocks in `blocks.notRun` and `blocks.blocked`, apart from the failing blocks. Both rates count only `scoredRuns`, the runs that passed or failed.

The HTML page opens a "Two scores" zone with both rates, the failing blocks by disposition and the ranked fix list. A run page lists each block's diagnoses, and a `non-default` badge names any rule file that is not a shipped default. `attributionText` gives the same as text. Without diagnoses the scorecard and its JSON are unchanged, byte for byte.

Limits: no command runs a diagnostic yet, so the zone appears for a program that registers the steps and builds the scorecard itself (see the [diagnostics](reference/blame.md#diagnostics) reference). A diagnosis never changes a verdict: the machine rate is the gate.
