---
title: Personas
summary: 'A persona file describes a fictional person the simulated user plays (who they are, their goal, the facts they give only when asked, the stop token, the spec they play); `simulate` and `campaign run --driver simulated` read it. A spec can also define the person in its blocks, with when.simulated_user.'
commands:
  - simulate
  - campaign run
see_also:
  - authoring-users
  - authoring-spec-format
  - authoring-blocks
next:
  - authoring-users
---

## What it is

A persona is a YAML file for the simulated user. The simulated user replaces the spec's scripted user words: it writes each user turn as this person would, either through a model (`--model`, paid) or by replaying a recording (`--recording`, free).

The persona fixes four things:

- Who the person is and how they write (`name`, `persona`), and what they want (`goal`).
- The facts the person knows (`facts`), such as an email or a phone number, and the patterns of an agent reply that ask for each fact (`reveal_when_asked`). Code enforces reveal-when-asked: a fact reaches the model only after an agent reply matches one of its patterns (case-insensitive regex). The spec's own words for a block are passed as a hint with every fact not yet asked replaced by `[your <fact>, once asked]`. An answer that holds a fact not yet asked fails the run.
- The stop token: when an answer contains it, the run stops.
- The spec the persona plays (`spec`), relative to the persona file. `campaign run --driver simulated` uses it to match a persona to a spec.

The simulated user reads only the agent's visible text, never its tool calls.

## When to use it

- You want a run where the user's wording is not the script, to see whether the agent still passes the spec's expectations.
- You want to check that the agent asks for a fact before it uses it: put the fact in `facts`, not in `persona` or `goal`.
- Use a recording (see authoring-users) to repeat a run with no model call. Use `--model` only when a paid call is acceptable.

## Commands and every option

Only the options that concern personas and recordings are listed. `simulate` and `campaign run` have their own topics for the rest.

### driftbench simulate

