---
title: judge prompt
summary: "Print the exact system and user text a judge receives for one request, with no model call; use it to read what a rubric, a picture or a transcript becomes before a paid run."
commands:
  - judge prompt
see_also:
  - judging-judge-ground
  - judging-judge-lint
  - judging-default-judge
  - judging-criteria
next:
  - judging-judge-ground
---

## What it is

`driftbench judge prompt` builds the prompt of the shipped default judge for one request and prints it. The output has two parts: the system text, which holds the rules, and the user text, which holds the criterion, the pictures, the scope and the data. It is the text a judge would read. The command calls no model and writes nothing.

## When to use it

* Before a paid `judge calibrate` or a recording, to read what the judge will get.
* A judge answered a criterion wrongly, and you want to see its exact question and data.
* You changed a rubric, a picture or a fixture, and want to see which part of the prompt moved.
* To lint the wording of a rubric, use `judge lint`. To check a quote against the data, use `judge ground`.

## Commands and every option

```
driftbench judge prompt (--request <file> | --criteria <dir> --criterion <name> [--fixture pass|fail]) [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `--request <file>` | The judge request, as a JSON file (keys in `judging-judge-ground`, Inputs). Give this or `--criteria`, never both. | none |
| `--criteria <dir>` | A criteria folder. The request is the fixture of one criterion of it. Needs `--criterion`. | none |
| `--criterion <name>` | The criterion whose fixture is the request. Used with `--criteria`. | none |
| `--fixture <which>` | `pass` or `fail`: the fixture used with `--criteria`. | `pass` |
| `--json` | Print one JSON document instead of text. | off |

Exit codes:

| Code | When |
|---|---|
| 0 | The prompt is printed. |
| 2 | Bad input: no request or both, an unreadable or invalid request file, an unknown criterion, `--fixture` other than `pass` or `fail`, or a request the prompt builder refuses. |

## Inputs

A request: a JSON file, or the fixture of a criterion in a criteria folder. The request keys are in `judging-judge-ground`. The folder must pass `judge check`.

## Outputs and how to read them

Text output, on stdout:

```
=== system (<request>) ===
<system text>

=== user ===
<user text>
```

`<request>` is the request file, or `<criterion>, <fixture> fixture`.

* The system text holds the rules of the judge and the format of its answer. It is the same for every request of one judge setting.
* The user text starts with `CRITERION`, `QUESTION` (the rubric), `FAIL looks like`, `PASS looks like` and `SCOPE`. It then lists the requested requirements, and the data in tagged blocks: `<transcript_data>`, and when the request holds them `<artifact_data>`, `<given_data>`, `<input_data>` and `<reference_data>`.

With `--json`, one object: `request`, `system` and `user`.

## Worked example

The prompt of the fail fixture of one Acme criterion, then the prompt of a request file as JSON:

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
    { "role": "agent", "text": "Acme Fiber 300 costs 40 dollars per month." }
  ],
  "reference": "Acme Fiber 300 is 40 dollars per month."
}
```

```sh
driftbench judge prompt --criteria examples/acme/criteria --criterion one_question_per_turn --fixture fail
driftbench judge prompt --request request.json --json
driftbench judge prompt --criteria examples/acme/criteria --criterion one_question_per_turn --fixture middle  # exit 2
```

The system text is long and is the same for each request; it is cut here. The user text is shown whole:

```text
$ driftbench judge prompt --criteria examples/acme/criteria --criterion one_question_per_turn --fixture fail
=== system (one_question_per_turn, fail fixture) ===
You inspect data against a criterion. Report a separate evidence check for each requirement; code computes the verdict.

Rules:
- Judge only the supplied criterion. Do not add requirements.
...
Check every requested id exactly once. Do not invent or omit ids. A requirement covers its entire supplied definition. Put reasoning and evidence before met. No overall verdict, outcome, score or other key is allowed.

=== user ===
CRITERION: one_question_per_turn
QUESTION: The reply asks the customer at most one question.
FAIL looks like: Two or more questions in the same reply.
PASS looks like: One question, or none.
SCOPE: the last block of the transcript; earlier lines are context

Requested requirements (these ids and definitions are authoritative):
{"id":"one_question_per_turn","requirement":"The reply asks the customer at most one question."}

<transcript_data>
[
  {
    "entry": 0,
    "role": "user",
    "text": "Hi, my internet is too slow. What faster plans do you have?"
  },
  {
    "entry": 1,
    "role": "tool_call",
    "tool": "catalog.search",
    "text": "{\"category\":\"home\"}"
  },
  {
    "entry": 2,
    "role": "tool_result",
    "tool": "catalog.search",
    "text": "[{\"name\":\"Acme Fiber 300\",\"monthly_usd\":40},{\"name\":\"Acme Fiber 1000\",\"monthly_usd\":60}]"
  },
  {
    "entry": 3,
    "role": "agent",
    "text": "We have Acme Fiber 300 and Acme Fiber 1000. Which address should I check? And what is your monthly budget?"
  }
]
</transcript_data>

Report the evidence checks for the QUESTION above as the requested JSON object.
(exit 0)
$ driftbench judge prompt --request request.json --json
{
  "request": "request.json",
  "system": "<the same system text, as one JSON string>",
  "user": "CRITERION: price_stated\nQUESTION: The reply states the monthly price of the plan it offers.\n...\n<reference_data>\nAcme Fiber 300 is 40 dollars per month.\n</reference_data>\n\nReport the evidence checks for the QUESTION above as the requested JSON object."
}
(exit 0)
$ driftbench judge prompt --criteria examples/acme/criteria --criterion one_question_per_turn --fixture middle
--fixture takes pass or fail, not "middle".
(exit 2)
```

## Common errors

* `judge prompt needs --request <file>, or --criteria <dir> with --criterion <name>.` (exit 2). Give exactly one source for the request.
* `judge prompt --criteria needs --criterion <name>.` (exit 2). Name the criterion whose fixture is the request.
* `--fixture takes pass or fail, not "<value>".` (exit 2). Use `pass` or `fail`.
* `<file>: ENOENT: no such file or directory, open '<path>'` (exit 2). The request path is wrong; it is resolved from the current folder.
* `<file>: a judge request is a JSON object`, `<file>: criterion: ...` or `<file>: transcript: a list of entries is required` (exit 2). The request file breaks the shape in `judging-judge-ground`.
* `the criteria folder <dir> has no valid criterion <name> (it has <list>).` (exit 2). The name is wrong, or the criterion file has an issue; run `driftbench judge check <dir>`.
* `judge prompt: <message>` (exit 2). The prompt builder refused the request.
