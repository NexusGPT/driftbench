# Shipped judge against Inspect

This folder scores the judge that the checkout ships against the default Inspect graders, on the hard grading sets of the parent folder. The driftbench side loads `packages/judges/src` directly. No commit is pinned and no prompt is copied here.

The earlier runner (`../run.mts`) loads a snapshot of the judge source at commit `40aab095`. Its "shipped baseline" rows describe that older prompt, which the package now keeps as `answerContract: 'legacy'`. Those recordings and results stay as they are.

## Procedures

| Name | What runs |
|---|---|
| `audit` | The opt-in answer audit of the judges package, `assessment: { kind: 'answer-audit' }` |
| `default` | The judge a caller gets with no option set, wired as the earlier comparison wired it: the criterion and the submission as one agent entry |
| `theirs` | The verbatim `model_graded_qa` and `model_graded_fact` templates of inspect_ai, pinned at `a1dbea8`, with the upstream grade parser |

`request.ts` holds the exact request of each driftbench procedure. Both sides receive the same task and the same submission. On the QA, panel and borderline rows both sides receive the same criterion. On the fact row both sides receive the expert answer, and the driftbench criterion is the question of the Inspect fact template. No case id, family or label enters a request.

Every side runs `claude -p --model haiku` with the flags of `packages/judges/src/clients/claude-cli.ts`. QA and fact rows use one vote. Panel rows use three votes of the same model: the weighted panel with equal weights on the driftbench side, plain majority on the Inspect side. A driftbench vote asks once more after an answer that breaks its contract, as the shipped single judge does. Those extra calls are counted in the call and cost columns. An unscored or incomplete case counts as wrong.

## Development data

The 240 held-out cases of the parent folder (seed 20261013) and the 240 cases under `../scoped/` have been read during diagnosis and used while the answer audit prompt was written. They are development data from this point on. `dev/pool1` and `dev/pool2` hold the results on them.

The audit prompt changed once, after the first pass over pool 1. Pool 2 ran once, after that change, with no further edit.

## Held-out run

`heldout/freeze.json` names the judge commit, the seeds and the SHA-256 of every file that decides a verdict on either side: the judge package source, the request builders, the Inspect templates and parser, the generator and this runner. The runner refuses a held-out set when one of those files differs. The freeze was committed and pushed before the first held-out call. Each side ran once.

The seed rule was fixed before any outcome existed: per row group, the first seed at or after a start value whose 60 requests are unique on each side and match no request recorded earlier.

Results: `heldout/results.md`. Pooled over the four rows and paired by case: answer-audit 240 of 240, Inspect default 234 of 240, exact McNemar p = 0.031 (6 cases only answer-audit gets right, none only Inspect). The driftbench default judge: 233 of 240, p = 1.0. The pooled test was named after this set was frozen and before its result was read, not when the set was frozen; read it as a pooled summary of one pre-frozen run.

A session limit of the model provider stopped the Inspect panel and borderline rows partway. Those calls returned no answer; the runner never caches a no-answer, so the rerun asked only the missing requests. No answer was discarded and no completed case was asked again.

## Fresh held-out run, 480 cases per row

`heldout-480/freeze.json` holds the pre-registration, the seed ranges and the SHA-256 of 74 frozen files. It was committed before the first call on these sets (commit `d6c6e6bec`). `verify-freeze.mts` printed `verified 74 frozen files` before each row and again after the run. Run `verify-freeze-at.mts heldout-480/freeze.json e3299c2c6` to check the 74 frozen files as they were at the run commit. `verify-freeze.mts` checks the working tree and fails once the judge package on main moves on. Each procedure ran once. The replay of all twelve result files from the recordings made no call and reproduced every file byte for byte. Full tables: `heldout-480/results.md`.

Primary test, as registered: all four rows pooled, paired by case, driftbench answer-audit against Inspect default, exact two-sided McNemar test, unscored counts as wrong.

| Procedure | Correct | Only this procedure | Only Inspect | p |
|---|---|---|---|---|
| driftbench answer-audit | 1918 of 1920 | 34 | 2 | 1.9e-8 |
| Inspect default | 1886 of 1920 | | | |

Registered secondary test, same pooling: driftbench default against Inspect default.

| Procedure | Correct | Only this procedure | Only Inspect | p |
|---|---|---|---|---|
| driftbench default | 1855 of 1920 | 22 | 53 | 0.00045 |
| Inspect default | 1886 of 1920 | | | |

The driftbench default judge is worse than Inspect default on this pooled set. The loss sits on the grader panel row: 436 of 480 against 475 of 480, with 26 cases the default panel left unscored (each counted as wrong).

Per-row counts (descriptive, as registered):

| Row | Answer-audit | Driftbench default | Inspect default |
|---|---|---|---|
| Model-graded QA | 480 of 480 | 470 of 480 | 461 of 480 |
| Model-graded fact | 478 of 480 | 469 of 480 | 470 of 480 |
| Grader panel | 480 of 480 | 436 of 480 | 475 of 480 |
| Panel, borderline | 480 of 480 | 480 of 480 | 480 of 480 |

The per-row McNemar tests in `heldout-480/results.md` were not registered. They are exploratory.

Cost and calls over the four rows, from the recorded calls: answer-audit 2.48 USD and 3881 calls, driftbench default 1.77 USD and 3899 calls, Inspect default 1.77 USD and 3840 calls. The answer-audit costs about 40 percent more than either other procedure per case.

All cases in this run still come from the same twelve transformation families, so the limits below hold for this run too. The answer-audit prompt was written while reading the earlier development sets, not these.

## Limits

* The generator builds every case from the same twelve transformation families. A fresh seed gives new names, numbers and template choices, not new kinds of difficulty. Finding 60 requests that were never recorded took a scan of many thousand seeds on the factual rows. These results do not establish accuracy on other material.
* Both sides score between 57 and 60 of 60 on the earlier sets. At 60 cases a paired test has little power near that ceiling: six cases must go one way and none the other before the exact test falls under 0.05.
* The panel rows repeat one model three times. They are not councils of different models.
* The answer audit reads one entry that renders several labelled turns as a record of those turns. A caller with real role-separated entries should pass them: inside a rendered record, a label written by the agent cannot be told apart from one written by the caller.

## Reproduce

From the repository root. Replay is free and reads the recordings under `calls/` and the parent folder.

```sh
for row in qa fact panel borderline; do
  for side in audit default theirs; do
    CAP_USD=0 node --import tsx comparisons/inspect/hard/shipped/run.mts $row $side \
      --set shipped/heldout/$row.json --out shipped/heldout --replay
  done
done
node --import tsx comparisons/inspect/hard/shipped/report.mts shipped/heldout
pnpm exec vitest run --config comparisons/inspect/hard/vitest.config.ts comparisons/inspect/hard/shipped.test.ts
```

The 480 run replays the same way with `--set shipped/heldout-480/$row.json --out shipped/heldout-480`, and `report.mts shipped/heldout-480`.

Without `--replay` the runner calls the model for missing requests only, up to `CAP_USD`, with a 0.02 USD cap per call. A call that returns no answer is retried twice and is never cached.
