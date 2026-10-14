---
title: Replaying estate sessions
summary: Run a spec suite over recorded agent sessions with their guard decision logs and step feeds, offline and with no model call.
commands:
  - replay
see_also:
  - validate-estate-generate
  - validate-estate-maintain
  - validate-estate-stats
  - validate-estate-live
next:
  - validate-estate-live
---

## What it is

`driftbench replay` runs a suite of specs over recorded sessions of an agent, offline and deterministic. A
recorded session is the runtime's transcript (for Claude Code, its session JSONL), plus two optional files:

* a guard decision log, one JSON line per decision: `{at, event, check, verdict, session?}`;
* a step feed, one JSON line per stage reached: `{at, step}`.

The runtime's adapter maps the session onto a trace, one block from one user message to the next: tool calls
with their input (a helper dispatch with its brief), skill loads, guard verdicts and stages placed by time,
commands with exit codes, workspace changes, compaction markers. Each spec is checked against that trace
with the default checks, the ordered-pair check (`rules.custom.ordered`) and the estate checks. Nothing is
sent to a model unless `--judge` is given.

Alignment: a spec with `metadata.replay: { session, from_block }` reads that session from that block.
Otherwise the k-th spec without the key, in file order, reads the k-th session given, from block 0. A spec
naming a session not given is skipped with a note. A log or feed belongs to the session whose file name
starts its own (`clean-build.decisions.jsonl` goes with `clean-build.jsonl`); with one session, any log
belongs to it.

The ordered-pair check holds `{ before, after }` in a block when every `after` has a `before` earlier in the
block or an earlier block. A name matches a tool label (`Read`), a skill load (`skill:<name>`) or a stage
(`stage:<name>`). With `key`, both carry the same value in that input field (the same file was read, then
edited). With `reset: compaction`, a `before` earlier than the last compaction does not count.

## When to use it

* On the `specs/replay` folder that `estate generate` writes, over the sessions its index names: each spec is
  planned to pass or fail on its session.
* On sessions of the real agent, to check them against the estate's rules after the fact.
* As the regression run of `estate impact --replay` (topic `validate-estate-maintain`).

## Commands and every option

```
driftbench replay <sessions...> --suite <dir> [--decisions <logs...>] [--steps <feeds...>] [--store <db>] [--owner <values...>] [--owner-file <file>] [--judge claude:<model>] [--judge-command <path>] [--judge-budget <usd>] [--json]
```

| Option | Default | Meaning |
|---|---|---|
| `<sessions...>` | required | session transcripts (JSONL) |
| `--suite <dir>` | required | the spec files or folder to run |
| `--decisions <logs...>` | none | guard decision logs (JSONL), one per session, matched by file name |
| `--steps <feeds...>` | none | step feeds (JSONL), one per session, matched by file name |
| `--store <db>` | in memory | keep the runs in this store |
| `--owner <values...>` | none | the owner's own email, phone, IBAN or national number: the `pii` check leaves exactly these out |
| `--owner-file <file>` | none | owner values, one per line; `#` starts a comment line |
| `--judge <judge>` | none | judge the judged criteria with `claude:<model>`, such as `claude:haiku` (paid calls) |
| `--judge-command <path>` | `claude` | the command the judge runs |
| `--judge-budget <usd>` | none | stop judging once the judge spent this much; required for a billed judge |
| `--json` | off | print one JSON document |

With no judge, every judged criterion is inconclusive and gates as the criterion does, so its spec cannot
pass; a note says so.

## Inputs

* Sessions: `examples/estates/sessions` holds six synthetic sessions of a fictional shop-build estate with
  their logs, feeds and seven replay specs in `specs/`; `examples/estates/fixture/sessions` holds three
  Northwind sessions (one clean, one that skips the weekly-report skill, one that edits before reading) and
  their `index.yaml` for `estate generate`.
* A suite of specs with `target.adapter: claude-code`.

## Outputs and how to read them

One line per aligned spec: `✓` or `✗`, the spec id, the session and block it read and how it was aligned
(`metadata` or `order`), then `failing: block <n>: <check>` for a failure. Notes come first: skipped specs,
specs that expect guards or stages while no log or feed was given. The last line:
`<n> specs replayed: <p> pass, <f> fail. Judge none, 0.0000 USD. Campaign <id> (in memory).`

