# Connect your agent

This is a hands-on guide to adapters, the pieces that connect driftbench to your agent. It starts with a table that picks the adapter for you. Then it connects three kinds of agent that run on your own machine: a function, a web endpoint and a command. For each one you write a tiny agent, a test and a run. No step calls a model and nothing is paid for. Every command below is run by a test on GitHub, and every output shown is what the command printed. The full adapter pages are in the [adapters index](../adapters/index.md), and the run options are in [running](../running.md).

## Before you start

**Why you do this.** driftbench never calls your agent directly. It sends the user's message to an **adapter**, and the adapter passes it on to your agent and reads the answer. One adapter exists for each way of reaching an agent.

**You need.**

- Node 22.13 or newer, and driftbench installed from a clone, as the [guide index](index.md#install) shows. That gives you the command `driftbench`. Run this page from the root of the clone.
- An agent you can reach in one of the ways in the table below. The three agents on this page are written for you.

**Four words first.**

- An **adapter** is the piece that connects driftbench to one kind of agent. Example: the `http` adapter posts the conversation to a web address.
- A **target** says which agent a test runs on, written `<adapter>` or `<adapter>:<agent>`. Example: `http:hours-bot`.
- A **spec** is a test file. It holds the messages a user sends and what the agent must answer.
- A **block** is one exchange of a spec: one user message, and the checks on the reply.

## Pick an adapter

**Why you do this.** The adapter decides how driftbench reaches your agent. A wrong choice shows up as a connection error, so pick first.

**You need.** To know how your agent is started. Find yours in this table:

| Your agent is | Adapter | How you connect it | Shown on |
|---|---|---|---|
| A function in your own code | `function` | From code. The command line reaches only the Acme example, as `function:acme`. | Step 1 below |
| A web endpoint that speaks JSON | `http` | `--target http:<name>`, with the address in the spec | Step 2 below |
| A command that reads the message on standard input and prints the answer | `process` | `--target process:<name> --process-command ...` | Step 3 below |
| A model behind a LiteLLM proxy or an OpenAI-compatible endpoint | `litellm` | `--target litellm:<model>`, with the address in the spec | [Adapters for SDKs](sdk-adapters.md) |
| An object built with an SDK: Anthropic, OpenAI Agents, Gemini, Vercel AI, Pydantic AI, LangGraph or CrewAI | the SDK adapters | From code: you hand over your client or your graph | [Adapters for SDKs](sdk-adapters.md) |
| A Claude Code folder | `claude-code` | `estate run --runtime claude-code` | [Claude Code and Nexus agents](claude-code-and-nexus.md) |
| An agent on the Nexus platform | `nexus` | `--target nexus:<agent id>`, with `NEXUS_API_KEY` set | [Claude Code and Nexus agents](claude-code-and-nexus.md) |

**How to read it.**

- Three of the adapters run offline, with no key and no model: `function`, `http` against a server on your machine, and `process`. This page runs those three.
- A row that says "From code" has no command-line target of its own. You write a small script, as step 1 does, or load the adapter into the command line with a [plugin](../plugins.md).
- Each adapter has a page in the [adapters index](../adapters/index.md) that lists every option.

## 1. Connect a function

**Why you do this.** A function is the quickest agent to connect. There is no server and no install. driftbench calls it in the same process.

**You need.** Two files. The first is the agent, `agent.ts`. It is a plain function. It receives the conversation and returns what it observed: segments, the text, the tool calls, a cost and a latency.

```ts
// file: agent.ts
// The agent: a plain function. It receives the conversation and returns what it observed.
export function respond(messages: { role: string; content?: string | null }[]) {
  const last = messages.at(-1)?.content ?? '';
  const text = /open|hours/i.test(last)
    ? 'Acme Shop is open 9:00 to 17:00, Monday to Saturday.'
    : 'Sorry, I can only answer questions about opening hours.';
  return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: {}, latencyMs: 0 };
}
```

The second file is the spec, `hours.yaml`. It has two blocks. In block 0 the agent must answer. In block 1 the agent must stay on its topic:

```yaml
# file: hours.yaml
id: shop-hours
title: A customer asks when the shop opens
blocks:
  - user: When are you open?
    expect:
      must: ['9:00 to 17:00']
  - user: Can you recommend a good restaurant?
    expect:
      must: ['only answer questions about opening hours']
      must_not: ['restaurant is']
```

A third file runs the spec on the function. It loads the spec, hands the function to the `function` adapter and runs it once. The script is the same shape for every adapter of this page:

```ts
// file: run-function.ts
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { blockStatus, loadSpecFile, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { respond } from './agent';

async function main(): Promise<void> {
  const loaded = await loadSpecFile('hours.yaml');
  if (!loaded.ok) throw new Error('the spec is invalid');
  const run = await runSpec(loaded.spec, {
    adapter: functionAdapter({ respond, deterministic: true }),
    driver: createScriptedDriver(),
    checks: defaultChecks(),
    mode: 'F',
    repeat: 0,
  });
  for (const block of run.blocks) console.log(`block ${block.index}: ${blockStatus(block)}`);
}

void main();
```

**Relevant commands.**

- `npx tsx run-function.ts`: runs the script · `run-function.ts` is the file above. The guide test runs it with the driftbench packages of this clone standing in for the ones you install · it prints one line per block.
- `driftbench campaign run`: runs the tests of a folder or file on a target · `examples/acme/specs/conversations/plan-upgrade.yaml` is the spec. `--target function:acme` is the Acme sales assistant, the one function agent the command line knows. `--campaign fn-1` names the campaign · it prints one verdict line per cell and a count.

**You type and you see.**

```console
$ npx tsx run-function.ts
block 0: pass
block 1: pass
```

The command line reaches the Acme function by name. This is the same adapter, run by the command that the rest of this guide uses:

```console
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --campaign fn-1
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `pass` means every check of the block held. Block 1 passed because the reply holds the refusal sentence and does not recommend a restaurant.
- The script builds the adapter with `functionAdapter({ respond })`. `respond` is your function. `deterministic: true` tells driftbench that the same input gives the same output, which lets it replay answers from its cache.
- `5 blocks` in the second command is the five exchanges of the Acme spec. `Spent $0.00` is right: a function calls no model.

**If it goes wrong.**

- `Cannot find package '@agent-nexus/driftbench-adapters'` when you run the script: run it in a clone of this repository, where the guide test runs it. Or install the package in the folder.
- `the spec is invalid`: the script stops. Run `driftbench spec validate hours.yaml` to read the problem.
- A function that throws: driftbench reports the block as `failed` with the error text. The run does not continue, and no check runs on that block.

## 2. Connect a web endpoint

**Why you do this.** Many agents already sit behind a web address. The `http` adapter posts the conversation to that address and reads the reply. The command line needs no code, only the address in the spec.

**You need.** Two files. The first is a small server that stands in for your agent, `server.mjs`. Each request is one block. The server answers with a chat completion, the format that OpenAI-compatible services use:

```js
// file: server.mjs
// A stand-in agent behind a web address. One POST is one block.
import { createServer } from 'node:http';

const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    const { messages = [] } = JSON.parse(body || '{}');
    const last = messages.filter((message) => message.role === 'user').at(-1)?.content ?? '';
    const content = /open|hours/i.test(last)
      ? 'Acme Shop is open 9:00 to 17:00, Monday to Saturday.'
      : 'Sorry, I can only answer questions about opening hours.';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
});

