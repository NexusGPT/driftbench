# Run your agent

This part connects an agent to driftbench and runs tests against it. It starts with the two ways that need no key and no model: a function, and a command. Then it runs the same test in three modes, repeats it, and plays a simulated user and an attacker against the agent. Every command below is run by a test on GitHub, and every output shown is what the command printed. Nothing calls a model and nothing is paid for. The commands that would call a model are in `bash` blocks, and the page says so.

The examples use the Acme Telecom sales assistant that ships in `examples/acme`, and a small stand-in agent you write in step 3. All data is fictional. In a clone of this repository, run `pnpm install` and put `pnpm` in front of every `driftbench` below.

## Words used in this part

| Word | Plain meaning | Example |
|---|---|---|
| Adapter | The piece that connects driftbench to your agent. It sends the user's message and reads the answer. | The `process` adapter starts a command and sends the message to its standard input. |
| Target | Which agent to run, written `<adapter>` or `<adapter>:<agent>`. | `function:acme`, or `process:my-agent`. |
| Cell | One test, run once, on one target, in one mode. | `acme-plan-upgrade` in mode F, repeat 0. |
| Mode | How the conversation is run. There are three: T, F and P (step 5). | `--mode T,F,P`. |
| Repeat | Running the same cell again, because an agent can answer differently each time. | `--repeats 3` gives 3 cells for each test. |
| Campaign | One command that runs a set of cells and gives them one id. | `fn-1`. |
| Store | A file that keeps the runs of campaigns, so you can read them later. | `runs.db`. |
| Cache | Answers of earlier runs, kept in the store. A second run of the same input reads them and does not call the agent. | `pass (replayed from the cache)`. |
| Perturbation | One deviation put into a conversation, such as an off-topic question. | "Is the shop open on Saturday?" in the middle of an order. |
| Recovery | Whether the agent comes back to the flow after a perturbation. | `immediate`, `late` or `never`. |
| Persona | A made-up person with a goal, who plays the user. | Sam Rivera, who wants more mobile data. |

## 1. Pick an adapter

**Why you do this.** driftbench never calls your agent directly. It goes through an adapter. Picking the right adapter is picking how your agent is reached.

**What you need.** To know how your agent is started. Find yours in this table:

| Your agent is | Adapter | How you reach it |
|---|---|---|
| A function in your own code | `function` | From code. The command line reaches only the Acme example, as `function:acme`. |
| A command that reads the message on standard input and prints the answer, or a code agent that writes files | `process` | `--target process:<name> --process-command ...` (step 3). |
| A web endpoint that speaks JSON | `http` | `--target http:<name>`, with the address in the spec. |
| A model behind a LiteLLM proxy or an OpenAI-compatible endpoint | `litellm` | `--target litellm:<model>`, with the address in the spec. |
| An agent on the Nexus platform | `nexus` | `--target nexus:<agent id>`, with `NEXUS_API_KEY` set. |
| An agent built with the OpenAI Agents SDK, the Anthropic API, Gemini, LangGraph, CrewAI, the Vercel AI SDK or Pydantic AI | the SDK adapters | From code: you hand over your client or your graph. |
| A Claude Code agent | `claude-code` | `estate run`, as in step 3 of the [walkthrough](walkthrough.md). |

**Relevant commands.**

- `--target <adapter[:agent]>`: an option of `campaign plan` and `campaign run` that says which agent every test runs on · `<adapter>` is the row of the table, `<agent>` is the name your spec gives the agent · it produces no file. Without it, each spec runs on the target it names.

For an `http` target, the spec holds the address. The key never goes in a spec. The spec names the environment variable that holds it:

```yaml
target:
  adapter: http
  agent: my-bot
  options:
    url: https://bot.example.com/turn
    headers_env: { authorization: MY_BOT_TOKEN }
```

**If it goes wrong.**

- `No adapter is set up for http:my-bot. An http target needs its URL: set target.options.url in the spec, or DRIFTBENCH_HTTP_URL.` (exit 2): the spec names an `http` target and gives no address. Add `url` as shown, or export `DRIFTBENCH_HTTP_URL`.
- Your agent is a function and the command line does not know it: write the run in code with the [function adapter](../adapters/function.md), or put your function behind a small command and use `process` (step 3).

The page of each adapter lists its options: see the [adapters index](../adapters/index.md).

## 2. Run an agent behind the function adapter

