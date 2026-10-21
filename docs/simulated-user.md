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

## The simulated user in the block

A spec can define the simulated user in its blocks, as a key of the stimulus: `when: { user, simulated_user }`. Every key is in the [spec reference](reference/spec.md#simulateduserspec). Each block has a mode:

* `exact` sends the block's user text as written.
* `simulated` has the agenda engine plan the message and a model, the realiser, write it.
* `replay` sends the block's user text, a message frozen from a simulated run, after checking its recorded hash.

The key enters the spec hash only when present: no existing spec changes its hash or its block cache keys (`packages/users/test/simulated-block-compat.test.ts` checks every example spec). The scripted driver sends an `exact` or `replay` block's text without the key, and refuses a `simulated` block rather than send its authored text.

```text
blocks:
  - when:
      user: Hi, I'm already an Acme customer and I keep running out of data on my phone.
      simulated_user: &sam
        mode: simulated
        persona: Sam Rivera. A busy Acme mobile customer. Writes short, friendly messages.
        goal: Move the current Acme phone plan to one with more data, and place the change.
        hidden_knowledge: { email: sam.rivera@example.com }
        reveal: { email: on_request }
        stop: '###STOP###'
        trials: 4
  - when: { user: "It's sam.rivera@example.com", simulated_user: *sam }
```

The whole spec is `examples/acme/simulated/plan-upgrade.yaml`.

### The agenda engine

The engine decides what the person says, outside the model. It holds the goal, the facts, an agenda of dialogue acts (state the request, explain the problem, give a fact, say a fact is not known, confirm, report a try, push back once after a refusal, acknowledge, ask what happens next, say goodbye, give up), the engagement and the stop rules. It reads each agent reply as labels (the facts asked for, a question to confirm, a request to try something, a refusal, a sign that the request is done), written by a labelling call on the same model, or read from the blocks' `ask_patterns` with `--labeller patterns`. It plans each message as a few acts and a style drawn from published human rates: short, polite, unsure, a question. The realiser writes exactly the planned acts. A fact reaches it only when the plan gives it.

* Same seed and same agent replies, same plans: the engine draws from a stream seeded by SHA-256, the same on every machine.
* No goodbye before the agent signals that the request is done.
* No invented value: a fact the person does not hold is planned as "do not know", never as an answer.
* A message that holds a fact the plan did not give fails the run. A value inside a value already given is no leak: a postcode inside an address, a user name inside an email.

The engine is the agenda-based user simulator of Schatzmann et al. (2007). In the H10 experiment (block-sim research branch) it was closer to real customers than a prompted simulator on 5 of 6 metrics. One default changed since: `opening_detail_share` is 0.5, so half of the openings state the problem as well as the request; the research engine opened with the request alone, and put 34% of a conversation's words in its first two messages against 50% for the customers.

### The disclosure ledger, trials and the flip flag

Every turn of a run is a ledger entry: the agent labels the engine read, the planned acts and style, the text sent, the facts given in that turn and in total, the engagement, and the stop. A run pins the seed, the model family, the model, the hash of the prompt templates and the engine version in the driver's seeds, so a run with another prompt or engine is another run.

`trials: k` runs the spec k times per simulator family; trial t > 0 uses the seed `<seed>#<t>`. Per block, `simulate` reports pass^k and the rerun flip rate: the chance that two trials of the same family disagree. A plain rerun flips simulated verdicts as often as a change of simulator family (H11: cross-family 0.15, within-family 0.20). So with two families or more a block is flagged only when a pair's cross-family flip rate is above the mean of the two rerun rates and Fisher's exact test on the two pass counts gives p below 0.05. On the H11 data this raises block 1539 (7 of 8 against 2 of 8) and no stable block (`packages/users/test/agenda.test.ts`).

### Cassettes, freezing and the calibration report

A cassette holds the realiser's and the labeller's responses, each keyed by its request, the run's seed and the request's order in that run. A run that replays one makes no model call and gives the same messages; a request the cassette lacks fails the run. `--freeze <file>` writes the first failing run as `replay` blocks with their hashes: the found failure is then fixed turns, played by the scripted driver.

The calibration report compares the simulated messages with human customer rates (derived numbers from ABCD; no dialogue text is kept), metric by metric, with a Dice score (100 = the same rate). Short messages, questions and front-loading are read from the text by its form. Politeness and doubt are read from the plan: a reading of them from the words would need a list of words. A self-check forces a polite message on every turn and requires the Polite% score to fall.

## Personas and scenarios on a block

Status: the objects exist, the fields are not final. `persona`, `scenario`, `persona-defaults` and `run-profile` are object kinds ([objects reference](reference/objects.md)), and `driftbench object migrate persona` splits an old persona file into `driftbench/persona/<id>.yaml`, `driftbench/scenario/<id>.yaml` and `situational/<id>.yaml`. `simulate --persona` and `campaign run --driver simulated --persona` play the situational block composed back into the old persona, request for request. The persona and scenario values sit in `params` until the persona model gives those kinds fields of their own. The persona file above, `simulate`, `--driver simulated` and the simulated user in the block work as described and stay as they are. This section is the contract of the model that will replace the one file, so a block can be played by several personas on one scenario.

A person is split in three kinds of object and a block:

* a persona says who the person is, in every conversation: `language`, `lines` (at most 5 lines of at most 15 words, never a restated rate), `behaviour` (measured rates: verbosity, initiative, tone, cooperativeness, commitment, engagement, patience), `stable_knowledge`, `expertise` (a `level`, and the concepts it `always_known`), `misconceptions`;
* a scenario says what the person wants this time: `intent`, `goal` and `start_state`;
* a block owns the facts of this case, in `situational`: what the user `holds` (with a `reveal` rule), does not know (`unknown`), believes about the case (`case_beliefs`), the `concepts` the case needs and the `pin`s;
* the run profile owns the run settings (`model`, `seed`, `temperature`, `trials`, `mode`, `simulators`, `calibration_ref`). They never appear in a persona or a scenario.

```text
# personas/terse-regular.yaml
kind: persona
id: terse-regular
language: en
lines: ["I order from you most months."]
behaviour:
  verbosity: { short_turn_share: 0.55, words_per_turn: 5 }
  commitment: { strategy: single_minded, repeat_after_refusal: 1 }
  engagement: { initial: 0.8, decay_per_unhelpful_turn: 0.2, disengage_below: 0.3 }
stable_knowledge: { account_id: ACC-4471, email: sam.ortel@example.com, has_account: true }
expertise: { level: advanced, always_known: [where_order_id_is] }
misconceptions: [{ fact: "refunds are instant", true: false }]
---
# scenarios/refund-late-order.yaml
kind: scenario
id: refund-late-order
intent: get_refund_for_late_order
goal:
  constraints: [{ slot: refund_method, value: original_payment }]
  requests: [{ slot: refund_amount }]
  success_when: { must_be_told: [refund_amount] }
start_state: { prior_failed_contacts: 1 }
---
# a block of a spec
- id: b1
  simulated_user:
    scenario: refund-late-order
    personas: [terse-regular, chatty-newcomer]
    requires: { language: en, has_account: true }
    situational:
      holds:
        - { slot: order_id, value: W2378156, reveal: on_request }
        - { slot: email, ref: persona.email, reveal: on_request }
      unknown: [{ slot: tracking_number }]
      case_beliefs: [{ fact: "the order was delivered", true: false }]
      concepts: [{ id: where_order_id_is }]
```

### Who owns what

A field has one owner. The owner's value is never overridden by another kind, and a value is never averaged: both values were written on purpose, so a conflict is refused.

| Field | Owner | May be overridden by |
|---|---|---|
| `behaviour` rates, commitment strategy, `language`, `stable_knowledge`, `expertise` | persona | nobody (defaults fill gaps only) |
| `misconceptions` | persona | a `case_beliefs` entry of the block on the same fact, marked `override: true` |
| disclosure default | persona | the `reveal` rule of a fact in the block |
| `intent`, `goal`, `start_state` | scenario | nobody |
| `situational` facts, `reveal` rules, `concepts` | block | nobody |
| `model`, `seed`, `trials`, `mode` | run profile | nobody |

A block that needs a fact of the person names it with `ref: persona.<slot>`; it never defines it again.

### Refusals

A block with several personas is planned as one cell per persona. Five refusals keep a cell from running. The first four are authoring errors: the suite fails to load, with an error that names the class and both sources. The fifth is a result: the case still loads, and only the cell of the failing persona is refused.

| Class | Refused when |
|---|---|
| `ownership_violation` (load error) | a scenario sets a persona-owned field (`language`, `lines`, `behaviour` or a part of it such as `verbosity`, `stable_knowledge`, `expertise`, `misconceptions`); a persona sets a scenario-owned field (`intent`, `goal`, `start_state`); either sets a run setting; or a block's `situational` sets a persona-owned field such as `situational.behaviour` |
| `slot_collision` (load error) | a slot is in `situational.holds` with a `value` and also in the `stable_knowledge` of one of the block's personas; equal values collide too, the block may only reference the slot |
| `contradictory_belief` (load error) | a block `case_beliefs` entry and a persona `misconceptions` entry state the same fact (same text after lower case and trimmed spaces) with opposite `true`, and the block entry has no `override: true`; the same fact with the same `true`, or with `override: true`, loads |
| `persona_switch_in_chain` (load error) | a block with a `parent` lists a different set of personas than its parent (sets, order does not matter), at any depth of the chain; a child that lists none inherits its parent's set; the scenario may change along the chain |
| `persona_incompatible` (a `not_run` cell) | the persona fails one `requires` key of the block |

The `requires` keys and their tests:

| Key | The persona passes when |
|---|---|
| `language` | its `language` equals the value |
| `has_account` | its `stable_knowledge.has_account` equals the value; absent counts as false |
| `concepts` | every listed concept id is in its `expertise.always_known` |
| `min_expertise` | its `expertise.level` is at least the value, in the order `novice`, `intermediate`, `advanced` |

A persona that lacks the field a key tests fails that key. When it fails several keys, the refusal names the first failing key in the order the block lists them. A refused cell has `status: not_run` and `kind: persona_incompatible`, with the failed key named: never a pass or a fail, and never counted in a rate. The other personas of the block run.

```text
# block b1 requires { language: fr, has_account: true }, played by terse-regular (en, has_account) and
# fr-guest (fr, no account)
- { block: b1, persona: terse-regular, status: not_run, kind: persona_incompatible, requirement: language }
- { block: b1, persona: fr-guest,      status: not_run, kind: persona_incompatible, requirement: has_account }
```

### The grid

Each cell is a block played by a persona, and a persona's run keeps its own verdicts: the same test played by another persona can fail another block, and each run reports the block where it failed. The result is a grid with the blocks as rows and the personas as columns; a refused cell is empty, not a failure. A block chain run on three personas is three separate trees.

## From code

`createSimulatedUser` of `@agent-nexus/driftbench-users` gives the driver of a persona file, and `createBlockUser` the driver of a spec whose blocks define the user (with `ledger()`); `freezeSimulatedRun`, `flipReport`, `calibrationReport`, `cassettePort` and `recordingCassettePort` are the rest of block mode; `loadPersona`, `personaOptions`, `loadUserRecording` and `userRecordingPort` read the files. Any object with a `family`, a `model` and `complete({ system, user })` is a port; `FakeModelPort` of `@agent-nexus/driftbench-generate` replays answers in tests.
