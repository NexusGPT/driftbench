---
title: judge ground
summary: "Check that a quote is in the data a judge saw, with no model call: the transcript, the artifact, the Given, the inputs or the reference; it applies the same grounding rule as the council."
commands:
  - judge ground
see_also:
  - judging-evidence
  - judging-judge-prompt
  - judging-judge-check
  - judging-criteria
next:
  - judging-judge-prompt
---

## What it is

`driftbench judge ground` takes a quote and a judge request and says whether the quote is grounded. A quote is grounded when its text is in the data the judge received. The command uses the rule the council uses for the evidence of a verdict, so a quote that fails here fails there. It calls no model and writes nothing.

The data of a request has these places: `transcript.<n>` (the entry with that index), `artifact`, `given`, `input.<path>` (one per input file) and `reference`. A grounded quote prints the place that holds it. With `--source`, the command looks in that one place only.

## When to use it

* A judge returned evidence that looks wrong, and you want to know whether the quote is in the data at all.
* You wrote a rubric and a fixture, and want to see which quote a judge could cite from it.
* You read a verdict from `judge run` or `judge calibrate` and want to check one span by hand.
* To read the rule itself, see `judging-evidence`. To see the text the judge gets, use `judge prompt`.

## Commands and every option

```
driftbench judge ground --quote <text> (--request <file> | --criteria <dir> --criterion <name> [--fixture pass|fail]) [--source <place>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `--quote <text>` | Required. The quote, as the judge wrote it. | none |
| `--request <file>` | The judge request, as a JSON file (see Inputs). Give this or `--criteria`, never both. | none |
| `--criteria <dir>` | A criteria folder. The request is the fixture of one criterion of it. Needs `--criterion`. | none |
| `--criterion <name>` | The criterion whose fixture is the request. Used with `--criteria`. | none |
| `--fixture <which>` | `pass` or `fail`: the fixture used with `--criteria`. | `pass` |
| `--source <place>` | Look only in this place, such as `transcript.3`, `artifact`, `given` or `reference`. | every place |
| `--json` | Print one JSON document instead of text. | off |

Exit codes:

| Code | When |
|---|---|
| 0 | The quote is grounded. |
| 1 | The quote is not grounded. |
| 2 | Bad input: no request or both, an unreadable or invalid request file, an unknown criterion, or `--fixture` other than `pass` or `fail`. |

## Inputs

A request file is a JSON object:

| Key | Required | Meaning |
|---|---|---|
| `criterion` | yes | `name` and `rubric`, and optionally `pass`, `fail` and `scope`. |
| `transcript` | yes | A list of entries. Each has `role` (`user`, `agent`, `tool_call`, `tool_result`, `card` or `context`) and `text`, and `tool` on tool lines. |
| `artifact` | no | The text of a produced file. |
| `given` | no | The Given of the block, as the judge reads it. |
| `inputs` | no | Input files, each with a `path` and its text. |
| `reference` | no | A reference text. |

With `--criteria`, the request is built from the fixture of the criterion, as `judge calibrate` builds it. The folder must pass `judge check`.

## Outputs and how to read them

Text output:

* A grounded quote: `grounded in <place>`, on stdout.
* A quote that is not grounded: `NOT grounded: no data place holds the quote.` With `--source`: `NOT grounded in <place>.` Then `The places of <request>: <list>.` The list names every place the quote could have come from.

With `--json`, one object: `request` (the file, or `<criterion>, <fixture> fixture`), `quote`, `source` (only when given), `grounded`, `where` (only when grounded) and `places`.

The check proves presence only. A grounded quote can still be read wrongly by the judge.

## Worked example

A request with a transcript and a reference. The quote is checked in every place, then in one place, then with a wrong quote and a wrong place:

```json file=request.json
{
  "criterion": {
    "name": "price_stated",
    "rubric": "The reply states the monthly price of the plan it offers.",
    "pass": "The reply gives a price in dollars per month.",
    "fail": "The reply names a plan and gives no price."
  },
  "transcript": [
    { "role": "user", "text": "How much is Acme Fiber 300?" },
    { "role": "tool_call", "tool": "catalog.search", "text": "{\"name\":\"Acme Fiber 300\"}" },
    { "role": "tool_result", "tool": "catalog.search", "text": "{\"monthly_usd\":40}" },
    { "role": "agent", "text": "Acme Fiber 300 costs 40 dollars per month." }
  ],
  "reference": "Acme Fiber 300 is 40 dollars per month."
}
```

```sh
driftbench judge ground --request request.json --quote "costs 40 dollars per month"
driftbench judge ground --request request.json --quote "40 dollars per month" --source reference
driftbench judge ground --request request.json --quote "50 dollars per month"  # exit 1
driftbench judge ground --request request.json --quote "40 dollars per month" --source transcript.1  # exit 1
driftbench judge ground --criteria examples/acme/criteria --criterion one_question_per_turn --fixture fail --quote "Which address should I check?" --json
```

```text
$ driftbench judge ground --request request.json --quote "costs 40 dollars per month"
grounded in transcript.3
(exit 0)
$ driftbench judge ground --request request.json --quote "40 dollars per month" --source reference
grounded in reference
(exit 0)
$ driftbench judge ground --request request.json --quote "50 dollars per month"
NOT grounded: no data place holds the quote.
The places of request.json: transcript.0, transcript.1, transcript.2, transcript.3, reference.
(exit 1)
$ driftbench judge ground --request request.json --quote "40 dollars per month" --source transcript.1
NOT grounded in transcript.1.
The places of request.json: transcript.0, transcript.1, transcript.2, transcript.3, reference.
(exit 1)
$ driftbench judge ground --criteria examples/acme/criteria --criterion one_question_per_turn --fixture fail --quote "Which address should I check?" --json
{
  "request": "one_question_per_turn, fail fixture",
  "quote": "Which address should I check?",
  "grounded": true,
  "where": "transcript.3",
  "places": [
    "transcript.0",
    "transcript.1",
    "transcript.2",
    "transcript.3"
  ]
}
(exit 0)
```

## Common errors

* `judge ground needs --request <file>, or --criteria <dir> with --criterion <name>.` (exit 2). Give exactly one source for the request.
* `judge ground --criteria needs --criterion <name>.` (exit 2). Name the criterion whose fixture is the request.
* `--fixture takes pass or fail, not "<value>".` (exit 2). Use `pass` or `fail`.
* `<file>: ENOENT: no such file or directory, open '<path>'` (exit 2). The request path is wrong; it is resolved from the current folder.
* `<file>: a judge request is a JSON object`, `<file>: criterion: ...` or `<file>: transcript: a list of entries is required` (exit 2). The request file breaks the shape in Inputs.
* `the criteria folder <dir> has no valid criterion <name> (it has <list>).` (exit 2). The name is wrong, or the criterion file has an issue; run `driftbench judge check <dir>`.