```
driftbench simulate <spec> --persona <file> (--model | --recording <file>) [--target <adapter[:agent]>] [--turns <n>] [--agent-family <family>] [--judge-family <family>]... [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<spec>` (argument, required) | One spec file. A folder that holds several specs is refused. | none |
| `--persona <file>` (required) | The persona file the user plays. | none |
| `--model` | Speak through the model port the environment configures (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`). A paid call per turn. | off |
| `--recording <file>` | Replay the answers of a recording, turn n gets answer n. Repeat it for several personas. Give `--model` or `--recording`, not both, and one of them is required. | none |
| `--target <adapter[:agent]>` | The agent. | the spec's own target |
| `--turns <n>` | Stop after this many user turns. A whole number from 1. | no cap |
| `--agent-family <family>` | The model family of the agent under test; `none` for an agent that is not a model. | `none` for `function:acme`, `function:acme-sales` and `process:acme-ops`; required for any other target |
| `--judge-family <family>` | A model family of the judges that will grade the run. Repeat it. | none |
| `--json` | Print one JSON document. | off |

| Exit code | When |
|---|---|
| 0 | The run completes, at least one block ran, and every block that ran passes. |
| 1 | A block fails, or the run fails (for example the simulated user leaks a fact, or a recording has no answer for a turn). |
| 2 | Bad input, nothing ran: no source or both, a bad persona or recording, a bad number, more than one spec, no adapter, no agent family, a port of the agent's or a judge's family. |

### driftbench campaign run (persona options)

```
driftbench campaign run <specs...> --driver simulated --persona <file>... (--model | --recording <file>...) [--agent-family <family>] [--judge-family <family>]...
```

| Option | Meaning | Default |
|---|---|---|
| `--driver <driver>` | Who writes the user turns: `scripted` (the spec's own) or `simulated` (a persona). | `scripted` |
| `--persona <file>` | With `--driver simulated`: a persona; it plays the spec its `spec` field names. Repeat it: every spec of the campaign needs one. | `[]` |
| `--recording <file>` | With `--driver simulated`: replay the answers of a recording. Repeat it. | `[]` |
| `--model` | With `--driver simulated`: speak through the model port (paid). | off |
| `--agent-family <family>` | The model family of the agent under test; `none` for an agent that is not a model. | as for `simulate` |
| `--judge-family <family>` | A model family of the judges. Repeat it. | `[]` |

With `--driver scripted`, any of `--persona`, `--recording` or `--model` is an error. In mode P, the simulated user writes the turns and the perturbing driver injects the deviation at its block. Errors in these options exit 2 before any cell runs.

## Inputs

The persona file is YAML. Duplicate keys and unknown keys are errors.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | string matching `^[a-z0-9][a-z0-9-]*$` | yes | The persona id. A recording names it in its `persona` field. |
| `name` | string, not empty | yes | The name the person goes by. Fictional. |
| `persona` | string, not empty | yes | Who the person is and how they write. The model reads `<name>. <persona>`. |
| `goal` | string, not empty | yes | What the person wants from the conversation. |
| `facts` | map of name to non-empty string | yes | What the person knows and gives only when asked. May be `{}`. |
| `reveal_when_asked` | map of fact name to a list (at least 1) of non-empty regex patterns | yes | For each fact, the patterns of an agent reply that asks for it. May be `{}` when `facts` is empty. |
| `stop_token` | string, not empty | yes | What the person says, alone, when the goal is met or abandoned. |
| `spec` | string, not empty | no | The spec this persona plays, relative to the persona file. It must load as a spec. Needed for `campaign run --driver simulated`. |

Rules checked when the user is created (exit 2):

- Every fact has at least one ask pattern, and every pattern compiles.
- Every key of `reveal_when_asked` is a fact.
- Neither `persona` nor `goal` holds the value of a fact (the check ignores case; a value with 7 digits or more also matches the same digits with spaces, dots, dashes or brackets between them).
- The stop token is not blank.

Minimal valid persona (`examples/acme/personas/sam-upgrader.yaml`):

```
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

The other Acme personas are `alex-newhome.yaml` (plays `new-customer-coverage.yaml`, facts `address` and `phone`) and `dana-porting.yaml` (plays `number-porting.yaml`, facts `phone` and `email`). Only `sam-upgrader` has a recording.

### The persona in the block: `when.simulated_user`

A spec can define the person in its blocks instead of a persona file: `when: { user: ..., simulated_user: {...} }`, a key of the stimulus (a block-level `simulated_user:` is refused). The key enters the spec hash only when present. Every simulated block of a spec names the same person (all keys but `mode`, `trials` and `recorded` equal, a YAML anchor keeps them so); a second person is refused. `driftbench simulate <spec>` without `--persona` runs it (topic running-simulate).

| Key | Type | Required | Meaning |
|---|---|---|---|
| `mode` | `exact`, `simulated` or `replay` | yes | `exact` sends the block's user text as written; `simulated` has the agenda engine plan the message and a model write it; `replay` sends the user text, a message frozen from a simulated run. |
| `persona` | string | no | Who the person is and how they write. |
| `goal` | string | no | What the person wants. Absent: the first simulated block's user text. |
| `hidden_knowledge` | map of name to non-empty string | no | What the person knows. A value reaches the model only once the plan gives it. |
| `reveal` | map of fact name to `on_request` or `volunteer` | no | `on_request` (the default) gives the fact once the agent asks; `volunteer` may give it in the opening message. Each name must be in `hidden_knowledge`. |
| `ask_patterns` | map of fact name to a list of regex patterns | no | The agent replies that ask for a fact, read only with `--labeller patterns`. Each name must be in `hidden_knowledge`. |
| `stop` | string | no | The stop token: a message that holds it ends the run. |
| `trials` | whole number from 1 | no | Runs per simulator family; the largest over the blocks is used. |
| `seed` | string or whole number | no | The engine's seed. Absent: the spec id. Trial t > 0 uses `<seed>#<t>`. |
| `engine` | map | no | The agenda engine's parameters, each optional: `acts_per_turn` (the chances of 1, 2, 3 acts, summing to 1; default 0.7, 0.25, 0.05), `volunteer_share` (0.3), `opening_detail_share` (0.5), `short_turn_share` (0.29), `polite_turn_share` (0.15), `uncertainty_turn_share` (0.07), `question_turn_share` (0.1), `repeat_after_refusal` (1), `turn_budget` (16), `engagement_initial` (0.8), `decay_per_unhelpful_turn` (0.15), `disengage_below` (0.3). |
| `recorded` | `hash` (64 hex) and optional `from` | no | `replay`: the SHA-256 of the frozen text and the run it came from. A text that does not match its hash is refused. |

#### The agenda engine: `when.simulated_user.engine`

Every key is optional. An absent key takes the default shown.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `acts_per_turn` | list of numbers from 0 to 1 | 0.7, 0.25, 0.05 | The chance of 1, 2, 3 and more dialogue acts in one message, in order. The list sums to 1. |
| `volunteer_share` | number from 0 to 1 | 0.3 | The chance that the opening message also gives each fact whose reveal is `volunteer`. |
| `opening_detail_share` | number from 0 to 1 | 0.5 | The chance that the opening message also states the specific problem, not only the request. |
| `short_turn_share` | number from 0 to 1 | 0.29 | The share of messages of at most three words. |
| `polite_turn_share` | number from 0 to 1 | 0.15 | The share of messages planned as polite. |
| `uncertainty_turn_share` | number from 0 to 1 | 0.07 | The share of messages planned as unsure. |
| `question_turn_share` | number from 0 to 1 | 0.1 | The share of messages planned as a question. |
| `repeat_after_refusal` | whole number from 0 | 1 | How many times the person repeats the request after the agent says it cannot. |
| `turn_budget` | whole number from 1 | 16 | The most messages the person writes before giving up. |
| `engagement_initial` | number from 0 to 1 | 0.8 | Engagement at the start. |
| `decay_per_unhelpful_turn` | number from 0 to 1 | 0.15 | Engagement lost on each unhelpful agent turn. |
| `disengage_below` | number from 0 to 1 | 0.3 | Below this engagement the person gives up. |

#### The frozen text: `when.simulated_user.recorded`

Used with `mode: replay`.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `hash` | 64 hex characters | yes | The SHA-256 of the canonical JSON of the frozen text. A text that does not match is refused. |
| `from` | non-empty string | no | The run the text was frozen from. |

A persona file maps onto it key by key: `facts` to `hidden_knowledge`, each fact of `reveal_when_asked` to `reveal: on_request` with the same `ask_patterns`, `stop_token` to `stop`, and `<name>. <persona>` to `persona` (`simulatedUserFromPersona` in `@agent-nexus/driftbench-users`). `examples/acme/simulated/plan-upgrade.yaml` is the plan upgrade with Sam defined this way.

The engine's shares come from published human rates. `opening_detail_share` is 0.5: half of the openings state the specific problem as well as the request, so more of a conversation's words come in its first two messages (an opening with the request alone put that share at 34% against 50% for human customers in the research run). The calibration report measures it on your runs.

## Outputs and how to read them

`simulate` text output:

- `Simulate: <spec id> on <target>, persona <id> (<name>), <source>.` The source is `recording <family>` or `model <family> <model>`.
- Per block: `<i>  user   <what the user said>`, `<i>  agent  <the agent's reply>`, then `<stage reached or ->  ✓|✗`.
- `Facts given, each once asked: <facts or none>.` The facts the agent asked for, so the user could give them.
- `✓|✗ <passed> of <ran> blocks pass. The run ended: <reason>.` Reasons include `the spec has no block N` (all blocks ran), `the simulated user said the stop token at block N`, `--turns N reached`, or the driver error.

`simulate --json` keys: `specId`, `target` (`adapter`, `agent`), `persona`, `source`, `status`, `ended`, `revealed`, `blocks` (each `index`, `user`, `agent`, `stage`, `pass`).

`campaign run --driver simulated` prints first `Driver: simulated, persona <id> on <spec id>, <source>.` for each spec, then the normal campaign lines.

No file is written by `simulate`.

## Worked example

The `sam-upgrader` persona on the plan upgrade spec, against the deterministic `function:acme-sales` agent, with the hand-written recording. No model is called.

```sh
driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
```

```text
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), recording hand-written.
  0  user   Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.
  0  agent  Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?
     identify  ✓
  1  user   Sure, it's sam.rivera@example.com
  1  agent  Thanks, Sam. You are on Acme Mobile S, 10 GB for $15 a month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like: Acme Mobile M or Acme Mobile L?
     offer  ✓
  2  user   I'll take the unlimited one, please.
  2  agent  Here is the change: Acme Mobile S to Acme Mobile L, unlimited data for $35 a month, from your next billing cycle. Reply CONFIRM to place the order.
     recap  ✓
  3  user   Confirm
  3  agent  Done. Your order ORD-7B883C is placed: Acme Mobile L starts on your next billing cycle. Is there anything else I can help with?
     order_placed  ✓
  4  user   No, that's all. Thanks a lot!
  4  agent  You're welcome, Sam. Have a good day.
     closing  ✓
Facts given, each once asked: email.
✓ 5 of 5 blocks pass. The run ended: the spec has no block 5.
(exit 0)
```

The agent asked for the email in block 0 (`e-?mail` matched), so the user could give it in block 1.

## Common errors

The bad persona and recording files below are fictional fixtures in `out/authoring-personas/`.

A required key is missing:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/missing-goal.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
<repo>/out/authoring-personas/missing-goal.yaml: goal Invalid input: expected string, received undefined
(exit 2)
```

A bad id, an unknown key, bad YAML:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/bad-id.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
<repo>/out/authoring-personas/bad-id.yaml: id Invalid string: must match pattern /^[a-z0-9][a-z0-9-]*$/
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/unknown-key.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
<repo>/out/authoring-personas/unknown-key.yaml: (file) Unrecognized key: "mood"
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/bad-yaml.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
<repo>/out/authoring-personas/bad-yaml.yaml: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1:
(exit 2)
```

The `spec` field does not load:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/bad-spec.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
The persona kim-test plays ../no-such-spec.yaml, which does not load as a spec.
(exit 2)
```

Fix: the path is relative to the persona file.

The goal holds a fact value:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/goal-leaks.yaml --recording out/authoring-personas/kim-test.recording.yaml
the goal holds the value of the fact email, so the user would know to give it unasked: keep it in facts alone
(exit 2)
```

A fact with no ask pattern, a pattern for no fact, a pattern that does not compile:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/no-ask.yaml --recording out/authoring-personas/kim-test.recording.yaml
the fact phone has no ask pattern, so it could never be given
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/extra-ask.yaml --recording out/authoring-personas/kim-test.recording.yaml
reveal_when_asked names phone, which is not a fact
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/bad-pattern.yaml --recording out/authoring-personas/kim-test.recording.yaml
the ask pattern e-(mail of email does not compile: Invalid regular expression: /e-(mail/i: Unterminated group
(exit 2)
```

No recording for this persona id (the recording's `persona` must equal the persona `id`):

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/goal-leaks.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
No --recording holds the answers of the persona kim-test.
(exit 2)
```

`--persona` missing:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
error: required option '--persona <file>' not specified
(exit 2)
```

In `campaign run`, no persona plays the spec (`dana-porting` plays `number-porting.yaml`):

```
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/dana-porting.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
No persona plays acme-plan-upgrade: give a --persona whose spec is that file.
(exit 2)
```

Fix: give one `--persona` per spec, each with a `spec` field that names that spec.
