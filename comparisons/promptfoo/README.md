# promptfoo comparison: reproducible rows

Scripts, case sets and recordings behind the promptfoo table rows, from this repository. Run from the repository root.

| Row | Command | Paid |
|---|---|---|
| 31 Trajectory: goal success | `npx tsx comparisons/promptfoo/goal-success/compare.mts` (reads the recorded judgments) | no |
| 31, regenerate the cases | `npx tsx comparisons/promptfoo/goal-success/make-cases.mts > comparisons/promptfoo/goal-success/cases.json` | no |
| 31, re-record the judges | `npx tsx comparisons/promptfoo/goal-success/judge.mts haiku` and `... sonnet` (claude command; CLAUDE_BIN overrides the command) | yes, about 0.05 USD in total |

The cases are fictional, generated from a fixed seed. The judges see the reply only, as an output-only rubric grades a block; the comparison does not test a judge that also reads the trace.

## Rows 26 and 28

| Row | Command | Paid |
|---|---|---|
| 26 Function-call validity | `npx tsx comparisons/promptfoo/function-call/measure.mts` (promptfoo's assertion is vendored verbatim under `function-call/vendor/`) | no |
| 28 Tool sequence diagnosis | `npx tsx comparisons/promptfoo/trajectory/measure.mts` (promptfoo's reason text is quoted from `src/assertions/trajectory.ts`) | no |

## Measured rows 7 to 19 and 32

Scripts that measure driftbench's checks against promptfoo 0.124.1 (MIT) on the same fictional inputs. Every case has
its label fixed by construction, so each verdict is a count of cases the side got right, with a 95% Wilson interval.
The sign test runs over the cases where exactly one side is right. Verdict: ahead or behind at p below 0.05, else equal.

### Setup

From the repository root:

```bash
pnpm install
(cd comparisons/promptfoo && npm install)
```

`npm install` puts promptfoo 0.124.1 in `comparisons/promptfoo/node_modules` and nowhere else.

### Commands

| Row | Command | Paid calls |
|---|---|---|
| 7, 8, 9, 10, 11, 12, 16 | `npx tsx comparisons/promptfoo/measure-deterministic.mts` | none |
| 13 | `npx tsx comparisons/promptfoo/measure-similarity.mts` | none |
| 32 (personal data) | `npx tsx comparisons/promptfoo/measure-pii.mts` | yes: 200 haiku calls, 0.0355 USD measured, capped at 1.5 USD |
| 19 | `npx tsx comparisons/promptfoo/measure-factuality.mts` | yes: 200 haiku calls, 0.0185 USD measured, capped at 1.5 USD |

Output lands in `comparisons/promptfoo/out/`, which is git-ignored. The factuality script needs the `claude` command on
the path, or `CLAUDE_BIN` set to its location.

### Rows and what each measures

| Row | Capability | Cases | Result |
|---|---|---|---|
| 7 | XML, HTML and SQL validity | 2,000 | ahead: ours 1,755, promptfoo 1,667 of 2,000; paired sign test p 0.0003 |
| 8 | regex | 120 | equal: `expect.regex` is case-sensitive, as a regular expression is by default. `expect.must` ignores case and is behind on the same cases, which the script also prints for reference |
| 9 | contains, contains-all, contains-any | 120 | equal |
| 10 | icontains family | 120 | equal |
| 11 | equals | 120 | behind on identical text; ahead when case, punctuation and spacing are ignored |
| 12 | starts-with | 2,000 | ahead: ours 2,000, promptfoo 1,886 of 2,000; paired sign test p below 0.001 |
| 16 | cost and latency bounds | 120 | equal |
| 19 | factuality against a reference | 100 | equal: both 100 of 100. The cases are easy (a wrong price against a clear reference), so this shows no gap either way and is not evidence of an advantage |

Not in these scripts:

- **35 initial messages:** served by a block's `given.prefix`, which replays the earlier history without asking the agent to answer it again. `packages/core/test/runner/run.test.ts` checks that the prefix is the replayed history. Not scored, because it is the same behaviour, not a competing one.
- **36 stateful simulated user (send only the latest message):** a limit, not built. Every adapter sends the full history on each block, which keeps each block independent of server-side state. A stateful mode would make a block's result depend on what earlier blocks left on the server.
- **32 prompt extraction:** not measured. Ours has no check for it; the D12 phrasings are unapproved drafts.
- **13 promptfoo similar (embedding cosine):** not measured. It needs an embedding API.
- **32 IBAN and national register numbers:** not measured. Our check validates them by checksum, so a fair test needs valid numbers built outside our validator.

### Settled rows (independent seeds per row, paired sign test)

| Row | Result |
|---|---|
| 7 markup | ahead, 2,000 cases |
| 11 equals | two modes: `exact_strict` ties on identical text (120 of 120 both); the default is ahead on loose truth (120 of 120 vs 53) |
| 12 starts-with | ahead, 2,000 cases |
| 9, 10, 16 | equal on accuracy (ceiling). Diagnosis: `measure-diagnosis.mts`, see below |

Diagnosis (`out/diagnosis.json`): of 101 failing `must` verdicts, 101 name the closest span of the reply and how far it
differs; promptfoo names none of its 88 failing icontains reasons. Of 120 failing budget verdicts, all say how far over the
limit; promptfoo's latency reason gives the value and threshold only.

### Row results added

| Row | Cases | Result |
|---|---|---|
| 13 levenshtein against similarity | 100 held-out (100 dev chose thresholds) | ahead: ours 67 of 100, promptfoo 50 of 100; sign test p below 0.001. Set is fictional and built so character distance cannot separate a case change from a price change, so this is a result on this set, not a general claim |
| 32 personal data in replies | 200 | equal: ours 200 of 200, promptfoo 199 of 200; sign test p = 1 |

### Reading the numbers

`onlyOurs` counts cases where ours is right and promptfoo is wrong. `onlyTheirs` counts the reverse.
The equals row has two truths: strict (identical text) and loose (case, punctuation and spacing ignored). Both
are printed, because the right one depends on what a reply should be judged by.