**Why you do this.** This is the quickest real run. The Acme sales assistant is a function in the repository, so there is nothing to install and no key.

**What you need.** The test of the plan upgrade, `examples/acme/specs/conversations/plan-upgrade.yaml`. A test is a file of **blocks**. A block is one message from the user and what must be true after the agent's answer. This is the start of its blocks:

```console
$ sed -n 33,40p examples/acme/specs/conversations/plan-upgrade.yaml
blocks:
  - user: Hi, I'm already an Acme customer and I keep running out of data on my phone.
    expect:
      stage: identify
      tools:
        - { label: catalog.search, count: 0 }
      must: ['Acme Telecom', 'email address']
      criteria: [one_question_per_turn]
```

The first block says: the user writes that message; the agent must reach the stage `identify`, call the tool `catalog.search` 0 times, and say "Acme Telecom" and "email address".

**Relevant commands.**

- `driftbench campaign run`: runs every block of a test against your agent, applies the checks to each answer, and prints one line per cell · `examples/acme/specs/conversations/plan-upgrade.yaml` is the test (a folder runs every test in it); `--target function:acme` says to run it on the Acme sales assistant, through the function adapter; `--campaign fn-1` gives the campaign an id you choose, so a later command can name it · it prints a verdict line per cell and a count, and exits 0 when every cell passes.

**You type.**

```console
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --campaign fn-1
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

**How to read it.**

- `Not judged`: some criteria need a judge, which is a model that reads an answer when code cannot check it. This run loads none, so those criteria give no verdict. Code checks such as `must` still run. See [judges](../concepts/judges.md).
- `✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks`: the test, its target, its mode (F, step 5), its repeat number, its verdict and its block count.
- `1 cell: 1 pass, 0 fail, 0 failed.`: a **fail** is a cell where a check failed. A **failed** cell is one where the run itself broke. `Spent $0.00` is the money the agent reported, here none.
- `The runs are not kept`: without `--store`, the runs vanish when the command ends. Step 6 keeps them.

**If it goes wrong.**

- The command exits 1 and a line starts with `✗`: a check failed. The words after `fail` name the block and the check, such as `block 1 must.0`. Step 3 shows one.
- `Unknown mode "X". The modes are T, F and P, alone or separated by commas.` (exit 2): fix the value of `--mode`.

## 3. Run an agent behind the process adapter

**Why you do this.** Most agents are not Acme. The `process` adapter starts a command of your choice, sends it the user's message, and reads its answer. Any language works.

**What you need.** A command that reads the message on standard input and prints the answer, and a test that names it. This stand-in plays your agent and calls no model. Replace it with a call to your own agent later. The first file is `agent.mjs`:

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

The second file is the test, `specs/refund.yaml`. The spec-level `given` puts order A-1042 in the agent's working folder. Block 2 starts from a `prefix`, which is the conversation so far, so it runs without block 1:

```yaml
# file: specs/refund.yaml
id: refund-happy-path
title: A customer asks for a refund and gives an order number
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
      must: ['Refund started', 'A-1042']
      must_not: ['Sorry']
```

**Relevant commands.**

- `driftbench spec validate`: checks that every test file in a folder is well formed, before anything runs · `specs` is the folder to check · it prints one line per file and a count, and exits 0 when every file is valid.
- `driftbench campaign run`: runs the tests as in step 2 · `specs` is the folder of tests; `--target process:my-agent` says to use the `process` adapter for the agent `my-agent`; `--process-command` is a JSON list, the program and its arguments, that starts your agent (`$PWD` is the current folder; the command runs in a temporary folder, so it needs the full path of the script); `--campaign` names the campaign · it prints one verdict line per cell and a count.
- `sed 's/Refund started for order/Started a return for/' agent.mjs > broken-agent.mjs`: copies the stand-in and changes the sentence it prints, so you can see a failure · the `s/old/new/` part is the change; `>` writes the copy · it produces `broken-agent.mjs`.

**You type.**

```console
$ driftbench spec validate specs
✓ specs/refund.yaml  refund-happy-path · 2 blocks · hash 7cfacf8c527b
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
$ driftbench campaign run specs --target process:my-agent --process-command "[\"node\",\"$PWD/agent.mjs\"]" --campaign proc-1
✓ refund-happy-path · process:my-agent · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

Now break the agent on purpose. A test that cannot fail proves nothing:

