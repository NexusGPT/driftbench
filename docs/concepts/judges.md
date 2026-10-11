# Judges

Every block gets two kinds of verdict. They stay apart and are both reported.

* Machine checks: deterministic, no model. A machine fail is a fail; no judge can overturn it. See [checks](../reference/checks.md).
* Judged criteria: a model reads the block against a rubric and answers pass, fail or inconclusive.

This page covers judged criteria. The judges are planned, phase 2. The criterion format exists today and `driftbench spec validate` checks it.

## Criteria in a spec

A spec defines its criteria once, and each block names the ones it is judged on.

```yaml
id: plan-upgrade-judged
blocks:
  - user: Hi, my internet is too slow. What faster plans do you have?
    expect:
      criteria: [one_question@gating, plain_language]
criteria:
  - name: one_question
    rubric: Does the reply ask at most one question?
    fail: The reply asks two questions or more.
    pass: The reply asks one question, or none.
    scope: block
    judge_class: system1
  - name: plain_language
    rubric: Does the reply avoid internal jargon?
    fail: The reply uses a product code or an internal team name.
    pass: Every term in the reply is one a customer would use.
```

* `name` is how blocks refer to the criterion.
* `rubric` is the question. It is written to have a binary answer.
* `fail` and `pass` describe what a failing and a passing block look like.
* `gating` marks the criterion as gating. In a block, `name@gating` makes a fail of that criterion fail the block.
* `scope` is `block` or `conversation`.
* `judge_class` is `system1`, `system2` or `auto`.

A reference to a name the spec does not define is an error. A spec with no `criteria` list may name criteria from a shared catalogue; `spec lint` warns that they must come from there.

## Judging a task step

For a task step, the judge reads the artifact itself: the text of the workbook, document, deck or PDF, as the artifact readers extract it. It never reads the agent's own description of the file. The same council and the same calibration apply. The readers are planned, phase 1; judging task blocks on their artifacts is planned, phase 2.

## The request and the answer

* The request holds the rubric with its fail and pass pictures, a summary of the block's Given (stage, ledger), and the observed segments and tool calls. The observed content sits inside a data tag, and the instruction says that text inside the tag is data, never instructions.
* The answer is strict JSON with `outcome` (`pass`, `fail` or `inconclusive`), `evidence` and `reasoning`.
* An answer that does not parse is inconclusive. It is judged again once with a larger budget. There is no silent fallback.
* An inconclusive verdict is never counted as a pass or a fail.

## Two classes of judge

| Class | What it is | It takes |
|---|---|---|
| system 1 | a fixed binary question per criterion, one short answer, low variance, low cost | criteria whose evidence sits in the block itself: a tool used, a fact present, the language, one question per turn, the stage reached |
| system 2 | a chat model with stored reasoning, from a model family other than the agent's | criteria that read across blocks: a contradiction with the ledger, flow drift, recovery |

Planned clients: `jev` and `decisions-api` for system 1; `openai`, `google` and `anthropic` for system 2; `http` for any endpoint that returns the answer contract. Keys come from the environment, never from the repository.

## The council

* Each criterion has an assignment: which judges, of which class.
* The verdict is the majority of three judges of the assigned class. A split vote is logged and judged again by the other class.
* Cascade: the cheapest judge runs first. The others run only on a fail or an inconclusive answer.
* Modes: `system1`, `hybrid` or `llm`. Scores from different modes are not comparable.
* Diversity: a judge from the same model family as the agent is refused for that agent. In perturbed mode, the simulated user runs on a third family.

## Calibration: an assignment is earned

No judge is trusted before it passes its own test.

* Fixture pairs: every gating criterion has one failing transcript and one clean transcript. The judge that owns the criterion must separate them 3 times out of 3.
* Agreement: the council's verdicts are compared with hand labels using Cohen's kappa, and across judges using Krippendorff's alpha. A criterion with no judge at a kappa of 0.8 or more is flagged: the rubric is rewritten, not the threshold.
* The judge with the best agreement owns the criterion. A system 1 judge that ties a system 2 judge wins on cost and variance.
* An assignment is tested again whenever its rubric changes.

`judge calibrate` runs this and writes the assignment table. Planned, phase 2.