server.listen(18731, '127.0.0.1', () => {
  console.log('The hours bot listens on http://127.0.0.1:18731/turn');
});
```

The second file is the spec, `hours-http.yaml`. The target names the `http` adapter, and `options.url` holds the address. A real address often needs a key. The key never goes in a spec. The spec names the environment variable that holds it, under `headers_env`:

```yaml
# file: hours-http.yaml
id: shop-hours-http
title: A customer asks when the shop opens, over HTTP
target:
  adapter: http
  agent: hours-bot
  options:
    url: http://127.0.0.1:18731/turn
blocks:
  - user: When are you open?
    expect:
      must: ['9:00 to 17:00']
  - user: Can you recommend a good restaurant?
    expect:
      must: ['only answer questions about opening hours']
```

**Relevant commands.**

- `node server.mjs > server.log 2>&1 & echo $! > server.pid`: starts the server in the background · `> server.log 2>&1` writes everything it prints to `server.log`. `&` returns the prompt at once. `echo $! > server.pid` saves the process number so you can stop it later · it prints nothing.
- `until grep -q listens server.log; do sleep 0.2; done`: waits until the server has printed its line · it prints nothing. `cat server.log` then shows the line.
- `driftbench campaign run`: runs the spec · `hours-http.yaml` is the spec. `--campaign http-1` names the campaign · it prints one verdict line per cell and a count. The target comes from the spec, so no `--target` is needed.
- `kill "$(cat server.pid)"`: stops the server by its saved process number · it prints nothing.

**You type and you see.**

```console
$ node server.mjs > server.log 2>&1 & echo $! > server.pid
$ until grep -q listens server.log; do sleep 0.2; done
$ cat server.log
The hours bot listens on http://127.0.0.1:18731/turn
$ driftbench campaign run hours-http.yaml --campaign http-1
✓ shop-hours-http · http:hours-bot · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- The target `http:hours-bot` comes from the spec. `hours-bot` becomes the field `model` in the request, for an endpoint that picks an agent by name.
- Each block is one `POST` with the whole conversation so far. The endpoint answers with a chat completion, or with an observation. Both shapes are listed on the [http adapter](../adapters/http.md) page.
- `Spent $0.00` is right here. The adapter reports a cost only when the endpoint reports one.

Now stop the server and run the same spec again. This shows what a broken connection looks like:

