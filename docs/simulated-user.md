# Simulated user

A simulated user plays a person with a persona and a goal, block by block, instead of the spec's scripted words. It runs on the model port, or replays a recording of answers written earlier, so a run can be repeated without a model.

* It reveals a fact (an email, an address, a number) only once the agent has asked for it. This is enforced in code: a fact reaches the model only after an agent reply matches one of the fact's ask patterns, the spec's words for the block are given to the model with every fact not yet asked replaced, and an answer that holds such a fact fails the run.
* It says its stop token, alone, when the goal is met or given up; the run then ends.
* It reads the agent's visible text only, never its tool calls.
* In a spec whose blocks link by `parent`, it reads only the blocks its own block follows: a root starts with no conversation, a child sees its ancestors. A fact asked in one tree is not offered in another, and a message it wrote belongs to its block. A block that a perturbation replaces keeps its place: the user finds the message it wrote for that block, in a flat spec and in a tree.
* Its model must belong to another family than the agent's and the judges'. A port of the agent's family or of a judge's family is refused before anything runs.

## A persona

Every field of a persona and of a user recording is in the [personas and red-team reference](reference/users.md).

A persona file names the person, the goal, the facts and how the agent asks for each, the stop token, and the spec it plays (relative to the file). The Acme personas are in [`examples/acme/personas`](../examples/acme/personas/README.md), with one recording written by hand in `recordings/`.

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

A recording holds the family it stands for, the persona id, and one answer per turn: turn n gets answer n.

## `driftbench simulate`

```
driftbench simulate <spec> --persona <file> (--model | --recording <file>) [--target <adapter[:agent]>] [--turns <n>] [--agent-family <family>] [--judge-family <family>]... [--json]
```

Runs the spec once in mode F with the simulated user, and prints each turn: what the user said, what the agent answered, the stage it reached and whether the block passed. Then the facts the user gave and why the run ended.

| Option | Effect |
|---|---|
| `--persona <file>` | the persona the user plays; required |
| `--model` | speak through the model port the environment configures (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`); a paid call per turn |
| `--recording <file>` | replay the answers of a recording, by turn; repeat it for several personas |
| `--target <adapter[:agent]>` | the agent; without it, the spec's own target |
| `--turns <n>` | stop after this many user turns |
| `--agent-family <family>` | the model family of the agent; `none` for an agent that is not a model. The Acme agents are `none` by default; any other target needs it |
| `--judge-family <family>` | a model family of the judges that will grade the run; repeat it |
| `--json` | print one JSON document |

On the plan upgrade, with the hand-written recording:

```
$ pnpm -s driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
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
```

| Exit code | When |
|---|---|
| 0 | the run completed and every block passes |
| 1 | a block fails, or the run failed |
| 2 | bad input, nothing ran: no source or both, a bad persona, a bad number, no adapter, a model of the agent's or a judge's family |

## `campaign run --driver simulated`

`campaign run` takes the same user on every cell of a spec a persona plays: `--driver simulated`, one `--persona` per spec (each persona plays the spec its file names), and `--model` or `--recording`. In mode P the simulated user is the base of the perturbing driver: it writes the turns, and the deviation goes in at its block. A spec no persona plays is refused, exit 2.

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --mode F,P --repeats 1
Driver: simulated, persona sam-upgrader on acme-plan-upgrade, recording hand-written.
Campaign c-ee7ffda5c41f: 3 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · loose-ok  pass  6 blocks
3 cells: 3 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

## From code

`createSimulatedUser` of `@agent-nexus/driftbench-users` gives the driver; `loadPersona`, `personaOptions`, `loadUserRecording` and `userRecordingPort` read the files. Any object with a `family`, a `model` and `complete({ system, user })` is a port; `FakeModelPort` of `@agent-nexus/driftbench-generate` replays answers in tests.
