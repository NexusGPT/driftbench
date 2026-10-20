---
title: judge cassette
summary: "Read a cassette and move its recorded answers to the keys of changed criteria, with no model call: inspect shows the judges, entries and which requests are answered; rekey keeps answers when only a part the judge never reads changed."
commands:
  - judge cassette inspect
  - judge cassette rekey
see_also:
  - judging-cassettes
  - judging-judge-calibrate
  - judging-judge-run
  - judging-judge-check
next:
  - judging-cassettes
---

## What it is

A cassette is a JSON file of recorded judge answers (see `judging-cassettes`). Each answer is stored under a key made from the request the judge received. Two commands read and repair cassettes. Neither calls a model.

* `driftbench judge cassette inspect <file>` prints what a cassette holds: its judges, the entries per judge and per criterion, the answer contracts and decoder versions, and the recorded cost. With `--criteria`, it also counts which requests of a criteria folder the cassette answers, and how many entries no request matches.
* `driftbench judge cassette rekey <file>` moves recorded answers to the keys of a changed criteria folder. It moves an answer only when the judge would read the same prompt. When any prompt changes, it writes nothing and exits 1: record those answers again.

## When to use it

* Before `judge run --cassette` or `judge calibrate --cassette`, to see whether the cassette answers the criteria you have now.
* After editing a criterion, to find which requests lost their recording (`inspect --criteria`).
* After a change the judge does not read, such as a line break in a rubric, to keep the answers (`rekey`).
* After a change the judge reads (a rubric, a picture, a fixture, a criterion name), do not use `rekey`: it refuses. Record again with `judge calibrate --record`.

## Commands and every option

```
driftbench judge cassette inspect <file> [--criteria <dir> [--labels <dir>]] [--json]
driftbench judge cassette rekey <file> --from <dir> --criteria <dir> [--labels <dir>] [--rename <old=new>...] --out <file> [--json]
```

`judge cassette inspect`:

| Option | Meaning | Default |
|---|---|---|
| `<file>` | Required argument. The cassette JSON file, resolved from the current folder. | none |
| `--criteria <dir>` | A criteria folder: count the fixture requests the cassette holds an answer for. The folder must pass `judge check`. | none |
| `--labels <dir>` | A labels folder: count the labelled blocks too. Needs `--criteria`. | none |
| `--json` | Print one JSON document instead of text. | off |

`judge cassette rekey`:

| Option | Meaning | Default |
|---|---|---|
| `<file>` | Required argument. The cassette to re-key. | none |
| `--from <dir>` | Required. The criteria folder the cassette was recorded with. | none |
| `--criteria <dir>` | Required. The changed criteria folder. | none |
| `--labels <dir>` | The labels folder, to re-key the labelled blocks too. | none |
| `--rename <old=new>` | A criterion renamed from `old` (in `--from`) to `new` (in `--criteria`). Repeat for several. | none |
| `--out <file>` | Required. Where to write the re-keyed cassette. It may be the input file. | none |
| `--json` | Print one JSON document instead of text. | off |

Exit codes:

| Command | Code | When |
|---|---|---|
| `inspect` | 0 | The cassette is read. |
| `inspect` | 2 | The cassette cannot be read, `--labels` has no `--criteria`, or a folder has issues. |
| `rekey` | 0 | The cassette is re-keyed and written. Zero moves is also 0. |
| `rekey` | 1 | A change touches what a judge reads. Nothing is written. |
| `rekey` | 2 | Bad input: an unreadable cassette, a bad `--rename`, a folder with issues, or a new key that already holds entries. |

## Inputs

* A cassette file, such as one written by `judge calibrate --record` or by a benchmark recording.
* One or two criteria folders that pass `judge check`, and optionally a labels folder (see `judging-calibration`).
* The requests are rebuilt from the fixtures, and from the labelled blocks with `--labels`, at the normal and at the large budget. A request is answered when some judge of the cassette holds its key. The large budget is asked only after an unparsed answer, so a missing large-budget key is not counted as missing.

## Outputs and how to read them

`inspect`, text output:

* A header: `<file>: <j> judge(s), <n> entries, recorded cost <usd> USD.`
* One line per judge: its id, class, family and model, its entries split into `answer`, `raw` and `error`, its answer contracts and its decoder versions.
* `Entries per criterion:` with the entries of each judge per criterion.
* With `--criteria`: one line per criterion, `<answered> of <requests>`, with `no answer for <items>` when some are missing, and a last line that counts the entries no request of the folder matches. Those are stale entries.