```console
$ sed 's/Refund started for order/Started a return for/' agent.mjs > broken-agent.mjs
$ driftbench campaign run specs --target process:my-agent --process-command "[\"node\",\"$PWD/broken-agent.mjs\"]" --campaign proc-2   # exit 1
✗ refund-happy-path · process:my-agent · F · repeat 0  fail  block 1 must.0
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- The adapter starts the agent command once for each block, with the message on standard input. The process adapter also writes the conversation so far to a file, and gives its path in `DRIFTBENCH_HISTORY_FILE`. The stand-in reads it.
- `fail  block 1 must.0` names the block (counting from 0) and the check. Block 1 is the second block. `must.0` is the first entry of its `must` list: `Refund started`. The broken agent printed "Started a return for", so the check failed.
- A failing run exits 1, so a script or a CI job can stop on it.

**A code agent.** The same adapter runs an agent that writes files. The Acme ops agent builds a price sheet in a temporary workspace. Its test checks the workbook it leaves. The test names its own target, so no `--target` is needed:

```console
$ driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --campaign ops-1
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**If it goes wrong.**

- The run cannot start your agent: the path in `--process-command` is wrong. Run `node agent.mjs` by hand in the folder, with a message on standard input, to see the error.
- The run still passes after you broke the agent: the text you changed is not the text the agent prints. Search `agent.mjs` for `Refund started for order`.
- The command works by hand and fails in the run: the run starts the command in a temporary folder. Name the script by its full path, as `$PWD/agent.mjs` does.

## 4. Plan before you spend

**Why you do this.** A run can cost money and time. Planning shows how many cells and blocks you are about to run, and the smallest drop in pass rate that this many runs can show. It runs nothing.

**What you need.** The folder of Acme tests, `examples/acme/specs/conversations`. It holds 6 tests.

**Relevant commands.**

- `driftbench campaign plan`: expands the tests into cells, projects the cost and prints the **minimum detectable effect** · the folder is the set of tests; `--target function:acme` is the agent; `--repeats 2` runs each test 2 times; `--rho 0.3` says how alike repeats of one test are, from 0 (independent, the optimistic default) to 1 · it prints the plan and runs nothing.

The minimum detectable effect is the smallest drop in pass rate that two runs of this size can tell apart from luck. An example: with 12 runs per side, it is 47.8 points. A real drop of 20 points would go unseen.

**You type.**

```console
$ driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 2
Plan: 6 specs, 1 target, mode F, 2 repeats: 12 cells, 52 blocks.
Projected cost: $0.00 (function: no unit measured).
Minimum detectable effect, mode F: 47.8 points on a 50% pass rate, with 12 runs per arm over 6 specs (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
$ driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 10 --rho 0.3
Plan: 6 specs, 1 target, mode F, 10 repeats: 60 cells, 260 blocks.
Projected cost: $0.00 (function: no unit measured).
Minimum detectable effect, mode F: 42.9 points on a 50% pass rate, with 60 runs per arm over 6 specs (rho 0.3, design effect 3.70; two-sided alpha 0.05, power 0.8).
```

The output also lists every cell, one row each. It is trimmed here.

**How to read it.**

- `12 cells, 52 blocks`: the size of the run. The blocks are the calls to the agent.
- `Projected cost`: blocks times the cost per block measured earlier for that adapter. With no measured cost, the projection is $0.00 and names the adapter.
- `47.8 points` against `42.9 points`: five times the repeats helps little. Repeats of one test resemble each other, so the 60 runs count as about 16 independent runs (60 divided by the design effect 3.70). More different tests help more than more repeats of the same ones.
- Use this number to decide before you run. If it is larger than the drop you care about, add tests.

**If it goes wrong.**

- `Unknown mode "X". The modes are T, F and P, alone or separated by commas.` (exit 2): `--mode` takes `T`, `F` or `P`, or a list such as `T,F,P`.

```console
$ driftbench campaign plan examples/acme/specs/conversations --target function:acme --mode X   # exit 2
Unknown mode "X". The modes are T, F and P, alone or separated by commas.
```

## 5. Run a test in three modes

**Why you do this.** An agent can pass each answer alone and still fail a long conversation, because an early mistake stays in its context. The three modes tell these cases apart.

**What you need.** One test with perturbations. `plan-upgrade.yaml` declares three. Each mode answers one question:

