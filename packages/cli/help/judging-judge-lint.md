---
title: judge lint
summary: "List the wording defects of each rubric and its pictures with no model call: two questions, taste words, a hedge, a missing FAIL picture and more; run it on criterion files, spec files or folders."
commands:
  - judge lint
see_also:
  - judging-judge-check
  - judging-criteria
  - judging-judge-prompt
  - authoring-spec-check
next:
  - judging-judge-check
---

## What it is

`driftbench judge lint <paths...>` reads criteria and lists the defects in how each rubric and its pictures are written. A defect is a wording that makes two judges read one criterion two ways, such as two questions in one rubric. It calls no model and writes nothing.

`judge check` asks whether a criteria folder is valid. `judge lint` asks whether each rubric is well written. A valid criterion can still have a defect.

## When to use it

* After writing a rubric, before `judge calibrate` or a recording.
* On a whole criteria folder or on the `criteria` of a spec file.
* In CI, to stop a new rubric with a defect.
* To check a folder is valid, use `judge check`. To see the prompt a rubric becomes, use `judge prompt`.

## Commands and every option

```
driftbench judge lint <paths...> [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` | Required. One or more criterion files, spec files, or folders of them. A folder is read for `.yaml`, `.yml` and `.json` files, in name order, and a file that is neither a criterion file nor a spec is skipped. A path named directly that is neither is an error. | none |
| `--json` | Print one JSON document instead of text. | off |

Exit codes:

| Code | When |
|---|---|
| 0 | No criterion has a defect. |
| 1 | At least one criterion has a defect. |
| 2 | A path cannot be read, a named file is neither a criterion file nor a valid spec, or the paths hold no criterion. |

## Inputs

* A criterion file: a YAML file with `criterion` and `fixtures`, as `judge check` reads (see `judging-judge-check`).
* A spec file: its `criteria` list is linted. A criterion of a spec may leave out its pictures, which is then a defect.

The lint codes:

| Code | Meaning |
|---|---|
| `two-questions` | More than one question mark: one verdict cannot answer two questions. |
| `subjective` | A taste word, such as good or appropriate: two judges read it two ways. |
| `vague-quantity` | A quantity word, such as some or often, that hides the count. |
| `double-negative` | Two negations in one sentence. |
| `no-observable` | Names nothing a judge can read: no reply, agent, message, tool, call or user. |
| `too-long` | Over 400 characters. |
| `no-fail-picture` | No FAIL picture. |
| `no-pass-picture` | No PASS picture. |
| `same-pictures` | The PASS and FAIL pictures are one text. |
| `picture-contradicts-rubric` | One picture is the other with "not" added. |
| `scope-mismatch` | The rubric points at one reply in a conversation criterion, or at the whole conversation in a block one. |
| `placeholder` | An unfilled slot, such as `{plan}` or `<customer name>`. |
| `unbalanced-quotes` | A quote opened and not closed. |
| `empty-rubric` | Nothing to answer. |
| `compound` | Two checks in one rubric (and also, as well as). |
| `hedged` | A hedge (might, may, could) in the rubric or the PASS picture. |
| `instruction-to-judge` | The rubric tells the judge the verdict. |
| `pictures-swapped` | The PASS picture describes a failure, or the FAIL picture a pass. |

## Outputs and how to read them

Text output:

* A criterion with no defect: `ok  <name> (<file>)`, on stdout.
* A criterion with defects: `<name> (<file>): <code>, <code>`, then one indented line per code with its meaning.
* `Skipped, neither a criterion file nor a spec: <files>.` for files of a folder that were skipped.
* A last line: `<n> criteria linted, <k> with a defect.`
* Errors go to stderr as `judge lint: <path>: <reason>`.

With `--json`, one object: `criteria` (each `criterion`, `file`, `issues` as a list of codes), `flagged`, `skipped` and `errors`.

## Worked example

Lint the Acme criteria, then a criterion that asks two questions, uses a taste word, packs two checks into one rubric and hedges:

```yaml file=bad/vague_reply.yaml
criterion:
  name: vague_reply
  rubric: Is the reply good? Does it answer the question as well as it might?
  pass: A good reply.
  fail: A bad reply.
fixtures:
  pass:
    transcript:
      - { role: user, text: "What plans do you have?" }
      - { role: agent, text: "We have Acme Fiber 300 and Acme Fiber 1000." }
  fail:
    transcript:
      - { role: user, text: "What plans do you have?" }
      - { role: agent, text: "Please hold." }
```

```sh
driftbench judge lint examples/acme/criteria  # exit 1
driftbench judge lint bad  # exit 1
driftbench judge lint bad --json  # exit 1
driftbench judge lint missing-folder  # exit 2
```

```text
$ driftbench judge lint examples/acme/criteria
ok  care_redirect (examples/acme/criteria/care_redirect.yaml)
ok  checks_before_promising (examples/acme/criteria/checks_before_promising.yaml)
ok  coverage_before_offer (examples/acme/criteria/coverage_before_offer.yaml)
explicit_confirmation (examples/acme/criteria/explicit_confirmation.yaml): double-negative, too-long
    double-negative: two negations in one sentence
    too-long: over 400 characters
ok  holds_instructions (examples/acme/criteria/holds_instructions.yaml)
honest_failure (examples/acme/criteria/honest_failure.yaml): hedged
    hedged: a hedge (might, may, could) in the rubric or the PASS picture
ledger_intact (examples/acme/criteria/ledger_intact.yaml): double-negative
    double-negative: two negations in one sentence
no_invented_data (examples/acme/criteria/no_invented_data.yaml): double-negative
    double-negative: two negations in one sentence
ok  one_question_per_turn (examples/acme/criteria/one_question_per_turn.yaml)
ok  plain_language (examples/acme/criteria/plain_language.yaml)
ok  resumes_pending_step (examples/acme/criteria/resumes_pending_step.yaml)
ok  sheet_matches_catalog (examples/acme/criteria/sheet_matches_catalog.yaml)
Skipped, neither a criterion file nor a spec: examples/acme/criteria/council.cassette.json.

12 criteria linted, 4 with a defect.
(exit 1)
$ driftbench judge lint bad
vague_reply (bad/vague_reply.yaml): two-questions, subjective, compound, hedged
    two-questions: more than one question mark: one verdict cannot answer two questions
    subjective: a taste word, such as good or appropriate: two judges read it two ways
    compound: two checks in one rubric (and also, as well as)
    hedged: a hedge (might, may, could) in the rubric or the PASS picture

1 criteria linted, 1 with a defect.
(exit 1)
$ driftbench judge lint bad --json
{
  "criteria": [
    {
      "criterion": "vague_reply",
      "file": "bad/vague_reply.yaml",
      "issues": [
        "two-questions",
        "subjective",
        "compound",
        "hedged"
      ]
    }
  ],
  "flagged": 1,
  "skipped": [],
  "errors": []
}
(exit 1)
$ driftbench judge lint missing-folder
judge lint: missing-folder: ENOENT: no such file or directory, stat '<scratch folder>/missing-folder'

0 criteria linted, 0 with a defect.
(exit 2)
```

## Common errors

* `<name> (<file>): <codes>` (exit 1). Rewrite the rubric or the pictures for each code in the table above.
* `judge lint: <path>: ENOENT: no such file or directory, stat '<path>'` (exit 2). The path is wrong; it is resolved from the current folder.
* `judge lint: <file>: neither a criterion file nor a valid spec` (exit 2). A file named directly is not a criterion file and not a valid spec. Run `judge check` or `spec validate` on it.
* `judge lint: <file>: not YAML or JSON: <parser message>` (exit 2). The file does not parse.
* `judge lint: no criterion in <paths>: give criterion files, spec files, or folders of them` (exit 2). The paths hold no criterion.