`inspect --json`: `file`, `version`, `entries`, `costUsd`, `judges`, `criteria`, and `coverage` with `--criteria`.

`rekey`, text output:

* Success: one line `rekeyed  <criterion> <item>, judge <id>: <old key> -> <new key>` per move, then `<k> key(s) moved (<e> entries); every prompt is unchanged. Wrote <file>.`
* Refusal (exit 1): one line `refused  <criterion> <item>, judge <id>: the <system and/or user> prompt changes` per request, then `Nothing written: ...`.

`rekey --json`: on success `rekeyed: true`, `keys`, `entries`, `moves` and `out`. On refusal `rekeyed: false`, `refusals`, `conflicts` and `moves`.

## Worked example

Inspect the council cassette of the Acme example against the Acme criteria. Then change one rubric so it ends with a line break, which the judge does not read, and move the recorded answers to the new keys. Then try a rename, which changes the prompt, and see the refusal:

```sh setup
mkdir -p newline
cp examples/acme/criteria/*.yaml newline/
rm newline/one_question_per_turn.yaml
```

```yaml file=newline/one_question_per_turn.yaml
criterion:
  name: one_question_per_turn
  rubric: "The reply asks the customer at most one question.\n"
  pass: One question, or none.
  fail: Two or more questions in the same reply.
  judge_class: system1
fixtures:
  pass:
    note: The reply offers two plans and asks one question.
    transcript:
      - { role: user, text: "Hi, my internet is too slow. What faster plans do you have?" }
      - { role: tool_call, tool: catalog.search, text: '{"category":"home"}' }
      - { role: tool_result, tool: catalog.search, text: '[{"name":"Acme Fiber 300","monthly_usd":40},{"name":"Acme Fiber 1000","monthly_usd":60}]' }
      - { role: agent, text: "We have Acme Fiber 300 at 40 USD a month and Acme Fiber 1000 at 60 USD a month. Which address should I check?" }
  fail:
    note: The same reply asks for the address and the budget.
    transcript:
      - { role: user, text: "Hi, my internet is too slow. What faster plans do you have?" }
      - { role: tool_call, tool: catalog.search, text: '{"category":"home"}' }
      - { role: tool_result, tool: catalog.search, text: '[{"name":"Acme Fiber 300","monthly_usd":40},{"name":"Acme Fiber 1000","monthly_usd":60}]' }
      - { role: agent, text: "We have Acme Fiber 300 and Acme Fiber 1000. Which address should I check? And what is your monthly budget?" }
```

```sh
driftbench judge cassette inspect examples/acme/criteria/council.cassette.json --criteria examples/acme/criteria
driftbench judge cassette inspect examples/acme/criteria/council.cassette.json --criteria newline
driftbench judge cassette rekey examples/acme/criteria/council.cassette.json --from examples/acme/criteria --criteria newline --out rekeyed.json
driftbench judge cassette inspect rekeyed.json --criteria newline
driftbench judge cassette rekey examples/acme/criteria/council.cassette.json --from examples/acme/criteria --criteria examples/acme/criteria --rename one_question_per_turn=plain_language --out renamed.json  # exit 1
driftbench judge cassette inspect missing.json  # exit 2
```