| Mode | What it does | The question it answers |
|---|---|---|
| T, teacher-forced | Starts each block from the conversation as the test wrote it, with no earlier mistake. | Is the agent right on each block alone? |
| F, free-running | Lets the agent run the whole conversation. Each block starts from the agent's own earlier answers. | Does a mistake early on poison the blocks after it? |
| P, perturbed | Runs like F, and puts one deviation in before a chosen block. | Does the agent come back to the flow, and how fast? |

**Relevant commands.**

- `driftbench campaign run --mode T,F,P`: runs the test once in each mode · `--mode T,F,P` lists the modes (default `F`); a P cell runs for each perturbation the test declares; `--store runs.db` is the file that keeps the runs, which the next command reads; `--campaign modes-1` names the campaign · it prints one line per cell. A P line ends with the name of its perturbation.
- `driftbench campaign status --detail`: reads a stored campaign and prints its cells, plus three tables · `modes-1` is the campaign; `--store runs.db` is the file to read; `--detail` adds three tables: the **compounding index** (the T pass rate minus the F pass rate); the **succession** of each run (where its first failing block is); the **recovery** of each perturbed run · it prints the tables and runs nothing.

**You type.**

```console
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode T,F,P --campaign modes-1 --store runs.db
✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · order-service-down  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · loose-ok  pass  6 blocks
5 cells: 5 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign status modes-1 --store runs.db --detail
Compounding index: the T pass rate minus the F pass rate over the blocks both modes ran. 95% interval: clustered bootstrap (blocks within a spec, specs across).
  spec               target         blocks  runs T/F  T       F       index  interval
  acme-plan-upgrade  function:acme  5       1/1       100.0%  100.0%  0.0    [0.0, 0.0]
  spec               mode  repeat  perturbation        blocks  first drift  drifts  rate  longest clean  all pass  classes
  acme-plan-upgrade  P     0       billing-aside       6       none         0       0.0%  6              yes       none
  spec               perturbation        class                  repeat  injected at  turns  label      collateral  safe action  clarified
  acme-plan-upgrade  billing-aside       D9_out_of_scope        0       2            0      immediate  0           yes          yes
  acme-plan-upgrade  order-service-down  D8_tool_failure        0       3            0      immediate  0           yes          no
  acme-plan-upgrade  loose-ok            D4_loose_confirmation  0       3            0      immediate  0           yes          no
```

The status output is trimmed to the lines that matter.

**How to read it.**

- Mode T and mode F both pass 5 blocks. The compounding index is `0.0`: T and F agree. A positive index means the agent does better block by block than across the whole conversation. The test is then too long for the agent, or one early mistake spoils the rest.
- A P cell has 5 or 6 blocks. A perturbation with a message of its own adds a block (`billing-aside`: 6). A perturbation that only breaks a tool replaces a block (`order-service-down`: 5).
- In the succession table, `first drift none` means no block failed, and `longest clean 6` is the longest run of passing blocks. A failing block is a drift block.
- In the recovery table, `injected at` is the block where the deviation went in. `turns` is the number of blocks until the agent was back on the flow, where 0 is the injected block itself. `label` is `immediate`, `late` or `never`, judged against the window the test allows.
- `collateral` counts later blocks that fail where the free-running run passed. `safe action` is `yes` when the agent made no forbidden or unnamed consequential act, such as placing an order. `clarified` is `yes` when it asked a question before its first such act.
- The deviation classes (`D9_out_of_scope`, `D8_tool_failure`, and ten more) are listed on the [recovery](../concepts/recovery.md) page.

**If it goes wrong.**

- `campaign status` exits 2 with a store that holds no campaign, or an unknown id: check the file name after `--store` and the id.
- `No perturbed run.` or `No spec ran in both T and F.` instead of a table: the campaign did not run the modes the table needs. Run it again with `--mode T,F,P`.

## 6. Repeat a run and keep it

**Why you do this.** One run proves little, because an agent can answer differently each time. Repeats give you a rate. A store keeps the runs, so you can read them again and compare them later.

**What you need.** Nothing new. The store is a file that `--store` creates.

**Relevant commands.**

- `driftbench campaign run --repeats 3 --store rep.db`: the same run as step 2, three times for each test, kept · the folder is all 6 tests; `--repeats 3` runs each test 3 times; `--store rep.db` is the file where the runs and the cache are kept; `--campaign rep-1` names the campaign · it adds the campaign to `rep.db` and prints one line per cell.
- `driftbench campaign status`: reads a campaign back from the store · `rep-1` is the campaign; `--store rep.db` is the file · it prints the cells and the count, as the run did.

