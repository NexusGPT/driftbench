# Acme Telecom

Acme Telecom is a fictional telecom. Its sales assistant is the agent every driftbench example runs
against: a deterministic agent in TypeScript, in process, with tools and a fake payload store. No model,
no API key, no network, no random number, no clock.

The spec tree holds seven specs: six conversations with the assistant and one task for a code agent. One
block model, two kinds of block. They share one inventory, one coverage matrix and the commands below.

## Run it

From the repository root:

```sh
pnpm driftbench spec validate examples/acme/specs
pnpm driftbench spec lint --strict examples/acme/specs
pnpm vitest run examples/acme
pnpm driftbench spec coverage examples/acme/specs --inventory examples/acme/inventory.yaml
```

| Command | What you see |
|---|---|
| `spec validate` | 7 valid specs, each with its block count, perturbation count and hash |
| `spec lint --strict` | 0 warnings, exit 0 |
| `vitest run examples/acme` | every conversation spec driven through the agent, block by block, in a plain run and in one run per perturbation |
| `spec coverage` | the behaviour by channel matrix (chat 12 of 14, WhatsApp 2 of 11) and the flow by deviation matrix (7 of 10). It exits 1 on purpose: the inventory keeps known gaps |

The tests drive the user turns through the agent and check tools, `must`, `must_not`, stages, guards,
budgets, rules, the end state and the recovery after each perturbation. Criteria and ledgers wait for the
judges of Phase 2 and 3. The campaign in [The ops agent](#the-ops-agent) runs all seven specs through the
runner and the machine checks, the task spec on the Acme ops agent.

Talk to the agent from code:

```ts
import { createAcmeAgent } from './src/agent';

const agent = createAcmeAgent();
const observed = await agent.respond([
  { role: 'user', content: 'Hi, do you have home internet at 3 Orchard Way, Acmeville?' },
]);
observed.text; // "Hi, I'm the Acme Telecom sales assistant. Good news: 3 Orchard Way, Acmeville has fiber up to 300 Mbps. ..."
observed.toolCalls.map((call) => call.label); // ['coverage.check', 'catalog.search']
observed.runtime?.stages; // [{ name: 'offer' }]
```

## What is here

```
examples/acme/
  inventory.yaml                  behaviours, flows and channels: what coverage measures
  specs/conversations/*.yaml      six conversation specs
  specs/tasks/price-sheet.yaml    the code-agent task spec
  src/agent.ts                    createAcmeAgent(store?): respond(messages, world?) returns an Observed
  src/policy.ts                   the dialogue: flows, stages, guardrails, replies
  src/tools.ts                    catalog.search, coverage.check, port.check, order.create, notify_sales
  src/store.ts                    plans, addresses, customers, transfer records, and the payload log
  src/parse.ts                    how the agent reads a message: fixed patterns, no model
  src/package.ts                  what the command line loads: the two agents, the store, the ops agent's path
  package.json                    the example as a private workspace package, @agent-nexus/driftbench-example-acme
  ops/agent.mjs                   the Acme ops agent, the code agent of the task spec
  test/                           the tests, and test/support/drive.ts, the light runner they use
```

## How the command line finds it

The example is a private workspace package, `@agent-nexus/driftbench-example-acme`. The command line holds no copy of it: it imports the package by name when a run names `function:acme-sales`, `function:acme`, `process:acme-ops` or the pilot's `function:acme-random`. In a checkout of this repository the package is linked at the root, so every command on this page works from source (`pnpm driftbench`) and from the build (`pnpm build`, which also builds the example into `examples/acme/dist`). The published command is installed without the example; there, these targets have no adapter.

## The agent

* Deterministic. The same messages and the same world give the same `Observed`. A test fails if the agent
  reads the clock, draws a random number or calls `fetch`.
* Stateless. `respond(messages, world)` answers the last user turn and rebuilds its state from the turns
  before it. Earlier tool results come from `tool_calls` on assistant messages, so a past turn never calls
  a tool again. Consecutive user messages form one turn and get one reply.
* Observed. Each tool call is a `tool_call` segment followed by its `tool_result` segment. The reply is
  one `text` segment. `toolCalls` lists the calls with input, output or error, and latency. `runtime.stages`
  names the flow stage the turn ends in. `cost` is `{ usd: 0 }`.
* Guardrails. `runtime.guards` lists the ones that fired in the turn: `explicit_confirmation` passes on
  CONFIRM and blocks a loose yes; `instruction_in_data` blocks an instruction in anything the agent reads,
  once per turn.
* Data stays data. The agent reads the customer's message, the files of `world.workspace` (the folder
  `from`, then `files` over it) at every turn, and every tool answer and error. An instruction in the
  message refuses the turn. An instruction in a file or a tool answer is dropped each time it is read,
  before the agent reads the answer, and `instruction_in_data` reports a block: it reaches no reply and no
  payload, and the turn is answered from the clean data as it would be without it. A file stays in the
  workspace, so refusing on it would block every later turn. Only the poisoned value goes: a plan it
  leaves unreadable is left out of the catalog and the other plans are still offered; with no readable
  plan left, the answer is unreadable. The tool call is still observed as the tool answered. Only the
  agent's own text is trusted: the system message, its replies and its tool inputs are never read as data.
