# JudgeBench reference reliability experiments

Use the fixed JudgeBench dev split only. Official labels and competitor templates stay unchanged. Label-audit exclusions never enter judge prompts.

| Candidate | Mechanism |
|---|---|
| driftbench-contrast | Falsify both proposals without a generated reference. |
| driftbench-direct | Name A or B directly, eliminating pass/fail translation. |
| driftbench-direct-ledger | Reuse identical direct outputs and compute the winner from correctness fields. |
| driftbench-direct-format-ledger | Compile general, quoted format instructions from the question alone and break equal-correctness ties with the executed checks. |
| driftbench-direct-strategy | Blind executable solve and backward checks for computations; five distinct blind knowledge solves, using a reference only on unanimous agreement. |
| driftbench-direct-strategy3 | Same evidence with three ledgers per displayed order. |
| driftbench-direct-strategy5 | Five knowledge solves with a preselected four-of-five agreement gate. |
| driftbench-direct-divergence | Validate exact quotes at the first computational disagreement, then focus the executable checker on that subquestion. |

Implemented candidates are not automatically measured. The report lists only complete full-dev runs in its score table. A twelve-pair stratified pilot verifies the executable route before a full run.

Keep temporary folders and dataset cache inside this worktree:

```sh
export TMPDIR="$PWD/examples/judge-benchmarks/jb-results/runtime"
export DRIFTBENCH_BENCH_CACHE="$PWD/examples/judge-benchmarks/jb-results/cache"
mkdir -p "$TMPDIR" "$DRIFTBENCH_BENCH_CACHE"
```

Run one candidate through the recording harness:

```sh
node --import tsx examples/judge-benchmarks/src/run.ts \
  --bench judgebench --split dev --model haiku \
  --contestants driftbench-direct-strategy --concurrency 1 --cap-usd 1 \
  --out examples/judge-benchmarks/jb-results/strategy.json
```

`--concurrency 1` serializes nested samples and both orders. Repeating with `--replay-only` makes no model call.

`jb-strategy-experiments.ts` runs supplied ids sequentially after `direct-baselines.json` exists. It requires `JB_SPEND_LEDGER` and the initial recording-key snapshot in `starting-keys.json`. Optional `JB_SAMPLE=12` runs a stratified pilot. The driver records evidence and costs, reserves 0.15 USD for interrupted calls and cap margin, limits each real call to 0.04 USD, and enforces this task's deadline. It stops at 95 percent complete official dev accuracy after the matching format comparison, or at the spend/deadline limit.

Build the official and audited score table by replaying complete configurations:

```sh
JB_REPORT_PATH=examples/judge-benchmarks/jb-results/report.md \
  node --import tsx examples/judge-benchmarks/src/jb-report.ts \
  driftbench-contrast driftbench-direct driftbench-direct-ledger \
  driftbench-direct-strategy driftbench-direct-strategy3 \
  driftbench-direct-strategy5 driftbench-direct-divergence
```

The report always includes adaptive and reference3. Costs include all recorded calls the configuration requires at their original reported prices, including free replays. New task spend is separate. Incomplete variants do not appear as complete scores.

`jb-mapping-audit.ts` screens dev recordings for explicit winner names that contradict pass/fail mapping. Its flags require manual review; a clean screen is not proof of no subtle contradiction. `jb-inspect.ts` supports simple reference/text candidates only; use the generic replay report for executable strategies.

Each strategy also has a `-format` counterpart. Both use identical judgement prompts; the format compiler receives only the question, not candidate responses or labels. It returns a quoted instruction and a pure predicate. The harness validates the quote, executes the predicate on both responses, and uses its boolean result only when both final answers are factually correct. Missing, conflicting or uncheckable requirements abstain. There are no item-specific format rules.

`label-audit.json` records ambiguous questions and defensible alternatives. Audited accuracy applies the same net-vote metric on retained official labels. It has a different denominator and does not replace the full official score.

Generated pure Python is bounded by a five-second timeout, capped output and an AST operation guard. On macOS it also runs through sandbox-exec, denying file writes, networking and child-process creation. The AST guard alone on other hosts is not an operating-system sandbox. Exceptions, malformed evidence and timeouts yield no correctness signal; one repair uses the actual error.

Tests use fake model commands:

```sh
pnpm -s vitest run examples/judge-benchmarks --maxWorkers=2
```
