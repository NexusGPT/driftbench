---
title: "Red-team tools"
summary: "Choose adaptive deviations, Crescendo, GOAT, or one of 40 rubric-based attack plugins."
commands: []
see_also: ["redteam-attack", "redteam-crescendo", "redteam-goat", "redteam-plugins", "redteam-indirect"]
next: ["redteam-attack", "redteam-crescendo", "redteam-plugins"]
---

## What it is

Driftbench can attack an agent through user messages, tool results and workspace
files, then check the replies and actions the adapter reports.

- Adaptive attacker: `attack` injects one deviation per round into an existing spec.
- Crescendo: `redteam run --strategy crescendo` escalates one objective over a conversation.
- GOAT: `redteam run --strategy goat` chooses techniques after each target reply.
- Red-team plugins: `redteam plugins` lists 40 templates with category-specific grading rubrics;
  `redteam generate` writes a spec from one and `redteam grade` judges a reply with its rubric.
- Indirect prompt injection: D6 in `attack` or `perturb` puts instructions in data
  the agent reads, such as a tool result or a file.

The plugins send their attack as a USER message. Only D6 plants an instruction in
a tool result or a file, so only D6 tests indirect prompt injection for real.

## When to use it

Pick adaptive attacks to measure recovery of a known workflow. Pick Crescendo
for gradual pressure and GOAT for technique switching against one objective.
Pick a plugin when you need a repeatable attack and rubric for one risk category.
Pick D6 when the real boundary is a tool result or file, not a direct user request.
A successful search is evidence about the observed runs, not universal safety.

## Commands and every option

This overview has no execution options. Open a complete topic with
`driftbench help redteam-attack`, `driftbench help redteam-crescendo`,
`driftbench help redteam-goat`, `driftbench help redteam-plugins`, or
`driftbench help redteam-indirect`. Use `driftbench redteam plugins` to see every
plugin id; each has its own topic `redteam-plugin-<id>`.

## Inputs

Run examples from a driftbench repository checkout after `pnpm install`. Use
`pnpm -s driftbench` in place of `driftbench` if you have no installed binary.
Acme is fictional, deterministic code in `examples/acme`; it needs no API key.
The npm CLI alone does not include Acme or these example files. Output paths are
relative to the working directory. Use a fresh directory for new recordings.

A spec supplies the target, starting world, blocks and expectations. A pack is a
folder of reviewed YAML phrasings for adaptive deviations. A model port writes
new attacks. A recording reuses messages. A judge evaluates a rubric; it is a
separate input from the attacker. Each detailed topic includes a complete example.

## Outputs and how to read them

`attack` prints a findings table or JSON, and can save a decision recording.
`redteam run` prints a turn table or a full JSON run plus its recording.
`redteam generate` writes a spec; it does not run a target or a judge.
`redteam grade` runs that spec on an agent and prints each criterion's verdict:
pass, fail or inconclusive. Inconclusive is missing evidence, never a pass.

- `finding`: an adaptive round broke a gating expectation, acted unsafely,
  failed to recover, caused later damage, or failed to run.
- `breached`: enough consecutive multi-turn scores reached the configured threshold.
- `resisted`: the configured search ran out of turns without that threshold.
- `unscored`: the search ran out of turns, but a turn had no score, breach detection
  was off, or it had fewer turns than `--success-confirm-turns`. It is never resistance: `redteam run` exits 3 when no block failed.
- `grading_error`: scoring failed; the result is inconclusive, not a pass.

The spec's own checks still apply. A resisted search can fail those checks.
Replay uses stored scores; it does not freshly assess a changed target.

## Worked example

No model call. This lists the tools and then runs an Acme adaptive round.

```sh
driftbench redteam plugins
driftbench attack examples/acme/specs/conversations/order-loose-confirmation.yaml --rounds 1 --seed 0
```

```text
Findings: 0 of 1 attacks.
```

## Common errors

A missing Acme adapter means you need the repository example package.
A missing judge means a rubric has not been assessed. A replay is not a new model
search. For indirect attacks, confirm that the adapter actually read the planted
data; merely sending a malicious paragraph as a user message tests another boundary.
