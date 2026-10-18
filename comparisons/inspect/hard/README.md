# Hard grading comparison

These sets test the four model-dependent rows in `docs/comparison/inspect.md`. Every set has 120 fictional cases, with 60 passes and 60 failures. Expected labels are attached to construction transformations before any model call. They are not part of a model input.

## Historical evidence

| Row | Old outcome | Old measurement |
|---|---|---|
| Model-graded QA | ahead | 71 correct of 72 calls, one unscored, versus 69 of 72 |
| Model-graded fact | ahead on cost | 20 of 20 for both; 0.00424305 versus 0.00680175 USD |
| Clean council | limit, equal by design | Fresh replay: 37 of 40 and three unscored for both reducers |
| Borderline council | ahead | 20 of 20 for both reducers; Haiku alone 19 of 20 |

The historical fact probe actually uses the QA template. Its numbers do not establish a comparison with the default fact template. This hard replacement uses the actual fact template. The borderline historical ahead label also overstates an equal reducer result. Neither historical claim is treated as a hard-set result. A fresh `SPLIT=all` replay of the old clean-council cassette against the current criteria returns 37 correct and three unscored of 40 for both reducers. All three misses are `explicit_confirmation.1`, `.2` and `.3`: commit `fbb7423c` changed that rubric, and no judge recording matches their current request hashes. The stored historical `council-all.json` is stale and cannot substantiate the page. The hard result does not depend on that stale summary.

`legacy-inventory.json` records complete file reads and hashes for the existing comparison directory. The GRADE parser, repeat reducers, intervals, sandbox, built-in deterministic scorers, logging and tool-policy rows do not need new model-judged sets. Their results come from code or runtime behavior, not a semantic model verdict.

## Construction

`generate.mts` fixes every case and label. `qa.json` and `fact.json` share the same three-fact task distribution. They compare different competitor prompt formats. Shared identical driftbench prompts reuse recordings; their costs must not be added as separate billed spend.

Factual transformations cover nearby numbers, bit versus byte units, equivalent time conversions, single and double negation, entity mismatch, omitted facts, added conditions, later corrections, rejected quotations, French and Spanish phrasing, long distractors, embedded grading instructions and partly correct fluent answers.

`panel.json` contains ten cases for each of the twelve original skill classes: care redirection, checks before promises, coverage before offers, explicit confirmation, resistance to instructions, honest tool failure, ledger preservation, no invented data, one question per turn, plain language, resuming the pending step and workbook accuracy. The question-count contract explicitly counts distinct requested information, not punctuation. Superseded drafts are excluded only when the individual criterion says so. Chronological actions are still judged in order.

`borderline.json` tests the care-redirection skill across twelve transformations. It distinguishes a possible review from a predicted resolution, a correct contact from a nearby number, a quoted customer claim from an endorsed promise, and a polite redirect from an additional resolving action.

Panel procedures use three Haiku votes per unique prompt. The hard panel has 105 distinct prompts across 120 labeled cases; borderline has 115. Identical inputs reuse their recorded votes. Each held-out row has 60 distinct prompts. Repeats remain sequential within each case; up to two cases run at once after owner authorization. They are repeated-model panels, not diverse-model councils. Weights are equal and frozen. Equal weighted abstaining voting and strict plain majority have the same result on the same three votes. Any advantage of the audit configuration is a prompt and procedure advantage, not evidence that the reducer is better.

## Competitor fidelity

The upstream source is pinned to `a1dbea8`, the revision named by the existing comparison. `upstream-model.py` and `upstream-LICENSE` retain the source and MIT license. `upstream.json` records its source URL and SHA-256. `qa-template.txt`, `fact-template.txt` and `instructions.txt` are extracted verbatim, including whitespace, from that source.

`verify-upstream.py` checks the three verbatim assets and executes the actual pinned majority reducer across all 27 three-vote combinations, with only Score bookkeeping stubbed. Its recorded control is compared with our weighted reducer in the tests. The same verifier executes the actual single-model scorer with a fake generation container across 17 default parser controls, including Unicode whitespace, word boundaries and nested grade mentions. This is a free protocol test; no model call occurs.

The runner mirrors the source's delimiter neutralization and last-grade parsing. Off-menu final grades are unscored; an earlier correct grade cannot override them. Both sides receive the same task semantics and submission. The fact template receives the expert answer in its Expert slot. Neither side receives an item ID, family name or expected label. The verbatim upstream user template runs under the original probe's neutral `You are a grader.` system message on the shared CLI transport. Both sides run `claude -p --model haiku`, with tools and MCP disabled, and at most two calls in flight, as authorized after the initial sequential runs.

## Audit procedure

`audit.ts` audits individual required and prohibited conditions, with verbatim evidence and reasoning. It treats conversions, attribution, chronology and double negation explicitly. Code computes pass only when every check is satisfied. A violated or missing requirement fails; unknown conditions or malformed ledgers are unscored. Fabricated evidence and duplicate requirement names are rejected.

