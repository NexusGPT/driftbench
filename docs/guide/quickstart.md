# Quickstart

About two minutes, most of it the install. You need Node 22 or newer and npm. No API key: the agent below is a short script that stands in for yours.

**1. Make a folder and install.**

**Why.** You need a folder for your tests and the driftbench package to run them.

**Relevant commands.**

- `mkdir my-evals && cd my-evals`: makes a folder for your tests and goes into it · no options · it produces the folder.
- `npm init -y`: starts a `package.json` so npm has somewhere to install · `-y` accepts every default · it produces `package.json`.
- `npm install @agent-nexus/driftbench`: installs driftbench · `@agent-nexus/driftbench` is the package · it produces `node_modules` and the `driftbench` command, run as `npx driftbench`.
- `mkdir specs`: makes the folder that will hold your tests · no options · it produces the folder.

```bash
mkdir my-evals && cd my-evals
npm init -y
npm install @agent-nexus/driftbench
mkdir specs
```

**2. Create `agent.mjs`.** It reads the user message on standard input, looks the order up in `orders.json` in its working folder, and prints the reply. Replace it with a call to your own agent later.

**Why.** driftbench tests an agent, so it needs one to talk to. This short script stands in for yours, so the quickstart needs no key and costs nothing.

```js
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

**3. Create `specs/refund.yaml`.** Each block is one test, with its starting conditions (`given`), the user's message and the expected reply. The spec-level `given` seeds order A-1042 in the agent's working folder and sets the channel. Block 2 starts from a `prefix`, so it runs without replaying block 1.

**Why.** A spec is the test: what the user says and what the agent must answer. Everything driftbench reports comes from specs.

```yaml
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

**4. Check the spec, then run it.** The output is trimmed to its verdict lines.

**Why.** Checking first catches a typo before anything runs. Running then shows the verdict of each block.

**Relevant commands.**

- `npx driftbench spec validate specs`: checks that every test file in a folder is well formed, before anything runs · `specs` is the folder to check · it prints one line per file and a count, and exits 0 when every file is valid.
- `npx driftbench campaign run specs --target process:my-agent --process-command ...`: runs every block of every test against your agent and checks each reply · `specs` is the folder of tests; `--target process:my-agent` says how to reach the agent (`process` is the adapter that starts a command, `my-agent` is its name in the spec); `--process-command` is a JSON list, the program and its arguments, that starts your agent (here `node` and the path of `agent.mjs`; `$PWD` is the current folder) · it prints one verdict line per test and a count, and exits 1 when a test fails.

```console
$ npx driftbench spec validate specs
✓ specs/refund.yaml  refund-happy-path · 2 blocks · hash 7cfacf8c527b
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
$ npx driftbench campaign run specs --target process:my-agent --process-command "[\"node\",\"$PWD/agent.mjs\"]"
✓ refund-happy-path · process:my-agent · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**5. Break the agent and run again.** Change `Refund started for order` to `Started a return for` in `agent.mjs`. The run now exits 1 and names the block and the check:

**Why.** A test that cannot fail proves nothing. Breaking the agent on purpose shows you what a failure looks like, and that the report names the block and the check.

```console
$ npx driftbench campaign run specs --target process:my-agent --process-command "[\"node\",\"$PWD/agent.mjs\"]"   # exit 1
✗ refund-happy-path · process:my-agent · F · repeat 0  fail  block 1 must.0
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

**6. Keep the runs and open the scorecard.** Run step 4 again with `--repeats 3 --store runs.db`, then write the scorecard.

**Why.** One run proves little. Repeats and a kept store give every rate a range, and the scorecard puts it all on one page.

**Relevant commands.**

- `campaign run ... --repeats 3 --store runs.db`: the same run as step 4, kept · `--repeats 3` runs each test 3 times, because one run proves little; `--store runs.db` is the file where the runs are kept · it adds the runs to `runs.db`.
- `npx driftbench report --store runs.db --out scorecard.html`: turns the kept runs into a page you can open · `--store runs.db` is the file to read; `--out scorecard.html` is the page to write · it produces one HTML file with every rate, its interval and every conversation.

```console
$ npx driftbench campaign run specs --target process:my-agent --process-command "[\"node\",\"$PWD/agent.mjs\"]" --repeats 3 --store runs.db
$ npx driftbench report --store runs.db --out scorecard.html
```

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/scorecard-dark.png">
    <img src="../assets/scorecard-light.png" alt="A driftbench scorecard, one HTML file, dark by default with a light theme. At the top, the candidate campaign against its baseline: 12 of 26 cases passing against 26 of 26 for the baseline, 36 of 78 runs passing, 14 of 26 cases regressed and none improved, McNemar p = 0.0001. Below, the two versions side by side, then three charts: cases passing by test, runs passing by mode (teacher-forced 57.1%, free-running 57.1%, perturbed 33.3%, each with its interval) and failed checks by type, led by tools (192) and must (162). Then the tests list: each test with its status, its score and one pass or fail pill per check family, the first one failing 0 of 4 cases." width="820" />
  </picture>
</p>
<p align="center"><sub>The scorecard of the example agents with a bug planted on purpose in each. Numbers and charts first, then every test, then every run: a click opens its conversation and its checks.</sub></p>

Next: [evaluate your own agent](../recipes.md#evaluate-your-own-agent), [add a judge](../recipes.md#add-a-judge), or [gate a pull request](../recipes.md#gate-a-pull-request). The full spec format is in the [spec reference](../reference/spec.md).

## If it goes wrong

- `npm: command not found`, or an engine warning: Node is missing or older than 22. Install a current Node from nodejs.org and run step 1 again.
- `spec validate` exits 1 and prints a file, a key and a code: the spec is not well formed. Fix the key it names. Every code is listed in the [CLI reference](../reference/cli.md).
- `campaign run` cannot start your agent: the path in `--process-command` is wrong. Run `node agent.mjs` by hand in the folder, with a message on standard input, to see the error.
- The run still passes after you broke the agent: the text you changed is not the text the agent prints. Search `agent.mjs` for `Refund started for order` and change exactly that.
- `The runs are not kept: pass --store <file> to keep them.`: you ran without `--store`. Add `--store runs.db`, then write the scorecard from it.
