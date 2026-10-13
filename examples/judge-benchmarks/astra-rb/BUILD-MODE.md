# Execution research contract

- Objective: execute both code replies with validated generated inputs, add instruction-grounded countable checks, and measure all 357 dev pairs against the frozen binary judge.
- Isolated branch: research/astra-rb-exec from origin/main at 5a90bfb6.
- Owner: this worker owns this worktree. All other worktrees are read only.
- No further agent fan-out: a single dependent generator, validator, adapter, executor, scoring pipeline. Model queue starts with two slots and expands to six after the owner update.
- Budget: Haiku only, USD 12 total after the owner update; calls and reproduction cost recorded separately.
- Deadline: 2026-10-13 06:35 Europe/Brussels last new model call; 06:40 commit, push and report.
- Frozen tie ids are excluded from every new generation and execution step and retain their original decisions.
- Labels are scoring-only. C1 generators receive the question and rubric; C2 generators receive the question only; adapters receive exact candidate snippets and the input contract, with no labels or expected outputs.
- A machine decision requires a valid check and asymmetric pass/fail. Missing context, unsupported dependencies, ambiguous inputs, and two failing candidates abstain.
- Every input passes a generated validator before either candidate executes. A question-only reference and supplied examples establish expected outputs.
- Execution uses packages/sandbox localProvider plus the macOS sandbox-exec policy, with networking denied, host writes denied, home reads denied except the interpreter runtime, and bounded commands.
- Full dev score is required. A gain of at least 3 percentage points freezes the commit and opens the conditional disjoint TEST confirmation. Otherwise TEST remains untouched.