This candidate is **not yet the shipped default**. It is a comparison-script configuration. It does not change the shipped judge package. The baseline and audit are both reported. Model extraction can still omit a requirement or make a coherent wrong claim; evidence validation alone cannot prove the semantics. The data is synthetic and the same hard set is used for tuning and reporting. A separate held-out set has 60 cases per row, generated with seed 20261013 through the same construction functions, fresh numeric and name bindings, and shuffled template choices. Labels and candidate hashes are frozen before any held-out call in `heldout-freeze.json`. The runner refuses changed frozen artifacts. Each procedure runs once per set; a panel run requires three sequential votes per case. No candidate edits follow held-out scores. Repeated templates produce related cases, so Wilson intervals describe these scored case proportions and do not establish general superiority on an independent population.

## Reproduce

From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 comparisons/inspect/hard/verify-upstream.py
node --import tsx comparisons/inspect/hard/generate.mts
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts all ours --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts all theirs --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts all audit --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts all ours --heldout --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts all theirs --heldout --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts all audit --heldout --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts qa arch --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts qa arch --heldout --replay
node --import tsx comparisons/inspect/hard/replay.mts
pnpm exec vitest run --config comparisons/inspect/hard/vitest.config.ts --maxWorkers=2
pnpm exec tsc -p comparisons/inspect/hard/tsconfig.json --noEmit
```

Omitting `--replay` calls only missing requests. A fresh measurement needs separately frozen new inputs and a recording archive; existing recordings are replayed. Set `CAP_USD` to a cumulative task cap. `SPEND_LEDGER` optionally names the append-only ledger. The runner stops starting calls at the cap or `DEADLINE`. The assignment deadline defaults to 2026-10-13 at 06:30 Europe/Brussels; a later reproduction must explicitly set a new deadline. Each call has a 0.02 USD cap, a two-minute timeout, and is recorded with a persisted reservation before it starts. An unknown returned cost reserves the entire call cap. An error stops the run for inspection rather than hiding or retrying it. New runner invocations persist an in-flight reservation before starting the CLI, so a process interruption cannot silently erase its possible cost.

`calls/part-*.jsonl` and the append-only `calls.jsonl` retain complete prompts, model answers, actual reported costs, conservative reserved costs, model usage and timestamps. A SHA-256 request digest binds the model, both prompt texts and repeat index. `*-ours.json`, `*-theirs.json` and `*-audit.json` contain all case verdicts, Wilson 95 percent intervals, unscored counts and attributable costs. Replay is free. Unscored cases count as incorrect in the primary accuracy denominator.

## Handoff fixtures

`fixtures/double-negation.jsonl` contains five recorded shipped-judge failures: `qa-negation-0`, `qa-negation-2`, `qa-negation-4`, `qa-negation-6`, and `qa-negation-8`. Each line contains the case ID, exact JudgeRequest input, expected pass verdict, recorded wrong fail verdict, complete wrong answer and request SHA-256 digest. The 111/120 shipped baseline remains unchanged. Zero model calls use the rejected `a52e41e39a27966b2a5ddccdc7e98b940da8cd97` commit. The owner authorizes `1270e1cb1eb324b2f3efbca816aa43fbcb092ae6` while independent review runs. Its label is **PR 115 default (under review)**. `arch-snapshot.json` retains the exact eight load-bearing source files and SHA-256 hashes; `arch.ts` materializes and imports them without changing the worktree package. Core and stats source have no diff between that commit and the baseline. The run supplies only criterion and transcript, with no custom system, requirement split, assessment, reference, fact-audit or legacy override. Its 120 hard and 60 held-out cases are exactly the baseline inputs. This task does not poll the architecture branch.

The scheduler change interrupts one fact-template attempt after 92 completed answers. All completed answers are retained and the 28 remaining cases resume from the cache. `interrupted.jsonl` records the unreported attempt and its 0.02 USD reservation. Its unknown actual cost is not presented as a measured charge. The reservation is included in the cumulative cap.

## Under-review diagnostics

`arch-evidence-diagnostic.json` isolates five hard-set unscored cases at the pinned PR 115 default. The model quotes the rendered `[agent] ` label together with valid source text; the grounding code searches the raw entry text, which lacks that label. Removing only the label in a free diagnostic restores each expected verdict. Official results and recordings remain unchanged. The independent review receives this finding. `qa-negation-2` remains a semantic failure: its recorded reasoning invents a requirement for direct affirmative phrasing.

The full pointwise held-out handoff is `1270e1cb-heldout.jsonl`; its 10 wrong and 6 unscored cases are `1270e1cb-heldout-failures.jsonl`. Each line includes the exact request, both prompt texts, raw reply, parsed result, model usage, request SHA-256 digest and cost. `candidate-heldout.jsonl` provides the same 60 cases and full recordings for the frozen candidate's 60/60 run; its complete prompt and scorer are in `audit.ts`, with freeze hashes in `heldout-freeze.json`.

`1270e1cb-heldout-changes.jsonl` pairs the baseline and new default on all 12 changed cases: eight regressions and four recoveries. All 16 new-default misses are passing cases; all 30 failing cases are correct. Several raw replies treat a literal `[context]` inside a typed agent entry as a real context role and dismiss correct facts as background. `arch-heldout-evidence-diagnostic.json` distinguishes this scope confusion from quote-grounding rejection. These diagnostics are free and never change the official results.

Request digests use `request_sha256` throughout the recording artifacts. Values and input hashes remain unchanged during the field rename. The branch history is scanned with `gitleaks detect --log-opts="origin/main..HEAD"` before updates are pushed.

## Deciding fresh-seed factual comparison

`deciding/freeze.json` freezes 60 new factual cases and their construction labels before calls. Seed 20261056 is selected only for 60 unique requests per procedure and zero matches to existing requests. No answer or outcome affects seed selection. The set uses the unchanged generator, 30 passing cases and 30 failing cases.

Four procedures run once each on these same inputs: main's shipped judge at `40aab09551e1b8702d576d3f28b63b12848cf572`, PR 115 default at `c576033232a7643d52a2b8a2d295e26f79a6b26a`, the original frozen `audit.ts` candidate, and the verbatim Inspect fact template. The candidate remains **not yet the shipped default**. The escaped-quote correction is excluded. Main's judge source matches the original baseline byte for byte. `deciding/main-snapshot.json` records the exact prompt and parser source. The newer PR default imports nine exact archived files, including typed JSON transcript framing, from `arch-deciding-snapshot.json`. Both shipped requests supply only criterion and transcript and use each commit's default contract.

For free replay, run each of ours, arch, audit and theirs:

```sh
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts fact ours --deciding --replay
```

Results are in `deciding/fact-*.json`. Every call remains in `calls/part-*.jsonl` or the active `calls.jsonl`, with full prompts, raw reply, cost and `request_sha256`. The runner checks frozen procedure and input hashes before the deciding run.

## Later candidate procedures

The original frozen audit and deciding fresh comparison remain unchanged. `normalized/` contains a separate correction for copied JSON quote escapes, with new frozen 60-case sets for panel and borderline. `scoped/` contains a shorter candidate with explicit criterion and trace scope, with new frozen 60-case sets for all four rows. Each procedure runs once against its own fresh shipped-judge and default controls. Every candidate is **not yet the shipped default**. Read each directory's README and freeze manifest for its source, seeds and limits.

The scope candidate treats the construction's complete fictional trace as its evaluation boundary. A production caller must guarantee completeness before this rule can establish absence of an action. It also distinguishes descriptive success pictures from mandatory reply content, writes evidence and reasoning before status, and removes only exact duplicate question/reference strings already present in the criterion. All original information remains supplied.

Historical source snapshots preserve their original package names and hashes. `archive-env.ts` creates cache-only wrappers for the renamed workspace packages before loading those snapshots. Each publication recording part is below the guard's 10 MiB scan limit; partitioning preserves every JSONL line and does not change requests, replies or costs.

## Frozen adaptive voting hypothesis

`adaptive/freeze.json` freezes the adaptive policy at 2026-10-13T01:50:49.954347+00:00, before any scope-set calls. Its source and labels remain independent of held-out outcomes. `audit-adaptive.ts` accepts the first conclusive, grounded ledger and consumes no later replies. Panel rows allow up to three attempts after unscored replies; factual rows use one attempt. `adaptive.mts` replays that policy over the shared prefixes already requested by the three-vote scope candidate. No extra model calls are made. Logical costs include only consumed requests; total physical spend bills shared recordings once. The original policy bytes remain in `adaptive/frozen-policy.txt`; formatting of the executable copy has an identical TypeScript compiler representation, recorded in the manifest. Every candidate is not yet the shipped default.

## Compact factual ledger

`audit-compact.ts` keeps the scope semantics and changes each check to four strings: requirement, exact evidence, brief reasoning and status code. The adapter validates every tuple and uses the same strict quote grounding. Satisfied absence checks need a non-empty source anchor. Only unscored replies may trigger another identical request, with at most three attempts; a conclusive verdict ends the procedure. `compact/freeze.json` fixes the procedure and fresh seed 61326 before calls. The original parser source and an identical emitted-JavaScript fingerprint document its type-only correction.

## Scheduling disclosure

Two controllers overlap before the exclusive runner lock is added, exceeding the global two-call limit. Both runners are suspended while their submitted calls finish; every reply and reported cost is retained. Factual scoring then finishes alone before panel scoring resumes. Subsequent runners acquire a per-worktree lock before loading reservations. The final spend sum comes from unique raw receipts, rather than intermediate reservation snapshots that can be stale during the overlap.