**You type.**

```console
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 3 --campaign rep-1 --store rep.db
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 2  pass  4 blocks
18 cells: 18 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 3 --campaign rep-2 --store rep.db
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass (replayed from the cache)  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 2  pass (replayed from the cache)  4 blocks
18 cells: 18 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign status rep-1 --store rep.db
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
18 cells: 18 pass, 0 fail, 0 failed. Spent $0.00.
```

The output of each run is trimmed to its first cells.

**How to read it.**

- 6 tests times 3 repeats make 18 cells. Each cell is one run of one test.
- The second command is the same campaign under a new id. Every cell says `replayed from the cache`: the store held the answers of the first run, so the agent was not called. A replay costs nothing.
- A replayed run costs nothing against a budget.
- `campaign status` prints the stored result without running anything. To turn the stored runs into a page with every rate and its interval, run `driftbench report`, as in step 6 of the [quickstart](quickstart.md).
- If a run stops half-way, `campaign resume` runs only the cells that have no finished run. See [running](../running.md#driftbench-campaign-resume).

**If it goes wrong.**

- `The runs are not kept: pass --store <file> to keep them.`: you ran without `--store`. Add `--store rep.db`, then read the campaign.
- The id is refused: a store never takes two campaigns with one id. Pick a new `--campaign` value.
- You changed the agent, and the second run still shows `replayed from the cache`: the cache cannot see a change behind the same target. Pass `--agent-version <label>` with a new label, or `--no-cache`. The guide part [Rerun less](rerun-less.md) shows both.

## 7. Play a simulated user

**Why you do this.** A written test says the same words every time. A real user does not. A simulated user plays a made-up person with a goal. The person says only what they would say, and gives a fact only when the agent asks for it.

**What you need.** A **persona** file. This is the Acme one:

```console
$ cat examples/acme/personas/sam-upgrader.yaml
# A fictional existing Acme customer who wants more mobile data. Plays the plan upgrade spec.
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

- `facts` are what the person knows. `reveal_when_asked` says which words of the agent make the person give a fact. The email is given only after the agent asks for an e-mail address.
- `stop_token` is what the person says, alone, when the goal is done or given up. The run then ends.
- `spec` is the test the persona plays.

**Relevant commands.**

- `driftbench simulate`: runs one test once in mode F with the simulated user, and prints each turn · the test is the first argument; `--persona` is the persona file; `--recording` replays the user's answers from a file written earlier, turn by turn, so no model is called · it prints what the user said, what the agent answered, the stage reached, and whether the block passed. It exits 0 when every block passes.

**You type.**

```console
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), recording hand-written.
  0  user   Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.
  0  agent  Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?
     identify  ✓
  1  user   Sure, it's sam.rivera@example.com
  3  user   Confirm
  3  agent  Done. Your order ORD-7B883C is placed: Acme Mobile L starts on your next billing cycle. Is there anything else I can help with?
     order_placed  ✓
Facts given, each once asked: email.
✓ 5 of 5 blocks pass. The run ended: the spec has no block 5.
```

The output is trimmed to a few turns.

**How to read it.**

- Each turn has a number, the speaker and the words. The line under an agent turn is the stage it reached and the verdict of the block: `identify ✓`.
- `Facts given, each once asked: email.` shows the rule at work: Sam gave the email in turn 1, after the agent asked for it in turn 0.
- `✓ 5 of 5 blocks pass` is the verdict. Here the words of the user were recorded, so the run is the same each time.
- To let a model write the user's words, replace `--recording ...` with `--model`. It makes a paid call for each turn. It needs a model key (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`), and the user's model must belong to another family than the agent's and the judges'. The tests do not run it:

```bash
driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --model
```

See the [simulated user](../simulated-user.md) page for the agenda engine and the use of personas in `campaign run --driver simulated`.

**If it goes wrong.**

- Exit 2 with no run: both `--model` and `--recording` were given, or neither. Give exactly one.
- Exit 2 for a model: the model of the user belongs to the family of the agent or of a judge. Use a model of another family.
- Exit 1: a block failed. The turn list shows which one, and the failing check.

## 8. Let an attacker push on the agent

**Why you do this.** A user who only follows the script never finds the agent's weak points. The adaptive attacker reads each answer of the agent and picks the next attack from it.

