---
title: Simulated users
summary: Let a simulated user play a persona against the agent instead of the spec's scripted turns, with driftbench simulate for one spec or campaign run --driver simulated for a campaign, through the model port (paid) or a recording of answers (free, no model call); or run a spec whose blocks define the simulated user, with the agenda engine, k trials, the flip flag and a calibration report.
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

### Block mode: the simulated user defined in the blocks

A spec can define the simulated user in its blocks, with `when.simulated_user` (topic authoring-personas has every key). Each block says how its message is made:

* `exact`: the block's user text is sent as written.
* `simulated`: the agenda engine plans the message (which dialogue acts, which facts, and a style: short, polite, unsure, a question), and a model, the realiser, writes exactly those acts. A second call labels each agent reply (which facts it asked for, whether it asked to confirm or said it was done) for the engine. A fact reaches the realiser only once the plan gives it. A message that holds a fact the plan did not give fails the run, except a value inside a value already given (a postcode inside an address).
* `replay`: the block's user text is a message frozen from a simulated run (`--freeze`), sent as written after its recorded hash is checked.

`driftbench simulate <spec>` without `--persona` runs such a spec `trials` times per simulator family. It speaks through the model port (`--model`) or replays cassettes (`--cassette`), one per family: recorded responses keyed by the request, its seed and its order, so the same run replays exactly with no model call. Every turn goes to the disclosure ledger: the agent labels read, the planned acts and style, the text, the facts given in that turn and in total, and the engagement. The scripted driver refuses a `simulated` block: it never sends the authored text in its place.

## When to use it

* To test how the agent handles a person who words things their own way, rather than the spec's exact turns.
* To check that the agent asks for what it needs: facts come only when asked.
* For repeatable runs in CI, replay a recording instead of calling a model.
* Not for a deliberate deviation at a chosen block: that is mode P (topic running-modes) or `driftbench perturb` (authoring area). Not for an adversarial user: `driftbench attack` (redteam area).

## Commands and every option

```text
driftbench simulate <spec> --persona <file> (--model | --recording <file>) [--target <adapter[:agent]>] [--turns <n>] [--agent-family <family>] [--judge-family <family>]... [--json]
driftbench simulate <spec> (--model [--record-cassette <file>] | --cassette <file>...) [--trials <k>] [--seed <seed>] [--labeller model|patterns] [--freeze <file>] [--target <adapter[:agent]>] [--agent-family <family>] [--judge-family <family>]... [--json]
driftbench campaign run [paths...] --driver simulated --persona <file>... (--model | --recording <file>...) [--agent-family <family>] [--judge-family <family>]... [other campaign run options]
```