* World. `world.tools.<label>.error` makes the tool fail, and the agent says so without inventing its
  answer. `world.tools.<label>.result` replaces the answer. `latency_ms` is reported as the call's
  latency. `world.store` seeds records over the store, such as a transfer record for one spec.
* Retries. Read-only tools get one retry. `order.create` and `notify_sales` never do: a second call could
  place an order twice.
* Payload log. `order.create` and `notify_sales` record every payload they accept, forced results
  included. An `end_state` with `source: tool:<label>` reads the last one.

| Tool | Input | Answer |
|---|---|---|
| `catalog.search` | `category`, `customer_email`?, `address_id`? | `plans`; with an email, the `customer` and their current plan |
| `coverage.check` | `address` | `found`, `address_id`, `fiber_mbps`, `five_g` |
| `port.check` | `number` | `eligible`, and a `reason` when it is not |
| `order.create` | `type`, `plan_id`, `customer_id` or `customer`, `address_id`?, `port_number`? | `order_id`, `status` |
| `notify_sales` | `reason`, `customer`, `summary` | `ticket_id`, `queued` |

A tool refuses a parameter it does not know, so an invented argument fails loudly. The flow stages a spec
can expect: `needs`, `identify`, `address`, `port_number`, `offer`, `details`, `recap`, `order_placed`,
`callback`, `handover`, `closing`.

## The ops agent

`ops/agent.mjs` is the agent of the task spec, behind the target `process:acme-ops`: a deterministic code
agent in plain JavaScript that imports no driftbench package. The process adapter runs it with Node.js once
per block, in a local sandbox seeded with `catalog.csv` and `README.txt`.

* Protocol. It reads the instruction on stdin, or from the file the adapter names. Its working folder is the
  workspace. It appends the commands it runs to `DRIFTBENCH_COMMANDS_FILE` and its skill, guard and stage to
  `DRIFTBENCH_RUNTIME_FILE`, and it reads `DRIFTBENCH_HISTORY_FILE` to find the workbook an earlier turn
  named. What it prints is its reply.
* Block 0. It builds `out/acme-price-sheet.xlsx` with exceljs: the sheets Mobile and Home in catalog order,
  the header Plan, Allowance, Monthly price (USD) and Yearly price (USD), the monthly price as a number, and
  the yearly price as a formula, `=C2*12` on row 2 and the same on every row.
* Block 1. It adds a Summary sheet with the cheapest plan of each category, Mobile first: Acme Mobile S at
  15, then Acme Air 5G at 35. It changes no other file.
* Runtime. Each block reports the `xlsx` skill, the `no_destructive_ops` guard and its stage, `build_sheet`
  or `add_summary`, and runs one command: the agent itself with `--check`, which reads the workbook back and
  exits 1 on a missing sheet, an error cell or a file that does not open.
* Guard. Before it writes, the guard reads the plan. It blocks a write outside `out/` or through a symbolic
  link, and then nothing is written. The agent has no operation that removes a file.
* Data stays data. It opens `catalog.csv` (or `catalog.json` when no CSV exists) and its own workbook and no other file, so the instruction the
  perturbation plants in `NOTES.txt` never reaches it.
* Deterministic. The same instruction and workspace give the same reply and the same workbook, byte for byte:
  the document dates and the zip entry times are fixed. Only the timing of its command varies.

One command runs every spec on its own target, the six conversations on `function:acme-sales` and the task
on `process:acme-ops`:

```sh
pnpm driftbench campaign run examples/acme/specs --repeats 2 --store /tmp/acme-campaign.db
pnpm driftbench campaign status --store /tmp/acme-campaign.db
```

`campaign run` prints one line per cell and ends with `14 cells: 14 pass, 0 fail, 0 failed. Spent $0.00.`
`campaign status` without a campaign id shows the latest campaign of the store. With `--target`, every spec
runs on that target instead. The sandboxes are local folders with weak isolation: the agent runs as you.
They sit in one temporary folder per campaign, removed when the campaign closes, and no flag keeps them.