A spec kept from passing only by inconclusive checks (no step feed, no judge) is undecided: it counts as not
passed and the JSON marks it `undecided: true`. A spec kept from passing only by checks that do not apply (a
stage check on a run with no stage record) is not applicable and is counted apart. Without a decision log no
guard is seen, so a `count: 0` guard expectation passes and a positive one fails.

`--json` prints `{ campaignId, store, notes, judge, judgeCostUsd, runs: [{ spec, session, fromBlock,
aligned, runId, status, pass, failing }], passed, failed }`.

Exit 0 every aligned spec passes, 1 a spec fails, 2 bad input: a log passed as a session, two sessions with
one name, an unreadable session or a file that is not a transcript, an unreadable owner file, an invalid
spec, no spec aligned, a store that cannot be opened.

## Worked example

The seven replay specs of the shop-build sessions, then a suite generated from the Northwind hand plan over
its three sessions, stored, then one session as JSON, then a log passed as a session:

```sh
driftbench replay examples/estates/sessions/clean-build.jsonl examples/estates/sessions/compaction-mid-task.jsonl examples/estates/sessions/forbidden-act.jsonl examples/estates/sessions/gate-violated.jsonl examples/estates/sessions/skill-skipped.jsonl examples/estates/sessions/subagent-dispatch.jsonl --suite examples/estates/sessions/specs --decisions examples/estates/sessions/clean-build.decisions.jsonl examples/estates/sessions/forbidden-act.decisions.jsonl examples/estates/sessions/gate-violated.decisions.jsonl examples/estates/sessions/skill-skipped.decisions.jsonl examples/estates/sessions/subagent-dispatch.decisions.jsonl --steps examples/estates/sessions/clean-build.steps.jsonl examples/estates/sessions/gate-violated.steps.jsonl examples/estates/sessions/skill-skipped.steps.jsonl # exit 1
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out suite
driftbench replay examples/estates/fixture/sessions/weekly-clean.jsonl examples/estates/fixture/sessions/weekly-gate-violated.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.jsonl --decisions examples/estates/fixture/sessions/weekly-clean.decisions.jsonl examples/estates/fixture/sessions/weekly-gate-violated.decisions.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.decisions.jsonl --steps examples/estates/fixture/sessions/weekly-clean.steps.jsonl examples/estates/fixture/sessions/weekly-gate-violated.steps.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.steps.jsonl --suite suite/specs/replay --store replay.db # exit 1
driftbench replay examples/estates/fixture/sessions/weekly-clean.jsonl --suite suite/specs/replay --json
driftbench replay examples/estates/sessions/clean-build.decisions.jsonl --suite examples/estates/sessions/specs # exit 2
```

The shop-build replay:

```text
note: replay-price-sheet-build names the session price-sheet-build, which was not given; skipped
✓ replay-clean-build  session clean-build from block 0 (metadata)
✗ replay-compaction-mid-task  session compaction-mid-task from block 0 (metadata)
    failing: block 1: custom.ordered.Read.Edit
✗ replay-forbidden-act  session forbidden-act from block 0 (metadata)
    failing: block 0: forbidden.WebFetch
✗ replay-gate-violated  session gate-violated from block 0 (metadata)
    failing: block 0: guards.read-before-write.deny, block 0: execution.exit_code, block 0: custom.ordered.Read.Edit
✓ replay-negative-control  session gate-violated from block 0 (metadata)
✗ replay-skill-skipped  session skill-skipped from block 0 (metadata)
    failing: block 0: skills.shop-build, block 0: custom.ordered.skill_shop-build.Edit
✓ replay-subagent-dispatch  session subagent-dispatch from block 0 (metadata)
7 specs replayed: 3 pass, 4 fail. Judge none, 0.0000 USD. Campaign replay-c76db0fa4d16 (in memory).
```

Four sessions break a rule on purpose: an edit after a compaction without a fresh read, a denied tool, an
edit before a read, a skipped skill. The negative control runs on a faulty session and checks only what that
session did right, so it stays green.

The generated suite over the Northwind sessions (after the generate report):

