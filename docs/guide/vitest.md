# Vitest

This is a hands-on guide to running driftbench specs inside a vitest suite. Vitest is a test runner for JavaScript and TypeScript. If your team already writes tests with it, a driftbench spec can run in the same suite. Each block of the spec becomes one vitest test. The guide writes a small agent and a test file, runs it, makes it fail, and reads the failure. Then it compares this way of running with `campaign run`. Every command below is run by a test on GitHub, and every excerpt is real output. Nothing calls a model and nothing is paid for.

## Before you start

**Why you do this.** The vitest package is a thin layer over the same runner that `campaign run` uses. This part names what you need and what you install.

**What you need.**

- Node 22 or newer, and driftbench installed from a clone, as the [guide index](index.md#install) shows. That gives you the command `driftbench`. Run this page from the root of the clone.
- A working folder named `vitest-demo`, made inside the clone by step 1.

**What you install.** In your own project, you add three packages: the vitest plugin of driftbench, the adapters package that holds `functionAdapter`, and vitest itself. This line is not run by our tests, because it changes your project:

```bash
npm install --save-dev @agent-nexus/driftbench-vitest @agent-nexus/driftbench-adapters vitest
```

This guide runs from a clone, so the packages come from the clone's sources and nothing is installed. Two small files in step 1 do that job. In your own project, the install line replaces both.

**Words used here.**

- A **spec** is one test file of driftbench. A **block** is one user message and what must be true of the reply.
- A **test file** is a file whose name ends in `.test.ts`. Vitest runs every test it finds in such files.
- A **function target** is an agent that is a plain function: it takes the chat so far and returns a reply.

The full description of the package is in the [vitest reference](../vitest.md).

## 1. Set up the folder

**Why you do this.** Everything runs from one folder. This step makes it and links the clone's packages into it.

**Relevant commands.**

- `mkdir -p vitest-demo/specs`: makes the working folder and the folder for the spec · `-p` makes the folders only when they are missing · it produces `vitest-demo/specs`.
- `cd vitest-demo`: goes into the working folder · no options · every later command runs from there.
- `ln -s "$(cd -P ../examples/.. && pwd -P)/node_modules" node_modules`: links the packages of the clone into the folder, so vitest finds itself · `-s` makes a symbolic link. The part in quotes is the full path of the clone's `node_modules` folder · it produces the link `node_modules`. In your own project, `npm install` makes this folder.

```console
$ mkdir -p vitest-demo/specs
$ cd vitest-demo
$ ln -s "$(cd -P ../examples/.. && pwd -P)/node_modules" node_modules
```

The second file tells vitest to read the driftbench packages from the sources in the clone. It finds the clone by following the link `examples` that the clone holds. In your own project, you need no such file:

```js
// file: vitest.config.mjs
import { readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const clone = dirname(realpathSync('../examples'));
const alias = {};
for (const name of readdirSync(join(clone, 'packages'))) {
  alias[`@agent-nexus/driftbench-${name}`] = join(clone, 'packages', name, 'src/index.ts');
}

export default { resolve: { alias }, test: { include: ['*.test.ts'] } };
```

**If it goes wrong.**

- `ln: ../examples/../node_modules: No such file or directory` or a later `Cannot find module`: you did not run the step from the clone root, or the clone has no `node_modules`. Run `pnpm install` in the clone, then step 1 again.

## 2. Write the spec, the agent and the test file

**Why you do this.** The spec says what the customer says and what the agent must answer. The agent is the function under test. The test file connects them.

**You need.** Three files. The spec asks one question and expects the word `Acme` in the answer:

```yaml
# file: specs/hello.yaml
id: vt-hello
title: A function agent greets the customer
target: { adapter: function, agent: acme-sales }
blocks:
  - user: Hi, I would like to change my plan.
    expect:
      must: ['Acme']
```

The agent is a function. It receives the messages of the chat, and the last one is the customer's. It returns a reply with its text and the tool calls it made, here none:

```ts
// file: agent.ts
type Message = { role: string; content: string };

export function respond(messages: Message[]) {
  const text = `Hello from Acme. You said: ${messages.at(-1)?.content ?? ''}`;
  return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: {}, latencyMs: 0 };
}
```

The test file is the part that matters. It runs the spec on the agent:

```ts
// file: agent.test.ts
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { describeSpec } from '@agent-nexus/driftbench-vitest';
import { respond } from './agent';

describeSpec('specs/hello.yaml', functionAdapter({ respond, deterministic: true }));
```

**Relevant commands.**

- `describeSpec(path, target)`: reads the spec at `path` and registers one vitest test per block, named after the spec · `path` is a path from the folder you run vitest in. `target` is an adapter, or a function that makes one · it registers the tests and runs nothing yet. The spec runs once, when the first test starts.
- `functionAdapter({ respond })`: turns your function into the adapter that `describeSpec` needs · `respond` is the function. `deterministic: true` says the same input always gives the same reply · it returns the adapter.

**How to read it.** The spec file names a target, but `describeSpec` ignores it and uses the adapter you pass. That is how one spec can run against different agents.

## 3. Run the test

**Why you do this.** This is the whole idea. You run vitest as you always do, and the spec runs inside it.

**Relevant commands.**

- `node_modules/.bin/vitest run agent.test.ts`: runs the tests of one file once and exits · `run` runs once and does not watch for changes. `agent.test.ts` keeps vitest to that file. In your own project, type `npx vitest run` · it prints one line per test file, a count, and exits 0 when every test passes.
- `--config vitest.config.mjs`: the config file of step 1, so that vitest reads the clone's packages · the value is the file · it changes only where packages come from.

**You type.** The output is trimmed to its stable lines. Vitest also prints a version, timings and a clock:

```console
$ node_modules/.bin/vitest run agent.test.ts --config vitest.config.mjs
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

**How to read it.** The spec has one block, so vitest ran one test and it passed. With five blocks you would see five tests under the name of the spec. Vitest names each test `block <n>`, then the block id when it has one, then the start of the user message. The spec ran once, when the first test started. Each test then reports its own block.

**If it goes wrong.**

- Vitest cannot find a package, or finds no test: the links of step 1 are missing. Check that `node_modules` and `vitest.config.mjs` sit in the folder you run from.
- One failing test with the name of the file and a list of errors: the spec is not valid. The test lists each error. Fix the key it names, or check the spec with `driftbench spec validate specs`.
- A test is skipped, with a reason that starts `block 0 was not run`: the agent could not take that block. A skipped block is no pass and no failure of the agent.

## 4. Make the test fail and read why

**Why you do this.** A test that cannot fail proves nothing. A second spec asks for a word the agent never says. Vitest then prints the failing block with its evidence.

**You need.** A second spec and a second test file.

```yaml
# file: specs/farewell.yaml
id: vt-farewell
title: The agent is asked for a farewell it does not give
target: { adapter: function, agent: acme-sales }
blocks:
  - user: Thanks, that is all.
    expect:
      must: ['farewell']
```

```ts
// file: farewell.test.ts
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { describeSpec } from '@agent-nexus/driftbench-vitest';
import { respond } from './agent';

describeSpec('specs/farewell.yaml', functionAdapter({ respond, deterministic: true }));
```

**You type.**

```console
$ node_modules/.bin/vitest run farewell.test.ts --config vitest.config.mjs   # exit 1
   ❯ vt-farewell (1)
 FAIL  farewell.test.ts > vt-farewell > block 0: Thanks, that is all.
Error: block 0 failed
  must.0 fail: /farewell/ is missing; closest span "Hell", differs by 5 characters; visible text "Hello from Acme. You said: Thanks, that is all."
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

**How to read it.** The failing test carries the block, the check and its evidence.

- `FAIL  farewell.test.ts > vt-farewell > block 0` names the file, the spec id and the block.
- `must.0` is the check that failed: the first pattern of `must`.
- The evidence says which pattern is missing and shows the text the check read.
- Vitest exits 1, so a build that runs it fails, as with any other failing test.

**If it goes wrong.**

- The test passes: the agent now says `farewell`. Restore the agent text of step 2.
- The failure message shows a check you did not expect: the spec lists more `expect` keys than you think. Read the spec, and the [check reference](../reference/checks.md) for what each key does.

## 5. How this differs from `campaign run`

**Why you do this.** Both run the same specs with the same checks. They suit different jobs, and knowing which to pick saves time.

**Relevant commands.**

- `driftbench campaign run specs/hello.yaml --target function:acme-sales`: runs the same spec with the command line · `--target function:acme-sales` picks the built-in Acme sales assistant as the agent · it prints one line for the spec and a count.

```console
$ driftbench campaign run specs/hello.yaml --target function:acme-sales
✓ vt-hello · function:acme-sales · F · repeat 0  pass  1 block
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.** The same file passes on a different agent. The line is one verdict for the whole spec. The vitest run gave one verdict per block.

| | `describeSpec` in vitest | `campaign run` |
|---|---|---|
| Where it runs | inside your own test suite, next to your other tests | as its own command, alone or in CI |
| The agent | an adapter you build in code, so any function or object | a target named on the command line |
| One run holds | one spec, one agent, one run | many specs, targets, modes and repeats |
| The report | one vitest test per block, with the evidence of a failure | one line per cell, a stored campaign, a scorecard and statistics |
| Judges | the machine checks, unless you pass checks built with a judge council | machine checks and judges, with `--judge` |
| Use it for | a fast pass or fail on every commit | a measured rate, a comparison between two versions |

Use vitest when you want the spec to fail the build like any unit test. Use `campaign run` when you want rates with an interval, repeats or a scorecard.

**If it goes wrong.**

- `No adapter is set up for` and a target: the target in the spec or on the command line does not exist. Use `function:acme-sales`, or load a plugin as the [plugins](plugins.md) page shows.

## Where to go next

- The [vitest reference](../vitest.md) lists the options of `describeSpec` and the case of a block that was not run.
- The [Python](python.md) page does the same from pytest.
- The [quickstart](quickstart.md) runs specs with `campaign run` and writes a scorecard.