## The specs

| Spec | Kind | Flow | Channel | Covers | Perturbations | What it shows |
|---|---|---|---|---|---|---|
| `plan-upgrade` | conversation | upgrade | chat | B-001, B-002, B-008, B-009, B-012 | D9_out_of_scope, D4_loose_confirmation | identify by email, offer more data only, CONFIRM before `order.create`, an exact end state |
| `new-customer-coverage` | conversation | new-home | chat | B-003, B-004, B-005, B-011 | D1_off_topic, D6_instruction_in_data | coverage before any offer, only the plans the address gets, a callback lead |
| `number-porting` | conversation | porting | whatsapp | B-006, B-008 | D5_language_switch, D7_silence_or_burst | `port.check` before any promise, a seeded store, the number on the order |
| `order-loose-confirmation` | conversation | order | chat | B-003, B-008, B-009, B-010 | D4_loose_confirmation, D8_tool_failure | a loose yes written as an injection block, the confirmation guard blocking then passing, the end state of `order.create` |
| `off-topic-return` | conversation | new-home | chat | B-003, B-004, B-011 | D10_return | two off-topic detours and a return as injection blocks, no tool run twice, `end_state: none` |
| `tool-failure` | conversation | new-home | chat | B-003, B-005, B-010 | D8_tool_failure | `coverage.check` forced to fail by a block override, an honest fallback, a stubbed `notify_sales` |
| `price-sheet` | task | price-sheet | chat | B-013, B-014 | D6_instruction_in_data | code ran with exit 0, xlsx artifact checks, the workspace diff, no destructive operation, the xlsx skill, a `no_destructive_ops` guard |

Between them the specs use `ledger_seed`, `given` on the spec and on blocks, tool overrides with `error`,
`result` and `latency_ms`, a seeded store, `workspace_seed`, a `stages` catalogue, local `criteria` with
`@gating`, `guards`, `tool_order`, count ranges, every assertion kind (a bare value, `exact`, `regex`, `contains`,
`one_of`, `nonempty`, `absent`, `subset`), the rules `max_calls`, `forbidden_tools`, `lang_stable` and
`one_message_per_turn`, `end_state` in `exact`, `subset` and `none`, budgets, burst and injection
stimuli, and perturbations by `user`, `burst` and `world`, each with a recovery.

The task spec reads the same catalog the assistant sells from: a test fails if `catalog.csv` or the
expected cells drift from `src/store.ts`. The xlsx reader of `@agent-nexus/driftbench-artifacts` answers its artifact
checks (`sheets`, `header`, `rows`, `cells`, `formula`, `no_error_cells`).

## The inventory

`inventory.yaml` lists 14 behaviours (12 conversation, 2 task), 5 flows and 2 channels. A spec covers
behaviours through `covers` and runs on one `channel`. It joins a flow through its `flow:<id>` tag, or by
covering one of the flow's behaviours. Its perturbations and its injection blocks cover deviation
classes for every flow it joins. A behaviour without `channels` applies to every channel.

The gaps are deliberate, so the matrix shows covered and missing cells:

* B-007 (a number that cannot move) has no spec yet.
* Most behaviours have no WhatsApp spec, and B-006 has no chat spec.
* The new-home flow requires D5_language_switch, and no new-home spec perturbs with it.
* The order flow requires D2_goal_shift and D3_contradiction, and no order spec perturbs with them.

## How the tests read a spec

`test/support/drive.ts` stands in for the Phase 1 runner, with these readings:

* Free-running. The history is the scripted user turns plus the agent's own replies.
* A perturbation with `user` or `burst` inserts a block before block `inject_at`, checked against the
  perturbation's `expect`. A perturbation with only `world` inserts nothing: its world applies from block
  `inject_at` onwards, and its `expect` replaces that block's.
* Worlds accumulate: the spec's, then each block's from that block onwards, then the perturbation's. For
  each tool, the later one wins.
* Recovery holds when a block within `within_blocks` of the injection, the injection itself counting as 0,
  ends in `stage_after`.
* An expected guard with a `verdict` counts only the events with that verdict. Without `count` it must
  fire at least once; `count: 0` means it never fires.
* The end state is checked on unperturbed runs. A tool with no `count` must run at least once. Input
  assertions hold on every call of the tool in the block.
* `lang_stable` is read as "no reply carries a word of another language", a stand-in for the language
  detector of the checks package.

## Data

Everything here is fictional: Acme Telecom, the town of Acmeville, the people, the prices, the plans.
Emails use example.com. Phones sit in the reserved range +1 202 555 0100 to +1 202 555 0199.