| Option | Commands | Default | Effect |
|---|---|---|---|
| `<spec>` | `simulate` | required | one spec file. |
| `--persona <file>` | both | required, except in block mode | the persona the user plays. `campaign run` takes one per spec (repeat the flag); each persona plays the spec its `spec:` field names, relative to the persona file. Without it, `simulate` runs the simulated user the spec defines in its blocks. |
| `--model` | both | off | speak through the model port: `ANTHROPIC_API_KEY`, else `OPENAI_API_KEY` with `OPENAI_MODEL`. A paid call per user turn. |
| `--recording <file>` | both | none | replay the answers of a recording, by turn; repeat it for several personas. Give `--model` or `--recording`, never both. |
| `--target <adapter[:agent]>` | `simulate` | the spec's own target | the agent. (`campaign run` uses its own `--target`.) |
| `--turns <n>` | `simulate` | no limit | stop after this many user turns; a whole number from 1. |
| `--agent-family <family>` | both | `none` for `function:acme`, `function:acme-sales` and `process:acme-ops`; required for any other target | the model family of the agent under test; `none` for an agent that is not a model. |
| `--judge-family <family>` | both | none | a model family of the judges that will grade the run; repeat it. |
| `--json` | both | off | print one JSON document. |
| `--cassette <file>` | `simulate`, block mode | none | replay the recorded responses of one simulator family; repeat it, one per family, for the flip flag. Give `--model` or `--cassette`, never both. |
| `--record-cassette <file>` | `simulate`, block mode | none | with `--model`: write every response as a cassette. |
| `--trials <k>` | `simulate`, block mode | the largest `trials` of the spec's blocks, else 1 | runs per family; trial t > 0 uses the seed `<seed>#<t>`. A whole number from 1. |
| `--seed <seed>` | `simulate`, block mode | the blocks' `seed`, else the spec id | the engine's seed. |
| `--labeller <kind>` | `simulate`, block mode | `model` | how the engine reads agent replies: `model` (a labelling call on the same port) or `patterns` (only the `ask_patterns` the blocks declare; no closure is seen, so the spec's blocks bound the run). |
| `--freeze <file>` | `simulate`, block mode | none | write the first run with a failing block as a spec of `replay` blocks. |
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

A cassette (JSON, written by `--record-cassette`): `family`, `model`, and `entries`, each response by the SHA-256 of its request (seed, order, system, user, token cap). `examples/acme/simulated/plan-upgrade.yaml` is a spec whose blocks define Sam; its two cassettes in `examples/acme/simulated/cassettes/` were recorded from `gpt-5.4-nano` and `gemini-3.5-flash-lite`.

## Outputs and how to read them

`simulate` prints a header naming the spec, target, persona and source (`recording <family>` or `model <family> <model>`), then per block the user's line, the agent's line, the stage reached and `✓` or `✗`, then `Facts given, each once asked: <names>.` and `<mark> <p> of <n> blocks pass. The run ended: <reason>.` The reason is the stop token, `--turns <n> reached`, `the spec has no block <n>`, or the run's error. `--json` prints `specId`, `target`, `persona`, `source`, `status`, `ended`, `revealed`, and `blocks` with `index`, `user`, `agent`, `stage`, `pass`.

In block mode, `simulate` prints one line per run (family, trial, blocks passed, status, and why the user ended it), then per block, for each family: passes over trials, pass^k (the chance that k trials drawn from the ones run all pass; `-` when fewer than k ran) and the rerun flip rate (the chance that two trials of the same family disagree). With two families or more it adds the cross-family flip rate, and `FLAG` when a pair's cross-family rate is above the mean of its two rerun rates and Fisher's exact test on their pass counts gives p below 0.05: a flip that a plain rerun explains is never a flag. A block a run did not reach (the user ended first) is no trial of it. Then the calibration report against the human reference `abcd-customers` (derived rates of ABCD customers): per metric the simulated rate, the human rate and the Dice score, 100 for the same rate. `(text)` metrics read the messages by their form only (at most three words, a question mark, the share of words in the first two messages); `(plan)` metrics read the ledger (planned polite, planned unsure, facts given per message), since a reading of politeness from the words would need a list of words. `--json` prints `specId`, `target`, `families`, `trials`, `runs` (each with `family`, `trial`, `seed`, `status`, `blocks`, `ledger`), `flips`, `calibration` and `frozen` or `cassette` when written.

`campaign run --driver simulated` prints `Driver: simulated, persona <id> on <spec>, <source>.` before the usual campaign output.

A stored simulated run records what the persona really said. Each block whose sent text differs from the spec's keeps `realized.hash`, and `realized.text` with `campaign run --record-realized-text`. The report shows the text as written and as sent (topic running-realized-text).

Exit codes of `simulate`: 0 when the run completes and every block passes (in block mode: every run); 1 when a block fails or the run fails; 2 on bad input, nothing ran. `campaign run` exits as usual.

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

Then the spec whose blocks define Sam, replayed from the two recorded cassettes, four trials per family, with the first failing run frozen. No model is called.

```sh
driftbench simulate examples/acme/simulated/plan-upgrade.yaml --cassette examples/acme/simulated/cassettes/openai-gpt-5.4-nano.json --cassette examples/acme/simulated/cassettes/google-gemini-3.5-flash-lite.json --freeze frozen.yaml  # exit 1
driftbench spec lint frozen.yaml
```

```text
Simulate: acme-plan-upgrade-simulated on function:acme-sales, the simulated user of its blocks, 4 trials per family (openai, google).
  openai trial 0: 4 of 5 blocks pass, completed
  openai trial 2: 4 of 4 blocks pass, completed, the user said goodbye at block 4
  google trial 2: 0 of 5 blocks pass, completed
Per block: passes, pass^k and rerun flip rate per family.
  3  google 1/4, pass^4 0, rerun 0.500; openai 2/4, pass^4 0, rerun 0.667  cross-family 0.500
  4  google 0/3, pass^4 -, rerun 0; openai 0/3, pass^4 -, rerun 0  cross-family 0
Calibration against abcd-customers, 38 simulated messages in 8 runs (Dice, 100 = the human rate):
  Short%    63.158 against 38.219  Dice 75.400  (text)
  Polite%   26.316 against 20.685  Dice 88.020  (plan)
✗ a run has a block that does not pass.
```

Block 3 asks the customer to reply CONFIRM. In 5 of the 8 runs the order is not placed there: the user wrote `CONFIRM, thanks.` or put a thanks before the word, or asked to confirm in other words, and the agent places the order only on the bare word. That is a finding about the agent's strict confirmation, seen only once the wording varies. No block is flagged: the two families disagree on block 3 no more than each disagrees with itself. `frozen.yaml` holds the first failing run as replay blocks; it runs with the scripted driver and gives the same conversation every time.

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
* `<spec id> defines no simulated user in its blocks: give --persona <file>, or write when.simulated_user with mode simulated.`
* `Name where the simulated user speaks from: --model (the model port) or --cassette <file>.` and `Give --model or --cassette, not both.`
* `--record-cassette goes with --model: it keeps the responses of the model port.`
* `Two cassettes stand for the same family (openai, openai): give one per family.`
* `--cassette, --freeze go with a spec that defines its simulated user in the blocks, not with --persona.`
* `<spec id>: block <n> defines another simulated user than block <m>: one spec plays one person.`
* In a run (exit 1): `the cassette of <family> <model> holds no response for request <key>: record it again` (the prompt, the seed or the agent's replies changed since the recording); `block <n> replays a text that does not match its recorded hash`; `the simulated user gave <fact> at block <n> before the plan gave it`.
* In `campaign run` with the scripted driver, a `simulated` block fails its cell with `block <n> is simulated: run it with driftbench simulate and a model or a cassette`. `campaign run --driver simulated` plays persona files, not the blocks' simulated user.
* `The persona <id> plays <path>, which does not load as a spec.` The persona's `spec:` path, relative to the persona file, is wrong.