```console
$ kill "$(cat server.pid)"
$ driftbench campaign run hours-http.yaml --campaign http-2 --retry-attempts 2 --retry-base-ms 20 --retry-max-ms 100   # exit 1
! shop-hours-http · http:hours-bot · F · repeat 0  failed  send on block 0 failed after 2 attempts: AdapterTransportError: 127.0.0.1:18731 transport failed: request or response transport failed; body length unknown
1 cell: 0 pass, 0 fail, 1 failed. Spent $0.00.
```

- `failed` is not `fail`. The agent never answered, so no check ran. driftbench tried twice, because `--retry-attempts 2` allows two tries.
- The message names the host and the port, and hides the rest. Error bodies and headers stay out of the output, so a key cannot leak through an error.

**If it goes wrong.**

- `No adapter is set up for http:hours-bot. An http target needs its URL: set target.options.url in the spec, or DRIFTBENCH_HTTP_URL.` (exit 2): the spec gives no address. Add `options.url`, or export `DRIFTBENCH_HTTP_URL`.
- `failed` with `AdapterTransportError`: nothing listens at the address. Start the server, then run again.
- A `fail` with a `must` check: the server answered with other text. Read the reply with `driftbench campaign status`, as the [campaigns](campaigns.md) page shows.

## 3. Connect a command

**Why you do this.** Many agents are programs: a script in Python, Node or any language. The `process` adapter starts your command once for each block, sends it the user's message on standard input and reads the answer from standard output.

**You need.** Two files. The first is the agent, `agent.mjs`. It reads the message on standard input and prints one reply:

```js
// file: agent.mjs
// A stand-in for your command: it reads the user message on stdin and prints the reply.
import { readFileSync } from 'node:fs';

const message = readFileSync(0, 'utf8').trim();

if (/open|hours/i.test(message)) {
  console.log('Acme Shop is open 9:00 to 17:00, Monday to Saturday.');
} else {
  console.log('Sorry, I can only answer questions about opening hours.');
}
```

The second file is the spec, `hours-process.yaml`. The target names the `process` adapter and a name for the agent:

```yaml
# file: hours-process.yaml
id: shop-hours-process
title: A customer asks when the shop opens, from a command
target: { adapter: process, agent: hours-agent }
blocks:
  - user: When are you open?
    expect:
      must: ['9:00 to 17:00']
  - user: Can you recommend a good restaurant?
    expect:
      must: ['only answer questions about opening hours']
```

**Relevant commands.**

- `driftbench campaign run`: runs the spec · `hours-process.yaml` is the spec. `--target process:hours-agent` says which agent to use. `--process-command` is a JSON list, the program and its arguments, that starts your agent. `$PWD` is the current folder. The command runs in a temporary folder, so it needs the full path of the script. `--campaign` names the campaign · it prints one verdict line per cell and a count.
- `sed 's/9:00 to 17:00/10:00 to 18:00/' agent.mjs > broken-agent.mjs`: copies the agent and changes the opening hours, so you can see a failure · `s/old/new/` is the change and `>` writes the copy · it produces `broken-agent.mjs`.

**You type and you see.**

```console
$ driftbench campaign run hours-process.yaml --target process:hours-agent --process-command "[\"node\",\"$PWD/agent.mjs\"]" --campaign proc-1
✓ shop-hours-process · process:hours-agent · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

Now break the agent on purpose. A test that cannot fail proves nothing:

```console
$ sed 's/9:00 to 17:00/10:00 to 18:00/' agent.mjs > broken-agent.mjs
$ driftbench campaign run hours-process.yaml --target process:hours-agent --process-command "[\"node\",\"$PWD/broken-agent.mjs\"]" --campaign proc-2   # exit 1
✗ shop-hours-process · process:hours-agent · F · repeat 0  fail  block 0 must.0
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- The adapter starts the command once for each block, in a fresh temporary folder, with the message on standard input. The reply is the text the command prints.
- `fail  block 0 must.0` names the block, counting from 0, and the check. `must.0` is the first entry of the `must` list: `9:00 to 17:00`. The broken agent printed other hours, so the check failed.
- A failing run exits 1, so a script or a CI job can stop on it.
- The same adapter runs code agents that write files. It also reads the history of the conversation from a file. The [process adapter](../adapters/process.md) page lists both.

**If it goes wrong.**

- `No adapter is set up for process:hours-agent, the target of shop-hours-process.` (exit 2): the command line does not know the agent. Add `--process-command`, as above.
- Every block fails on `must.0`, with no other message: the command did not start. The command runs in a temporary folder, so `agent.mjs` is not found there. Give the full path, as `$PWD/agent.mjs` does.
- A block fails and the output looks right: the check reads the text the command prints. Anything it writes to standard error does not count.

## Where to go next

- [Adapters for SDKs](sdk-adapters.md) connects an object built with an SDK, from code.
- [Claude Code and Nexus agents](claude-code-and-nexus.md) connects a Claude Code folder and an agent on the Nexus platform.
- [Run your agent](run-your-agent.md) runs the same tests in three modes, repeats them and plays a simulated user.
- The [adapters index](../adapters/index.md) lists every adapter, its options and the capabilities each one declares.