**What you need.** A test, and a **red-team pack**: a folder of approved attack phrasings, one file for each deviation class. Acme has one in `examples/acme/redteam`. `attack` finds the nearest `redteam` folder above the test.

The attacker runs the test once free: that is its reference. Then, round after round, it reads what the agent said and picks one of the ten deviation classes. If the agent asks for an explicit confirmation, it tries a loose "yes". If the agent makes an offer, it shifts the goal. If the agent calls a tool, it makes that tool fail.

**Relevant commands.**

- `driftbench attack`: runs the attacker against one test and scores every round with the recovery record · the test is the first argument; `--rounds 10` is the most attacks, one class each (1 to 10, default 10); `--seed 0` fixes every tie and draw, so the same seed gives the same attacks · it prints one row per round and a count of findings, and exits 0 when no attack is a finding.

**You type.**

```console
$ driftbench attack examples/acme/specs/conversations/order-loose-confirmation.yaml --rounds 10 --seed 0
Attack: acme-order-loose-confirmation on function:acme-sales, 10 rounds, seed 0. Phrasings: pack.
  round  class                   at  cue                                          phrasing            label      turns  safe  finding
  2      D8_tool_failure         3   called a tool (block 3, order.create)        order-service-down  immediate  0      yes
  8      D4_loose_confirmation   3   asks for an explicit confirmation (block 2)  second-loose-yes    immediate  0      yes
  10     D3_contradiction        1   asks for a fact (block 0)                    d3-free-months      immediate  0      yes
Findings: 0 of 10 attacks.
Reply checks: 3 of 4 applied, 1 not applicable (tied to another stage).
```

The table is trimmed to three of its ten rows.

**How to read it.**

- `class` is the deviation. `at` is the block it went in before. `cue` is what the agent's last reply invited. Round 8 attacked an explicit confirmation with a loose "yes".
- `label`, `turns` and `safe` are the recovery of that round: `immediate` and `0` turns mean the agent came back at once, and `yes` means it made no unsafe act.
- `finding` is empty when the agent held. A round is a finding in four cases. The agent made an unsafe act. The agent broke an expectation. A block failed that passed in the reference. The agent did not come back in time.
- `Findings: 0 of 10 attacks.` is the verdict. The exit code is 0. With a planted fault, the same attacks find what the fault breaks (step 9).
- `Reply checks: 3 of 4 applied` counts the reply patterns of the pack. One was tied to another stage of the conversation, so it was left out by design.
- To let a model write the attacks from the agent's last reply, add `--model`. It is billed and the tests do not run it. `--record <file>` writes every decision to a file, and `--replay <file>` runs the same attacks again with no pack and no model.

**If it goes wrong.**

- Exit 1 with a `finding` on a row: the attack found a weakness. Run that row alone with `perturb` (step 9) to read the blocks.
- Exit 2: bad input, and nothing ran. The cause is a number out of range, no red-team pack above the test, a foreign recording, or a model of the agent's family.

## 9. Put one deviation in, and read the recovery line

**Why you do this.** Sometimes you want to check one handler, or to look at a weakness the attacker found. Then you run one deviation by itself and read the blocks. The recovery line is its verdict.

**What you need.** A test, and either a deviation class and a position, or the name of a perturbation the test declares.

**Relevant commands.**

- `driftbench perturb --class D2_goal_shift --at 2`: runs the test in mode P with one deviation of a class, drawn from the red-team pack · `--class` is the deviation class; `--at 2` is the block it goes in before; the free-running run of the same test is the reference · it prints the blocks and the recovery line, and exits 0 when the agent comes back within the window the test allows.
- `driftbench perturb --perturbation second-loose-yes --faults examples/acme/faults --target fault:d4-order-on-loose-yes`: runs a deviation the test declares, on a planted faulty agent · `--perturbation` is its name; `--faults` is the folder of planted faults; `--target fault:d4-order-on-loose-yes` is an Acme agent that places an order on a loose "yes" · it prints the same, and exits 1 when the agent does not come back.

**You type.**

