# Write tests by hand

This part teaches you to write a test yourself, in a file, and to run it. A test is called a **spec**: one file that holds one conversation with your agent and what you expect from it. You write three specs: a refund helper, the same helper with a starting state, and the Acme sales assistant that driftbench ships. Every command below is run by a test on GitHub, and every output is real. Nothing calls a model and nothing is paid for.

## Before you start

**Why you do this.** A spec needs an agent to talk to. This step makes a folder and a tiny stand-in agent, a script that plays a refund helper, so you need no key.

**You need.**

- Node 22 or newer, and driftbench installed, as in the [guide index](index.md#install). In a clone of this repository, write `pnpm driftbench` where this page says `driftbench`.
- A folder for your tests. Nothing else.

**Relevant commands.**

- `mkdir -p evals/specs`: makes the folder `evals` and, inside it, the folder `specs` that will hold your tests · `-p` makes every missing folder on the way · it produces both folders.
- `cd evals`: goes into the folder · no options · every later command runs from there.

```console
$ mkdir -p evals/specs
$ cd evals
```

The stand-in agent is the file `agent.mjs`. It reads the user message, looks the order up in `orders.json` in its working folder, and prints one reply. You replace it with a call to your own agent later. This is the same script as in the [quickstart](quickstart.md).

```js
// file: agent.mjs
// A stand-in for your agent: reads the user message on stdin, prints the reply.
import { existsSync, readFileSync } from 'node:fs';

const message = readFileSync(0, 'utf8').trim();
const history = JSON.parse(readFileSync(process.env.DRIFTBENCH_HISTORY_FILE, 'utf8'));
// The orders the spec seeds in the agent's working folder.
const orders = existsSync('orders.json') ? JSON.parse(readFileSync('orders.json', 'utf8')) : {};
const order = message.match(/\bA-\d+\b/)?.[0];

if (/refund/i.test(message)) {
  console.log('I can help with a refund. What is your order number?');
} else if (order && orders[order]) {
  console.log(`Refund started for order ${order}. You will get an email within 2 days.`);
} else if (order) {
  console.log(`I cannot find order ${order}.`);
} else {
  console.log(`Sorry, I did not get that. (${history.length} messages so far)`);
}
```

## 1. What a spec is

**Why you do this.** Before you type a line, you should know the parts of the file and the words that name them.

**You need.** Nothing yet. Read this table once. The next steps use every row.

| Word | Plain meaning | Example |
|---|---|---|
| Spec | One YAML file: one conversation and what you expect. | `specs/refund-ask.yaml` |
| `id` | A short name for the spec. Letters, digits, dots, underscores and hyphens. | `refund-ask` |
| `title` | One line a person reads. | A customer asks for a refund |
| `target` | Which agent to run, and how to reach it. | `{ adapter: process, agent: my-agent }` |
| Block | One message from the user, and what must be true after the agent answers. A spec holds one or more blocks, in order. | The user says "It is A-1042". |
| `given` | The starting state of a block: earlier messages, files, facts, settings. | The folder holds `orders.json`. |
| `when` | What reaches the agent. You write it as `user: <message>`. | `user: Hi, I would like a refund please.` |
| `expect` | What must be true after the agent answers. Each line of it is one **check**. | The reply must contain "order number". |

The words Given, When and Then name the three parts of a block: the starting state, the message, and what you expect. The full format is in the [spec reference](../reference/spec.md), the [block page](../concepts/block.md) and the [Given, When, Then page](../concepts/given-when-then.md).

A **check** is a rule that code can test on the reply, such as "the reply contains this text". Code gives the same answer every time and costs nothing. This is why this page uses checks only.

**Relevant commands.** None in this step.

**How to read it.** A spec is a list of small tests (the blocks) inside one file. The agent runs once per block. A block passes when every check in its `expect` passes. A spec passes when every block passes.

**If it goes wrong.** Nothing to run yet, so nothing can go wrong. The next step checks your file.

## 2. Write the first test: one block

**Why you do this.** One block is the smallest useful test. It shows the three parts and the two commands you will use all the time: check, then run.

**You need.** The folder `evals/specs` and the stand-in agent from above. This spec has one block. The user asks for a refund. The agent must ask for an order number and must not start a refund yet.

```yaml
# file: specs/refund-ask.yaml
id: refund-ask
title: A customer asks for a refund and the agent asks for the order number
target: { adapter: process, agent: my-agent }

blocks:
  - user: Hi, I would like a refund please.
    expect:
      must: ['order number']
      must_not: ['Refund started']
```

- `id` names the spec in every report.
- `target` says the adapter is `process`, which starts a command, and the agent is called `my-agent`. An **adapter** is the piece that connects driftbench to your agent: `process` starts a command, `function` calls a function, `http` calls a web address. See [adapters](../adapters/index.md).
- `user` is the message the agent receives.
- `must` is a list of patterns that must appear in the reply. Each pattern is a **regular expression**, a short text pattern. A plain word matches itself. Case does not matter.
- `must_not` is a list of patterns that must not appear.

**Relevant commands.**

- `driftbench spec validate`: checks that a spec file is well formed, before anything runs · `specs/refund-ask.yaml` is the file to check; you can also pass a folder · it prints one line per spec, with its `id`, its number of blocks and a hash, then a count, and exits 0 when every spec is valid. The **hash** is a short code of the spec's content: the same content gives the same hash, and any edit changes it.
- `driftbench campaign run`: runs every block of every spec on the agent and checks each reply · `specs/refund-ask.yaml` is the spec to run; `--process-command` is the command that starts your agent, as a list of words in JSON (`node` and the full path of `agent.mjs`, and `$PWD` stands for the current folder) · it prints one line per run and a count, and exits 1 when a run fails. A **campaign** is one such run of a set of specs.

**You type.**

```console
$ driftbench spec validate specs/refund-ask.yaml
✓ specs/refund-ask.yaml  refund-ask · 1 blocks · hash (pending)
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
$ driftbench campaign run specs/refund-ask.yaml --process-command "[\"node\",\"$PWD/agent.mjs\"]"
✓ refund-ask · process:my-agent · F · repeat 0  pass  1 block
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `✓ specs/refund-ask.yaml ...` means the file is valid. The count at the end must say `0 invalid`.
- `✓ refund-ask · process:my-agent · F · repeat 0  pass  1 block` is one **cell**: one spec, run once on one agent. `F` is the run mode, the free-running mode, where the agent answers from its own earlier replies. `pass` is the verdict.
- `Spent $0.00.` is the cost. It is zero because the stand-in agent calls no model.

**If it goes wrong.**

- `No spec files found.` (exit 1): the path holds no `*.yaml` file. Check the path and the file name.
- `(file)  SPEC_PARSE  cannot read the file: ENOENT: no such file or directory` (exit 1): the path does not exist. Relative paths are read from the folder where you type the command.
- `campaign run` cannot start the agent: the path in `--process-command` is wrong. Run `node agent.mjs` by hand with a message on standard input, to see the error.

## 3. Give a block a starting state: given

**Why you do this.** Most agents need facts to answer: an order that exists, a customer, a setting. The `given` part puts those facts in place before the message is sent, so the test does not depend on luck.

**You need.** Three things to set, and the spec below sets all three.

- `world.workspace.files` seeds files in the agent's working folder. Here it writes `orders.json`, which holds order A-1042.
- `vars` sets runtime variables the adapter hands to the agent, such as the channel the conversation runs on.
- `prefix` gives a block the messages that came before it, so it starts from the middle of a conversation without replaying the blocks above it. Each message has a `role` (`user` or `assistant`) and its `content`.

`given` can sit on the spec, where it holds for every block, or on one block. This spec has three blocks. Block 1 asks. Block 2 gives an order that exists. Block 3 gives one that does not.

```yaml
# file: specs/refund-flow.yaml
id: refund-flow
title: A customer asks for a refund, gives an order, then gives a wrong order
target: { adapter: process, agent: my-agent }

given:
  world:
    workspace:
      files: { orders.json: '{"A-1042": {"status": "paid", "total": 49.90}}' }
  vars: { channel: web-chat }

blocks:
  - user: Hi, I would like a refund please.
    expect:
      must: ['order number']
      must_not: ['Refund started']

  - given:
      prefix:
        - { role: user, content: 'Hi, I would like a refund please.' }
        - { role: assistant, content: 'I can help with a refund. What is your order number?' }
    user: It is A-1042.
    expect:
      starts_with: Refund started
      must: ['Refund started', 'A-1042']
      must_not: ['Sorry']
      regex: ['within \d days']
      length: { words: { max: 20 } }

  - given:
      prefix:
        - { role: user, content: 'Hi, I would like a refund please.' }
        - { role: assistant, content: 'I can help with a refund. What is your order number?' }
    user: It is A-9999.
    expect:
      must: ['cannot find order A-9999']
      must_not: ['Refund started']
```

The checks of block 2 are new:

- `starts_with` says the reply begins with this text.
- `regex` is a list of patterns that must match, and here the case must match too. `\d` stands for one digit.
- `length` bounds the reply. Here the reply has at most 20 words. You can also bound `chars`.

**Relevant commands.**

- `driftbench spec lint`: does what `spec validate` does, then adds advice about specs that are valid but weak, such as a block that checks nothing · `specs` is the folder to check; `--strict` (not used here) turns each warning into a failure, which suits a pipeline that guards pull requests · it prints one line per spec and a count, and exits 0 when no spec is invalid.
- `driftbench campaign run`: as in step 2 · this time `specs/refund-flow.yaml` is the spec, and the same `--process-command` starts the agent · it prints one line per run and a count.

**You type.**

```console
$ driftbench spec lint specs
✓ specs/refund-ask.yaml  refund-ask · 1 blocks · hash (pending)
✓ specs/refund-flow.yaml  refund-flow · 3 blocks · hash (pending)
Checked 2 specs: 2 valid, 0 invalid, 0 warnings.
$ driftbench campaign run specs/refund-flow.yaml --process-command "[\"node\",\"$PWD/agent.mjs\"]"
✓ refund-flow · process:my-agent · F · repeat 0  pass  3 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `0 warnings` means the lint found nothing to advise on.
- `pass  3 blocks` means all three blocks passed. Block 2 passed because the file `orders.json` existed in the agent's folder. Without the `world` part, the agent would have answered "I cannot find order A-1042."
- Block 3 proves the opposite case: an order that is not in the file must not start a refund.

**If it goes wrong.**

- A block fails on block 2 with `must.0`: the file `orders.json` is not where the agent reads it. The `files` map writes in the agent's working folder, so read from the current folder in your own agent.
- `GIVEN_UNMET` in the lint output (a warning): the Given of a block is wrong, and that block would not run. The message names the check. See the [Given checks](../concepts/given-when-then.md).
- A YAML error such as `SPEC_PARSE`: quote any value that holds `:` or `{`, and keep the indentation at two spaces.

## 4. Check what the agent calls: tools, stage and rules

**Why you do this.** A good reply is not enough. An agent also acts: it calls tools, such as a lookup or an order. You check that the right tool is called once, with the right input, and that a forbidden tool is never called.

**You need.** An agent that calls tools. Acme Telecom is a made-up phone company. driftbench ships its sales assistant, an agent that runs on your machine with no model, as the target `function:acme-sales`. It has five tools. This step uses two: `coverage.check` looks up an address, and `catalog.search` lists plans.

The spec below follows one customer. In block 1 the customer says hello, and the assistant must ask for an address before any lookup. In block 2 the customer gives an address, and the assistant must check the coverage once and then search the home plans of that address.

```yaml
# file: specs/acme-coverage.yaml
id: acme-coverage
title: A new customer gets a coverage check before any offer
target: { adapter: function, agent: acme-sales }
stages: [address, offer]

blocks:
  - user: Hello, I'm new here and looking for home internet.
    expect:
      stage: address
      tools:
        - { label: coverage.check, count: 0 }
        - { label: catalog.search, count: 0 }
      must: ['Acme Telecom', 'street address']

  - user: 3 Orchard Way, Acmeville
    expect:
      stage: offer
      tool_order: in_order
      tools:
        - label: coverage.check
          count: 1
          input: { address: { regex: '^3 Orchard Way' } }
        - label: catalog.search
          count: 1
          input: { category: home, address_id: addr-102 }
      must: ['Good news', '300 Mbps', 'Acme Fiber 300']
      must_not: ['Fiber is not available', 'Fiber 1000']

rules:
  forbidden_tools: [order.create, notify_sales]
  max_calls: { coverage.check: 1, catalog.search: 1 }
```

The new keys:

- `stages` lists the **stages** of the conversation: the named points the agent moves through. The agent reports the stage it reached, and `stage` in a block checks it. Every stage you check must be in this list.
- `tools` lists the tool calls you expect in the block. `label` is the tool name. `count` is how many times it is called; `0` means it must not be called. `input` says what the call must hold, argument by argument. An argument can be a plain value, or `regex`, `contains`, `one_of`, `nonempty` or `absent`.
- `tool_order: in_order` says the tools are called in the order listed. Other calls may sit between them.
- `rules` holds rules for the whole conversation. `forbidden_tools` names tools that must never be called. `max_calls` caps the calls of a tool.

**Relevant commands.**

- `driftbench campaign run`: as before · `specs/acme-coverage.yaml` is the spec; there is no `--target` and no `--process-command`, because the spec names its own target, which driftbench reaches by name · it prints the run line and the count.

**You type.**

```console
$ driftbench campaign run specs/acme-coverage.yaml
✓ acme-coverage · function:acme-sales · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `function:acme-sales` is the target written as `<adapter>:<agent>`.
- `pass  2 blocks` means the stage, the two tools with their inputs, the text and the rules all held in both blocks.
- The spec checks behaviour, not only words. If the assistant offered a plan before it looked up the address, the `tool_order` and `count` checks would fail.

**If it goes wrong.**

- `No adapter is set up for function:acme-sales. ...` (exit 2): the Acme example is not part of the installed command. It lives in the `examples/acme` folder of the repository. Run this step from a clone of the repository.
- `STAGE_UNKNOWN` from `spec validate`: a `stage` in a block is not in the `stages` list. Add it to the list or fix the spelling.
- `TOOL_COUNT_CONTRADICTION`: you gave `count: 0` and also an `input`. A tool that must not run has no input to check. Remove the `input`.
- `MUST_CONFLICT`: the same pattern is in `must` and in `must_not`. Remove one.

## 5. Read a failure

**Why you do this.** A test that cannot fail proves nothing, and a failure you cannot read costs you time. Here you break a test on purpose and learn to find the cause in three reads.

**You need.** A spec that expects something the agent does not say. This one expects "Refund approved", but the agent says "Refund started". Keep it in its own folder so the folder `specs` stays green.

```yaml
# file: broken/refund-wrong-word.yaml
id: refund-wrong-word
title: This test expects a word the agent never says
target: { adapter: process, agent: my-agent }

given:
  world:
    workspace:
      files: { orders.json: '{"A-1042": {"status": "paid", "total": 49.90}}' }

blocks:
  - user: It is A-1042.
    expect:
      must: ['Refund approved']
```

**Relevant commands.**

- `driftbench campaign run`: as before · `--store runs.db` is the file where the run is kept, so you can read it again · it adds the run to `runs.db`, and exits 1 because a cell fails.
- `driftbench campaign status`: shows a kept run again · `--store runs.db` is the file to read; with no campaign id it reads the latest campaign; `--json` prints every verdict with its evidence, as JSON · it prints one line per cell, or the JSON, and exits 1 while a cell fails.

**You type.**

```console
$ driftbench campaign run broken/refund-wrong-word.yaml --process-command "[\"node\",\"$PWD/agent.mjs\"]" --store runs.db   # exit 1
✗ refund-wrong-word · process:my-agent · F · repeat 0  fail  block 0 must.0
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
$ driftbench campaign status --store runs.db --json   # exit 1
(pending)
```

**How to read it.**

- `✗ ... fail  block 0 must.0` says three things. The cell failed. The failing block is block 0, because blocks count from 0. The failing check is `must.0`, the first pattern of `must`. A check name is the key in `expect`, then a dot, then an index or a name.
- `--json` adds the evidence of each check: what the agent said, and what the pattern needed. Read the evidence first. It names the pattern that is missing and quotes the reply it searched.
- In free-running mode (`F`), a later block starts from the agent's own earlier replies. So read the lowest block number first. A later failure often follows from an earlier one.

A table of the check names you will meet:

| Check name | Comes from | Fails when |
|---|---|---|
| `must.<n>` | `expect.must` | the pattern number n is missing from the reply |
| `must_not.<n>` | `expect.must_not` | the pattern number n is in the reply |
| `tools.<tool>.count` | `expect.tools` | the tool was called a different number of times |
| `tools.<tool>.input.<arg>` | `expect.tools[].input` | an argument of a call differs from what you wrote |
| `forbidden.<tool>` | `rules.forbidden_tools` | a forbidden tool was called |
| `stage.reached` | `expect.stage` | the agent ended the block at another stage |

The full list of checks and their evidence is in the [checks reference](../reference/checks.md).

**If it goes wrong.**

- `The runs are not kept: pass --store <file> to keep them.`: you ran without `--store`. Run again with `--store runs.db`, then read it.
- The cell shows `!` and not `✗`: the run ended with an error, which means the agent crashed or the adapter could not reach it. That is not a wrong answer. Run the agent by hand to see the error.
- A check you expect is not in the list: it is not in `expect`. A check runs only when the block asks for it.

## 6. Run the whole folder

**Why you do this.** You now have three specs that pass. One command runs them all, so you can run the folder after every change to your agent.

**You need.** The folder `specs` from the steps above.

**Relevant commands.**

- `driftbench campaign run`: as before · `specs` is the folder, and driftbench finds every `*.yaml` file in it; `--process-command` starts the agent for the specs that target `process:my-agent`, and the Acme spec reaches its own agent · it prints one line per spec and a count.

**You type.**

```console
$ driftbench campaign run specs --process-command "[\"node\",\"$PWD/agent.mjs\"]"
✓ acme-coverage · function:acme-sales · F · repeat 0  pass  2 blocks
✓ refund-ask · process:my-agent · F · repeat 0  pass  1 block
✓ refund-flow · process:my-agent · F · repeat 0  pass  3 blocks
3 cells: 3 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.** Three cells, three passes, no cost. The exit code is 0, so a script or a pipeline can rely on it.

**If it goes wrong.**

- One cell fails: read it with step 5. Fix the agent, or fix the expectation if the expectation was wrong.
- `Campaign <id> already exists. Resume it with: driftbench campaign resume <id>`: you gave `--campaign` an id the store already holds. Pick another id, or drop the option.

## What a judge adds

Some qualities no pattern can test, such as "the reply is polite" or "the reply asks only one question". For these you write a **criterion**: a question in plain words that a model, called a **judge**, answers with pass or fail. You list criteria at the top of the spec and name them in a block.

```yaml
criteria:
  - name: one_question
    rubric: The reply asks the customer at most one question.
blocks:
  - user: Hello, I'm new here and looking for home internet.
    expect:
      criteria: [one_question@gating]
```

`@gating` says that a failing answer fails the block. Without it, the verdict is reported and the block still passes. A campaign with no judge prints `Not judged:` and gives these criteria no verdict. Prefer a check whenever code can decide, because a check is free and always gives the same answer. Judges are the subject of the [judges page](../concepts/judges.md).

## Where to go next

- Let driftbench write hundreds of specs for you: [Generate tests](generate-tests.md).
- Every key of a spec: the [spec reference](../reference/spec.md). Every check and its evidence: the [checks reference](../reference/checks.md).
- Run the same specs several times, keep them and open a scorecard: step 6 of the [quickstart](quickstart.md).
