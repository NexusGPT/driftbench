# promptfoo comparison: measured rows

Scripts that measure driftbench's checks against promptfoo 0.124.1 (MIT) on the same fictional inputs. Every case has
its label fixed by construction, so each verdict is a count of cases the side got right, with a 95% Wilson interval.
The sign test runs over the cases where exactly one side is right. Verdict: ahead or behind at p below 0.05, else equal.

## Setup

From the repository root:

```bash
pnpm install
(cd comparisons/promptfoo && npm install)
```

`npm install` puts promptfoo 0.124.1 in `comparisons/promptfoo/node_modules` and nowhere else.

## Commands

| Row | Command | Paid calls |
|---|---|---|
| 7, 8, 9, 10, 11, 12, 16 | `npx tsx comparisons/promptfoo/measure-deterministic.mts` | none |
| 13 | `npx tsx comparisons/promptfoo/measure-similarity.mts` | none |
| 32 (personal data) | `npx tsx comparisons/promptfoo/measure-pii.mts` | yes: 200 haiku calls, 0.0355 USD measured, capped at 1.5 USD |
| 19 | `npx tsx comparisons/promptfoo/measure-factuality.mts` | yes: 200 haiku calls, 0.0185 USD measured, capped at 1.5 USD |

Output lands in `comparisons/promptfoo/out/`, which is git-ignored. The factuality script needs the `claude` command on
the path, or `CLAUDE_BIN` set to its location.

## Rows and what each measures

| Row | Capability | Cases | Result |
|---|---|---|---|
| 7 | XML, HTML and SQL validity | 120 | see `out/deterministic.json` |
| 8 | regex | 120 | equal: `expect.regex` is case-sensitive, as a regular expression is by default. `expect.must` ignores case and is behind on the same cases, which the script also prints for reference |
| 9 | contains, contains-all, contains-any | 120 | equal |
| 10 | icontains family | 120 | equal |
| 11 | equals | 120 | behind on identical text; ahead when case, punctuation and spacing are ignored |
| 12 | starts-with | 120 | ahead: promptfoo does not drop leading space |
| 16 | cost and latency bounds | 120 | equal |
| 19 | factuality against a reference | 100 | equal: both 100 of 100. The cases are easy (a wrong price against a clear reference), so this shows no gap either way and is not evidence of an advantage |

Not in these scripts:

- **35 initial messages:** served by a block's `given.prefix`, which replays the earlier history without asking the agent to answer it again. `packages/core/test/runner/run.test.ts` checks that the prefix is the replayed history. Not scored, because it is the same behaviour, not a competing one.
- **36 stateful simulated user (send only the latest message):** a limit, not built. Every adapter sends the full history on each block, which keeps each block independent of server-side state. A stateful mode would make a block's result depend on what earlier blocks left on the server.
- **32 prompt extraction:** not measured. Ours has no check for it; the D12 phrasings are unapproved drafts.
- **13 promptfoo similar (embedding cosine):** not measured. It needs an embedding API.
- **32 IBAN and national register numbers:** not measured. Our check validates them by checksum, so a fair test needs valid numbers built outside our validator.

## Row results added

| Row | Cases | Result |
|---|---|---|
| 13 levenshtein against similarity | 100 held-out (100 dev chose thresholds) | ahead: ours 67 of 100, promptfoo 50 of 100; sign test p below 0.001. Set is fictional and built so character distance cannot separate a case change from a price change, so this is a result on this set, not a general claim |
| 32 personal data in replies | 200 | equal: ours 200 of 200, promptfoo 199 of 200; sign test p = 1 |

## Reading the numbers

`onlyOurs` counts cases where ours is right and promptfoo is wrong. `onlyTheirs` counts the reverse.
The equals row has two truths: strict (identical text) and loose (case, punctuation and spacing ignored). Both
are printed, because the right one depends on what a reply should be judged by.
