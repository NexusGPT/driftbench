---
title: Simulated users
summary: Let a simulated user play a persona against the agent instead of the spec's scripted turns, with driftbench simulate for one spec or campaign run --driver simulated for a campaign, through the model port (paid) or a recording of answers (free, no model call).
commands:
  - simulate
see_also:
  - running-campaign-run
  - running-recordings
  - running-modes
  - running-budget-and-prices
  - running-campaign-config
  - running-realized-text
next:
  - running-recordings
---

## What it is

A simulated user writes the user turns of a spec from a persona: who the person is, their goal, the facts they know (an email, an address, a number) and how the agent asks for each, a stop token, and the spec they play. Rules enforced in code:

* It reveals a fact only once an agent reply has matched one of that fact's ask patterns. An answer that holds a fact not yet asked for fails the run.
* It says its stop token, alone, when the goal is met or given up; the run then ends.
* It reads the agent's visible text only, never its tool calls.
* Its model must belong to another family than the agent's and the judges'. A source of the agent's family or a judge's family is refused before anything runs.

The user speaks through the model port the environment configures (`--model`, one paid call per turn) or replays a recording (`--recording`): a file holding one answer per turn, which costs nothing and repeats exactly.

## When to use it

* To test how the agent handles a person who words things their own way, rather than the spec's exact turns.
* To check that the agent asks for what it needs: facts come only when asked.
* For repeatable runs in CI, replay a recording instead of calling a model.
* Not for a deliberate deviation at a chosen block: that is mode P (topic running-modes) or `driftbench perturb` (authoring area). Not for an adversarial user: `driftbench attack` (redteam area).

## Commands and every option

```text
driftbench simulate <spec> --persona <file> (--model | --recording <file>) [--target <adapter[:agent]>] [--turns <n>] [--agent-family <family>] [--judge-family <family>]... [--json]
driftbench campaign run [paths...] --driver simulated --persona <file>... (--model | --recording <file>...) [--agent-family <family>] [--judge-family <family>]... [other campaign run options]
```

| Option | Commands | Default | Effect |
|---|---|---|---|
| `<spec>` | `simulate` | required | one spec file. |
| `--persona <file>` | both | required | the persona the user plays. `campaign run` takes one per spec (repeat the flag); each persona plays the spec its `spec:` field names, relative to the persona file. |
| `--model` | both | off | speak through the model port: `ANTHROPIC_API_KEY`, else `OPENAI_API_KEY` with `OPENAI_MODEL`. A paid call per user turn. |
| `--recording <file>` | both | none | replay the answers of a recording, by turn; repeat it for several personas. Give `--model` or `--recording`, never both. |
| `--target <adapter[:agent]>` | `simulate` | the spec's own target | the agent. (`campaign run` uses its own `--target`.) |
| `--turns <n>` | `simulate` | no limit | stop after this many user turns; a whole number from 1. |
| `--agent-family <family>` | both | `none` for `function:acme`, `function:acme-sales` and `process:acme-ops`; required for any other target | the model family of the agent under test; `none` for an agent that is not a model. |
| `--judge-family <family>` | both | none | a model family of the judges that will grade the run; repeat it. |
| `--json` | both | off | print one JSON document. |
| `--driver <driver>` | `campaign run` | `scripted` | `simulated` turns the simulated user on. `--persona`, `--recording` and `--model` are refused with the scripted driver. |

`simulate` runs once, in mode F, repeat 0, with the default checks. In `campaign run`, every cell of a spec a persona plays gets a fresh simulated user; in mode P the simulated user is the base of the perturbing driver, which injects the deviation at its block. The `campaign:` config keys `driver`, `personas`, `recordings`, `model`, `agent_family` and `judge_families` set the same (topic running-campaign-config). A `--budget-usd` counts only what the target adapter reports, never the simulated user's calls, and the CLI says so on stderr.

## Inputs

A persona file (fields `id`, `name`, `persona`, `goal`, `facts`, `reveal_when_asked`, `stop_token`, and optional `spec`), such as `examples/acme/personas/sam-upgrader.yaml`:

