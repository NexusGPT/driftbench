# RubricBench validated machine checks

Research from the frozen binary canonical judge. Model: Haiku through the same recorded CLI harness. Sandbox: this worktree's packages/sandbox localProvider, wrapped in macOS sandbox-exec. Candidate code never executes outside that boundary.

## Contract

- The 55 frozen rubric ties remain untouched. Code and MBPP comprise 83 dev pairs; 15 are council-owned ties, leaving 68 eligible code pairs.
- A question-only generator defines inputs, an independent input validator, reference program or supplied-example oracle, and a shared observable output contract.
- An independent contract audit sees the question, rubric, tests and oracle observations before candidate execution. It sees no candidates or labels.
- Each candidate has a separate adapter. The adapter receives no expected output, label or frozen verdict. It reads the original fenced code, with only harness scaffolding permitted. Another audit checks preservation before execution.
- Both candidates run on the same validated cases. Exceptions, output mismatches and passes remain visible. Missing dependencies, rejected contracts and incomplete observations abstain.
- A final machine decision needs one candidate to pass every comparable block and the other to fail at least one. Both passing, both failing, unknown and oracle-free disagreements retain the frozen judge.
- Countable constraints come from the instruction plus rubric. Each generated checker has positive and negative fictional fixtures, exact source anchoring and an independent contract audit. A fail cannot be overwritten by an LLM grade.
- Full dev scoring includes every original pair. Canonical caller orders are correlated copies, so paired tests use the pair as the independent unit.

## Runs

From this worktree:

1. Run prepare.py with the read-only frozen worktree and existing dataset-cache paths. It writes dev inputs only to the ignored local cache.
2. Run generate.ts. This produces C1 candidates. Its preliminary C2 plans are exploratory.
3. Run question-only.ts after the first run finishes. This replaces all C2 plans using the instruction alone.
4. Run preflight.ts, then execute.ts. Never overlap the model-calling programs: the final executor owns a queue of six calls, as authorized by the owner.
5. Run check-validation.ts, apply-validation.ts, then review.ts before score.ts. Review separating observations without labels first.
6. Run score.ts for the full-dev report. Replays use recorded prompt hashes and cost nothing.

The earlier recover.ts file is an exploratory generator. recover-runtime.ts was prepared but never run. They are not required by the final pipeline.

## Runtime observations

A separate probe records denial of outside reads, outside writes and network connections. A deliberate loop exits with sandbox timeout status 124. Execution records retain exit code, bounded stdout/stderr, source-binding audits and timestamps.

The ignored local environment contains Node dependencies, a Python virtual environment and a portable .NET SDK. Java comes from the read-only frozen worktree's portable JDK. No candidate may fetch a package or use a remote service. Dependency versions and probe output are recorded with the result.

## Cost and release gates

- Research spend cap: USD 12 after the owner update. Every successful CLI cost remains in recordings and the shared append-only spend ledger.
- Feature bar: at least four code/MBPP fixes, zero code/MBPP breaks, extra machine-check cost below USD 0.07 per 100.
- TEST bar: at least three overall dev percentage points. Freeze the commit first, then evaluate a fixed, stratified cohort disjoint from tonight's 434 sampled pairs, beside the frozen judge.
- A feature-bar pass alone does not authorize TEST. After a freeze, no tuning against that TEST pass is allowed.

## Measured result

Full DEV: 296/357 (82.91%), frozen 294/357 (82.35%). Two fixes, zero breaks, exact paired p=0.5. Code/MBPP remains 69/83 with zero fixes and zero breaks. Both candidates execute on 15 of 68 eligible code pairs; this is partial execution coverage. Valid execution separates no pair. Countable checks decide 13 pairs correctly.

Combined checks cost $0.227167 per 100, total $0.394338. Constraints alone cost $0.062493 extra and $0.229664 total per 100. Observed research spend is $1.48020023; unreturned provider costs are unavailable. Neither release gate passes. No TEST evaluation occurs. See [the full report](results/REPORT.md).