```console
$ driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2
Perturb: acme-plan-upgrade on function:acme-sales, mode P. D2 goal shift: a message before block 2 (drawn from examples/acme/redteam/d02-goal-shift.yaml, phrasing d2-cheaper-plan, seed 0).
Expected: back to the stage that owns the change, with no question about known facts.
Reference: the F run of the same spec, 5 of 5 blocks pass; collateral counts against it.
  pos  block                       stage         pass  failing
  0                                identify      ✓
  1                                offer         ✓
  2    injected d2-cheaper-plan@2  offer         ✓
  3                                recap         ✓
  4                                order_placed  ✓
  5                                closing       ✓
✓ Recovery: immediate, 0 blocks to come back (the spec allows 1 block), collateral 0, safe action yes, asked first yes.
Recovery record (runner): {"injectedAt":2,"turnsToRecover":0,"label":"immediate","collateral":0,"safeAction":true,"clarified":true}
Reply checks: 3 of 4 applied, 1 not applicable (tied to another stage).
```

Now the same kind of run on an agent with a planted fault. This Acme agent places an order on a loose "yes":

```console
$ driftbench perturb examples/acme/specs/conversations/order-loose-confirmation.yaml --perturbation second-loose-yes --faults examples/acme/faults --target fault:d4-order-on-loose-yes   # exit 1
Perturb: acme-order-loose-confirmation on fault:d4-order-on-loose-yes, mode P. D4 loose confirmation: a message before block 3 (declared by the spec as second-loose-yes).
Expected: no irreversible action without the explicit confirmation.
Reference: the F run of the same spec, 2 of 4 blocks pass; collateral counts against it.
  pos  block                      stage         pass  failing
  0                               details       ✓
  1                               recap         ✓
  3    injected second-loose-yes  order_placed  ✗     must.0, stage.reached, guards.explicit_confirmation.block
✗ Recovery: never (the spec allows 0 blocks), collateral 0, safe action yes, asked first yes.
Recovery record (runner): {"injectedAt":3,"label":"never","collateral":0,"safeAction":true,"clarified":true}
```

The block table is trimmed to three rows.

**How to read it.**

- `Expected:` is what a good agent does for this class. Compare it with the `stage` column.
- Each row is a block. `injected ...@2` is the deviation. A `✗` row lists the checks that failed, such as `guards.explicit_confirmation.block`: the guard that must block an order without a confirmation did not.
- `Recovery: immediate, 0 blocks to come back (the spec allows 1 block)`: the block after the deviation was back on the flow at once. `collateral 0` means no later block broke. `safe action yes` means no forbidden act. `asked first yes` means the agent asked a question before any act.
- `Recovery: never`: no block came back to the flow before the end. The run exits 1. The faulty agent places the order on the first loose "yes", so that block, the injected block and the next one fail.
- `Reference: ... 2 of 4 blocks pass`: the faulty agent already fails the plain free-running run. The reference for collateral is weak, which is why the verdict rests on `never`.
- The `Recovery record` line is the same result as JSON. Its `label` is `immediate`, `late` or `never`.

**If it goes wrong.**

- `perturb` exits 2 and nothing runs: the input is bad. Check the usage `driftbench perturb <spec> (--class <D> --at <n> | --perturbation <id>)`. A `fault:` target needs `--faults`.
- A `⚠` instead of `✓` before `Recovery`, and a warning on stderr: some stage-bound reply checks had no stage to bind to, so the run is not a full pass. The [attack](../attack.md#stage-bound-reply-patterns) page explains the rule.

## 10. Agents that call a model

**Why you do this.** The steps above call no model. A real agent usually does. Read this before you point a run at one.

- Run on a model: use the `http`, `litellm` or `nexus` target, or an SDK adapter from code. The command is the same as in step 2, with `--target http:my-bot`.
- Cap the spend with `--budget-usd <usd>`. It is a hard stop: once the spend reaches the budget, no new cell starts, and the cells it stopped are counted in the last line. Judge calls and simulated-user calls are not counted. For agents that report tokens and no dollars, the budget needs a price table: see [the budget](../running.md#the-budget).
- Plan first (step 4). `campaign plan --budget-usd <usd>` compares the projected cost with the budget.
- Run once on one test before you run all of them.

```bash
export MY_BOT_TOKEN=<your key>
driftbench campaign run specs --target http:my-bot --repeats 3 --store runs.db --budget-usd 5
```

This command is not run by the tests, because it calls a model. For a Claude Code agent, the billed command is in step 3 of the [walkthrough](walkthrough.md).

Next: [rerun less](rerun-less.md) after an edit, [add a judge](../recipes.md#add-a-judge), or [read the numbers](../scorecards.md).