```text
id: sam-upgrader
name: Sam Rivera
persona: >
  A busy Acme mobile customer in their thirties. Writes short, friendly messages with full sentences,
  answers what is asked and does not chat about anything else.
goal: >
  Move the current Acme phone plan to one with more data, ideally unlimited, place the change, and end the
  chat once it is done.
facts:
  email: sam.rivera@example.com
reveal_when_asked:
  email: ['e-?mail']
stop_token: '###STOP###'
spec: ../specs/conversations/plan-upgrade.yaml
```

A recording (fields `family`, `model`, `persona`, `answers`), such as `examples/acme/personas/recordings/sam-upgrader.yaml`: turn n gets answer n, and a turn past the last answer fails the run. driftbench has no command that writes a recording: write it by hand, or copy the `user` lines a `--model` run printed.

## Outputs and how to read them

`simulate` prints a header naming the spec, target, persona and source (`recording <family>` or `model <family> <model>`), then per block the user's line, the agent's line, the stage reached and `✓` or `✗`, then `Facts given, each once asked: <names>.` and `<mark> <p> of <n> blocks pass. The run ended: <reason>.` The reason is the stop token, `--turns <n> reached`, `the spec has no block <n>`, or the run's error. `--json` prints `specId`, `target`, `persona`, `source`, `status`, `ended`, `revealed`, and `blocks` with `index`, `user`, `agent`, `stage`, `pass`.

`campaign run --driver simulated` prints `Driver: simulated, persona <id> on <spec>, <source>.` before the usual campaign output.

A stored simulated run records what the persona really said. Each block whose sent text differs from the spec's keeps `realized.hash`, and `realized.text` with `campaign run --record-realized-text`. The report shows the text as written and as sent (topic running-realized-text).

Exit codes of `simulate`: 0 when the run completes and every block passes; 1 when a block fails or the run fails; 2 on bad input, nothing ran. `campaign run` exits as usual.

## Worked example

The plan-upgrade conversation played by Sam from the hand-written recording, stopped after two turns; then a campaign in F and P with the same user. No model is called.

```sh
driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --turns 2
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --mode F,P --campaign sim
```

```text
Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), recording hand-written.
  0  user   Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.
  0  agent  Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?
     identify  ✓
  1  user   Sure, it's sam.rivera@example.com
  1  agent  Thanks, Sam. You are on Acme Mobile S, 10 GB for $15 a month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like: Acme Mobile M or Acme Mobile L?
     offer  ✓
Facts given, each once asked: email.
✓ 2 of 2 blocks pass. The run ended: --turns 2 reached.
```

```text
Driver: simulated, persona sam-upgrader on acme-plan-upgrade, recording hand-written.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · order-service-down  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · loose-ok  pass  6 blocks
4 cells: 4 pass, 0 fail, 0 failed. Spent $0.00.
```

The email was given only after the agent asked for it. Without `--turns`, the run goes on to block 4 and ends with `The run ended: the spec has no block 5.`

## Common errors

Each exits 2 and runs nothing.

* `Name where the user speaks from: --model (the model port) or --recording <file>.`
* `Give --model or --recording, not both.`
* `The model port is not set up: no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL`
* `No --recording holds the answers of the persona dana-porting.` The recording's `persona` must equal the persona's `id`.
* `Name the model family of echo:demo with --agent-family (none for an agent that is not a model): the simulated user must run on another one.` A target other than the Acme ones needs `--agent-family`.
* `the simulated user runs on the hand-written family, the family of the agent under test: refused` (and `..., a family of the judges: refused`). The user's family must differ.
* `--turns takes a whole number from 1, not "0".`
* `--driver simulated needs a --persona for each spec.` and `No persona plays acme-new-customer-coverage: give a --persona whose spec is that file.` In a campaign, every spec needs a persona whose `spec:` names it.
* `--persona, --recording and --model go with --driver simulated.`
* `The persona <id> plays <path>, which does not load as a spec.` The persona's `spec:` path, relative to the persona file, is wrong.