```text
$ driftbench judge cassette inspect examples/acme/criteria/council.cassette.json --criteria examples/acme/criteria
examples/acme/criteria/council.cassette.json: 6 judge(s), 76 entries, recorded cost 0.0000 USD.
  s1p-a              system1  family jev  model jev-latest: 18 entries (18 answer, 0 raw, 0 error); contract unmarked (legacy) 18; decoder 1 18
  s1p-b              system1  family jev  model jev-latest: 18 entries (18 answer, 0 raw, 0 error); contract unmarked (legacy) 18; decoder 1 18
  openai-decisions   system1  family openai  model decisions-example: 18 entries (18 answer, 0 raw, 0 error); contract unmarked (legacy) 18; decoder 1 18
  openai-chat        system2  family openai  model gpt-example: 7 entries (0 answer, 7 raw, 0 error); contract unmarked (legacy) 7; decoder 1 7
  google-chat        system2  family google  model gemini-example: 8 entries (0 answer, 8 raw, 0 error); contract unmarked (legacy) 8; decoder 1 8
  anthropic-chat     system2  family anthropic  model claude-example: 7 entries (0 answer, 7 raw, 0 error); contract unmarked (legacy) 7; decoder 1 7
Entries per criterion:
  care_redirect: s1p-a 2, s1p-b 2, openai-decisions 2
  ...
  sheet_matches_catalog: s1p-a 2, s1p-b 2, openai-decisions 2
Requests of the criteria folder the cassette answers (a judge holds the key):
  care_redirect: 2 of 2
  ...
  sheet_matches_catalog: 2 of 2
0 entries match no request of the folder (labelled blocks are not counted without --labels).
(exit 0)
$ driftbench judge cassette inspect examples/acme/criteria/council.cassette.json --criteria newline
...
  one_question_per_turn: 0 of 2; no answer for pass fixture, fail fixture
...
6 entries match no request of the folder (labelled blocks are not counted without --labels).
(exit 0)
$ driftbench judge cassette rekey examples/acme/criteria/council.cassette.json --from examples/acme/criteria --criteria newline --out rekeyed.json
rekeyed  one_question_per_turn pass fixture, judge s1p-a: 41b79f9cdb3e -> 7be096c76bb3
rekeyed  one_question_per_turn pass fixture, judge s1p-b: 41b79f9cdb3e -> 7be096c76bb3
rekeyed  one_question_per_turn pass fixture, judge openai-decisions: e1ba02482fab -> 8229ff1631ee
rekeyed  one_question_per_turn fail fixture, judge s1p-a: 2549a8508229 -> 89ddceb078ac
rekeyed  one_question_per_turn fail fixture, judge s1p-b: 2549a8508229 -> 89ddceb078ac
rekeyed  one_question_per_turn fail fixture, judge openai-decisions: e21f007d5401 -> 3fa6b7a17d9d

6 key(s) moved (6 entries); every prompt is unchanged. Wrote rekeyed.json.
(exit 0)
$ driftbench judge cassette inspect rekeyed.json --criteria newline
...
  one_question_per_turn: 2 of 2
...
0 entries match no request of the folder (labelled blocks are not counted without --labels).
(exit 0)
$ driftbench judge cassette rekey examples/acme/criteria/council.cassette.json --from examples/acme/criteria --criteria examples/acme/criteria --rename one_question_per_turn=plain_language --out renamed.json
refused  plain_language pass fixture, judge s1p-a: the user prompt changes
refused  plain_language pass fixture, judge s1p-b: the user prompt changes
refused  plain_language pass fixture, judge openai-decisions: the user prompt changes
refused  plain_language fail fixture, judge s1p-a: the user prompt changes
refused  plain_language fail fixture, judge s1p-b: the user prompt changes
refused  plain_language fail fixture, judge openai-decisions: the user prompt changes

Nothing written: the change touches what 3 judge(s) read on 6 request(s). Record those answers again.
(exit 1)
$ driftbench judge cassette inspect missing.json
judge cassette inspect: ENOENT: no such file or directory, open '<scratch folder>/missing.json'
(exit 2)
```

Lines shown as `...` are cut here for length. The rekeyed file is a full cassette: `judge run --criteria newline --cassette rekeyed.json` finds every answer.

## Common errors

* `judge cassette inspect: ENOENT: no such file or directory, open '<path>'` or `judge cassette rekey: <reason>` (exit 2). The cassette path is wrong or the file is not a cassette.
* `judge cassette inspect --labels needs --criteria <dir>.` (exit 2). Add `--criteria`.
* `<file>: <message>` then `judge cassette inspect: the criteria folder has issues; run judge check first.` (exit 2). Fix the folder with `judge check`.
* `judge cassette rekey: a criteria folder has issues; run judge check first.` (exit 2). Same, for `--from` or `--criteria`.
* `--rename takes old=new, not "<value>".` (exit 2). Write the pair as `old=new`.
* `--rename <old>=<new>: <dir> has no criterion <old>.` or `... has no criterion <new>.` (exit 2). The old name must be in `--from`, the new name in `--criteria`.
* `judge cassette rekey: <judge>, <criterion> <item>: the new key <key> already has entries` (exit 2). The target key is taken. Remove the clash or write to a clean cassette.
* `refused  <criterion> <item>, judge <id>: the <system|user|whole> prompt changes` (exit 1). The change reaches what the judge reads. Nothing is written. Record those answers again with `judge calibrate --record`.