```text
✓ estate.p03.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p03.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✓ estate.p03.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
✓ estate.p02.weekly-clean  session weekly-clean from block 0 (metadata)
✗ estate.p02.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
    failing: block 0: custom.ordered.Read.Edit
✓ estate.p02.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
✓ estate.p01.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p01.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✗ estate.p01.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
    failing: block 0: skills.weekly-report
✓ estate.p04.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p04.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✓ estate.p04.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
12 specs replayed: 10 pass, 2 fail. Judge none, 0.0000 USD. Campaign replay-7fbcafc5b44f.
```

The generate report said `Replay: 12 specs aligned to sessions, 10 planned to pass, 2 to fail.`: the two
failures are the planned ones (the route row on the session that skips the skill, the read-before-edit row
on the session that edits first).

The JSON of one session. The other sessions are not given, so their specs are skipped with a note:

```text
{
  "campaignId": "replay-ae78ab286050",
  "store": null,
  "notes": [
    "estate.p03.weekly-gate-violated names the session weekly-gate-violated, which was not given; skipped",
    "estate.p03.weekly-skill-skipped names the session weekly-skill-skipped, which was not given; skipped",
    "estate.p02.weekly-gate-violated names the session weekly-gate-violated, which was not given; skipped",
    "estate.p02.weekly-skill-skipped names the session weekly-skill-skipped, which was not given; skipped",
    "estate.p01.weekly-gate-violated names the session weekly-gate-violated, which was not given; skipped",
    "estate.p01.weekly-skill-skipped names the session weekly-skill-skipped, which was not given; skipped",
    "estate.p04.weekly-gate-violated names the session weekly-gate-violated, which was not given; skipped",
    "estate.p04.weekly-skill-skipped names the session weekly-skill-skipped, which was not given; skipped",
    "estate.p04.weekly-clean expects stages, but no step feed was given for weekly-clean"
  ],
  "judge": "none",
  "judgeCostUsd": 0,
  "runs": [
    {
      "spec": "estate.p03.weekly-clean",
      "session": "weekly-clean",
      "fromBlock": 0,
      "aligned": "metadata",
      "runId": "b38dbc31dc63c653",
      "status": "completed",
      "pass": true,
      "failing": []
    },
    {
      "spec": "estate.p02.weekly-clean",
      "session": "weekly-clean",
      "fromBlock": 0,
      "aligned": "metadata",
      "runId": "d4206268a2bfbbf1",
      "status": "completed",
      "pass": true,
      "failing": []
    },
    {
      "spec": "estate.p01.weekly-clean",
      "session": "weekly-clean",
      "fromBlock": 0,
      "aligned": "metadata",
      "runId": "086a2207ee2f90c5",
      "status": "completed",
      "pass": true,
      "failing": []
    },
    {
      "spec": "estate.p04.weekly-clean",
      "session": "weekly-clean",
      "fromBlock": 0,
      "aligned": "metadata",
      "runId": "e1089184acf881d6",
      "status": "completed",
      "pass": true,
      "failing": []
    }
  ],
  "passed": 4,
  "failed": 0
}
```

The last command prints
`examples/estates/sessions/clean-build.decisions.jsonl is a log, not a session. Pass decision logs after --decisions and step feeds after --steps.`

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `<file> is a log, not a session. Pass decision logs after --decisions and step feeds after --steps.` (exit 2) | a decision log or step feed among the sessions | move it after `--decisions` or `--steps` |
| `note: <spec> names the session <s>, which was not given; skipped` | the spec's `metadata.replay.session` is not among the sessions | add that session, or ignore the note |
| `note: <spec> expects guards, but no decision log was given for <s>: no guard was seen` | no `--decisions` for that session | pass its decision log |
| `note: <spec> expects stages, but no step feed was given for <s>` | no `--steps` for that session | pass its step feed |
| `error: --judge takes claude:<model>, such as claude:haiku, not "<x>"` (exit 2) | a malformed judge | `--judge claude:haiku` |
| a judged spec never passes | no `--judge`, so its judged criteria are inconclusive | pass `--judge claude:<model>` with `--judge-budget` (a paid call), or accept it as undecided |
