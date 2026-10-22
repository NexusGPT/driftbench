# Adapters for SDKs

This is a hands-on guide to the eight adapters for agents built with an SDK or a framework. Each section says what the adapter wraps, what you install and the few lines that hand your agent to driftbench. It then runs the adapter on a stand-in for the vendor's object. The vendor's package is third-party software, and a real run calls a paid model, so our tests run neither. Every command below is run by a test on GitHub, and every output shown is what the command printed. The adapter pages in the [adapters index](../adapters/index.md) hold every option, and [running](../running.md) holds the run options.

## Before you start

**Why you do this.** An agent built with an SDK is an object in your code. It is a client, a runner or a graph. driftbench cannot start it from the command line. An SDK adapter takes that object and calls it as your code would.

**You need.**

- Node 22 or newer, and driftbench installed from a clone, as the [guide index](index.md#install) shows. That gives you the command `driftbench`. Run this page from the root of the clone.
- The vendor's package and a key from the vendor, for a real run. This page shows each install line and does not run it.

**Five words first.**

- An **adapter** connects driftbench to one kind of agent. See [Connect your agent](connect-adapters.md).
- A **stand-in** is a small object written on this page. It has the same call shape as the vendor's object and returns a fixed answer. It calls no model.
- A **spec** is a test file. It holds the messages a user sends and what the agent must answer.
- A **block** is one exchange of a spec.
- A **side effect** is a tool call that changes the world, such as placing an order. You list those tools in `sideEffects`, so a spec can check them at the end.

**Which adapter fits my agent?**

| Your agent is built with | Adapter | You hand over | Install (not run by our tests) | Run on this page |
|---|---|---|---|---|
| The Anthropic Messages API | `anthropic` | the client | `npm install @anthropic-ai/sdk@0.133.0` | a stand-in client |
| The OpenAI Agents SDK | `openai-agents` | a runner and an agent | `npm install @openai/agents@0.20.0` | a stand-in runner |
| The Gemini API | `google` | the client | `npm install @google/genai@2.28.0` | a stand-in client |
| The Vercel AI SDK | `vercel-ai` | its `generateText` and a model | `npm install ai@7.0.137` | a stand-in `generateText` |
| Pydantic AI | `pydantic-ai` | the agent's name in a Python module | `pip install pydantic-ai==2.55.0` | a stand-in for the Python process |
| LangGraph | `langgraph` | the compiled graph | `npm install @langchain/langgraph@1.4.21` | a stand-in graph |
| CrewAI | `crewai` | the crew's name in a Python module | `pip install crewai==1.15.27` | a stand-in for the Python process |
| A model behind a LiteLLM proxy | `litellm` | an OpenAI-compatible client | `npm install openai@7.32.0` | a stand-in client |

The versions are the ones the adapter pages name as the versions each adapter was proven against.

## 1. Write one spec and one script

**Why you do this.** The eight sections share one test and one small script. Only the adapter changes from one section to the next.

**You need.** Two files. The first is the spec, `hello.yaml`. It has one block. The agent must name Acme in its answer:

```yaml
# file: hello.yaml
id: sdk-hello
title: The agent greets a customer
blocks:
  - user: Hi, who am I talking to?
    expect:
      must: ['Acme']
```

The second file is `drive.ts`. It runs the spec once on any adapter and prints one line per block. A line holds the verdict, the reply and the tokens the adapter read. If the run itself fails, the script prints the status and the error first:

```ts
// file: drive.ts
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { type AgentAdapter, blockStatus, loadSpecFile, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';

/** Runs hello.yaml once on the adapter and prints one line per block. */
export async function drive(adapter: AgentAdapter): Promise<void> {
  const loaded = await loadSpecFile('hello.yaml');
  if (!loaded.ok) throw new Error('the spec is invalid');
  const run = await runSpec(loaded.spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: defaultChecks(),
    mode: 'F',
    repeat: 0,
  });
  if (run.status !== 'completed') console.log(`${run.status}: ${run.error}`);
  for (const block of run.blocks) {
    const cost = block.observed?.cost;
    console.log(`${blockStatus(block)} · ${block.observed?.text} · ${cost?.inputTokens} in, ${cost?.outputTokens} out`);
  }
}
```

**How to read it.**

- `runSpec` runs the spec once on the adapter. `mode: 'F'` lets the agent carry its own earlier replies. [Running](../running.md#runspec) lists the other options.
- `defaultChecks()` are the machine checks. The `must` list of the spec is one of them.
- Each section below ends with `drive(adapter)`. The adapter is the only part that changes.

## 2. Anthropic

**What it wraps.** An agent built on the Anthropic Messages API: a model, a system prompt and tools. The adapter calls `client.messages.create` and closes the tool loop itself.

**Your code (not run by our tests).** The install line is in the table above. This is the whole file, with a real client. It reads `ANTHROPIC_API_KEY` from the environment:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { anthropicAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const adapter = anthropicAdapter({
  client: new Anthropic(),
  model: 'claude-haiku-5-5',
  system: 'You are the Acme sales assistant.',
});
void drive(adapter);
```

**Run it offline.** The adapter calls nothing but `client.messages.create`. This script gives it a stand-in client with that one method:

```ts
// file: anthropic-run.ts
import { anthropicAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const client = {
  messages: {
    create: async () => ({
      content: [{ type: 'text', text: 'Hello, this is the Acme sales assistant.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 9 },
    }),
  },
};
void drive(anthropicAdapter({ client, model: 'claude-haiku-5-5', system: 'You are the Acme sales assistant.' }));
```

**Relevant commands.**

- `npx tsx anthropic-run.ts`: runs the script · `anthropic-run.ts` is the file above. The guide test runs it with the driftbench packages of this clone standing in for the ones you install · it prints one line per block.

**You type and you see.**

```console
$ npx tsx anthropic-run.ts
pass · Hello, this is the Acme sales assistant. · 12 in, 9 out
```

**How to read it.** `pass` means the reply holds `Acme`. `12 in, 9 out` are the tokens the stand-in reported in `usage`. With the real client, the first run prints the same line shape with the model's own text and tokens. We did not run that, because it calls a model.

## 3. OpenAI Agents

**What it wraps.** An agent built with the OpenAI Agents SDK. The adapter calls `runner.run(agent, items, options)`. The SDK runs the model, the tools and the handoffs.

**Your code (not run by our tests).** The real runner and a real agent. The SDK reads `OPENAI_API_KEY` from the environment:

```ts
import { Agent, Runner } from '@openai/agents';
import { openaiAgentsAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const agent = new Agent({ name: 'Acme sales', instructions: 'You are the Acme sales assistant.' });
void drive(openaiAgentsAdapter({ runner: new Runner(), agent }));
```

**Run it offline.** The stand-in runner returns the list of items a real run adds, here one message from the agent:

```ts
// file: openai-agents-run.ts
import { openaiAgentsAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const message = {
  type: 'message_output_item',
  rawItem: { content: [{ type: 'output_text', text: 'Hello, this is the Acme sales assistant.' }] },
};
const runner = {
  run: async () => ({
    newItems: [message],
    rawResponses: [{ usage: { inputTokens: 12, outputTokens: 9 } }],
  }),
};
void drive(openaiAgentsAdapter({ runner, agent: { name: 'Acme sales' } }));
```

**Relevant commands.**

- `npx tsx openai-agents-run.ts`: runs the script above · it prints one line per block.

**You type and you see.**

```console
$ npx tsx openai-agents-run.ts
pass · Hello, this is the Acme sales assistant. · 12 in, 9 out
```

**How to read it.** The adapter reads the items the run added. A message item becomes the reply, and the token counts of the model responses become the cost. An input or output check of the SDK can stop the run. It shows up as a guard with the verdict `block`, and the run does not fail. A tool call the SDK runs itself cannot be forced by a spec: a block that forces a tool result is `not_run` on this adapter.

## 4. Google Gemini

**What it wraps.** An agent built on the Gemini API: a model, a system instruction and function declarations. The adapter calls `client.models.generateContent` and closes the tool loop itself.

**Your code (not run by our tests).** The real client, with the key in `GEMINI_API_KEY`:

```ts
import { GoogleGenAI } from '@google/genai';
import { googleAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const adapter = googleAdapter({
  client: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
  model: 'gemini-3-pro',
  system: 'You are the Acme sales assistant.',
});
void drive(adapter);
```

**Run it offline.** The stand-in client has the one method the adapter calls:

```ts
// file: google-run.ts
import { googleAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const client = {
  models: {
    generateContent: async () => ({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'Hello, this is the Acme sales assistant.' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 9 },
    }),
  },
};
void drive(googleAdapter({ client, model: 'gemini-3-pro', system: 'You are the Acme sales assistant.' }));
```

**Relevant commands.**

- `npx tsx google-run.ts`: runs the script above · it prints one line per block.

**You type and you see.**

```console
$ npx tsx google-run.ts
pass · Hello, this is the Acme sales assistant. · 12 in, 9 out
```

**How to read it.** `promptTokenCount` is read as the input tokens, and `candidatesTokenCount` as the output tokens. A thought part adds no text to the reply. A Gemini 3 function call that comes back with a signature keeps it within the block, as the API requires.

## 5. Vercel AI SDK

**What it wraps.** An agent run by the `generateText` function of the Vercel AI SDK. You hand the adapter `generateText` and your model, and it calls `generateText` once for each block.

**Your code (not run by our tests).** The real function and a real model. The model package reads `OPENAI_API_KEY`:

```ts
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { vercelAiAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const adapter = vercelAiAdapter({
  generateText,
  model: openai('gpt-5'),
  system: 'You are the Acme sales assistant.',
});
void drive(adapter);
```

**Run it offline.** The stand-in `generateText` returns the steps of a finished run. Here there is one step with one text part:

```ts
// file: vercel-ai-run.ts
import { vercelAiAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const step = {
  content: [{ type: 'text', text: 'Hello, this is the Acme sales assistant.' }],
  finishReason: 'stop',
  usage: { inputTokens: 12, outputTokens: 9 },
};
const generateText = async () => ({ steps: [step] });
void drive(vercelAiAdapter({ generateText, model: {}, system: 'You are the Acme sales assistant.' }));
```

**Relevant commands.**

- `npx tsx vercel-ai-run.ts`: runs the script above · it prints one line per block.

**You type and you see.**

```console
$ npx tsx vercel-ai-run.ts
pass · Hello, this is the Acme sales assistant. · 12 in, 9 out
```

**How to read it.** The adapter reads the `steps` of the result. Each text part becomes reply text, each tool call and tool result become a tool call, and each step's usage becomes tokens. The adapter wraps your tools so a spec can force a tool result. Your own tool objects stay as they are.

## 6. Pydantic AI

**What it wraps.** A Pydantic AI agent in a Python process. The adapter starts one process for each block, through a bridge script that ships with the adapter. Python and `pydantic-ai` are yours to install.

**Your code (not run by our tests).** First the Python file that defines the agent, `acme/agents.py`:

```python
from pydantic_ai import Agent

sales = Agent('anthropic:claude-haiku-5-5', instructions='You are the Acme sales assistant.')
```

Then the TypeScript that hands it over. `agent` is `<module>:<name>`, and `cwd` is the folder where the module can be imported:

```ts
import { pydanticAiAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const adapter = pydanticAiAdapter({ agent: 'acme.agents:sales', python: '.venv/bin/python', cwd: '/srv/acme' });
void drive(adapter);
```

**Run it offline.** The option `exec` runs the process. The default starts Python. This script gives it a stand-in that prints the one line the bridge prints, `driftbench-result` and the new messages as JSON. It starts no Python:

```ts
// file: pydantic-ai-run.ts
import { pydanticAiAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const messages = [
  {
    kind: 'response',
    parts: [{ part_kind: 'text', content: 'Hello, this is the Acme sales assistant.' }],
    usage: { input_tokens: 12, output_tokens: 9 },
  },
];
const exec = async () => ({ stdout: `driftbench-result ${JSON.stringify(messages)}\n`, stderr: '', exitCode: 0 });
void drive(pydanticAiAdapter({ agent: 'acme.agents:sales', exec }));
```

**Relevant commands.**

- `npx tsx pydantic-ai-run.ts`: runs the script above · it prints one line per block.

**You type and you see.**

```console
$ npx tsx pydantic-ai-run.ts
pass · Hello, this is the Acme sales assistant. · 12 in, 9 out
```

**How to read it.** The bridge sends the block's text and the earlier turns in Pydantic AI's own format. It runs the agent once and prints the new messages. The adapter reads text parts, tool calls and tool returns from them. The agent runs its own tools, so a spec cannot force a tool result on this adapter. This page did not run the bridge on the real package, because that needs Python and `pydantic-ai`.

## 7. LangGraph

**What it wraps.** A compiled LangGraph graph whose state holds a list named `messages`. The adapter calls `graph.invoke`, with or without a checkpointer.

**Your code (not run by our tests).** The compiled graph. `workflow` is your own `StateGraph(MessagesAnnotation)` with its tool node:

```ts
import { MemorySaver } from '@langchain/langgraph';
import { langgraphAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';
import { workflow } from './agent';

const graph = workflow.compile({ checkpointer: new MemorySaver() });
void drive(langgraphAdapter({ graph }));
```

**Run it offline.** The stand-in graph has an `invoke` method. It returns the messages it received, plus one answer from the assistant:

```ts
// file: langgraph-run.ts
import { langgraphAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const answer = {
  role: 'assistant',
  content: 'Hello, this is the Acme sales assistant.',
  usage_metadata: { input_tokens: 12, output_tokens: 9 },
};
const graph = {
  invoke: async (input: { messages: unknown[] }) => ({ messages: [...input.messages, answer] }),
};
void drive(langgraphAdapter({ graph }));
```

**Relevant commands.**

- `npx tsx langgraph-run.ts`: runs the script above · it prints one line per block.

**You type and you see.**

```console
$ npx tsx langgraph-run.ts
pass · Hello, this is the Acme sales assistant. · 12 in, 9 out
```

**How to read it.** The turn of a block is what the returned `messages` hold after the last user message. A graph compiled without a checkpointer gets the whole history at every block. A graph with one keeps the conversation itself and gets only the new user messages. The graph runs its own tools, so a spec cannot force a tool result on this adapter.

## 8. CrewAI

**What it wraps.** A CrewAI crew in a Python process, or a crew deployed on CrewAI AMP over HTTP. A crew runs tasks, so a conversation reaches it through its inputs. This page uses the process interface. Python and `crewai` are yours to install.

**Your code (not run by our tests).** First the Python file that builds the crew, `acme/crews.py`. The text `{message}` is filled with the user's message:

```python
from crewai import Agent, Crew, Task


def build_sales():
    agent = Agent(role='Acme sales', goal='Answer Acme customers', backstory='You sell phone plans for Acme.')
    task = Task(description='Reply to this message: {message}', expected_output='A short reply', agent=agent)
    return Crew(agents=[agent], tasks=[task])
```

Then the TypeScript that hands it over. `crew` is `<module>:<name>`:

```ts
import { crewaiAdapter, crewaiProcess } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const transport = crewaiProcess({ crew: 'acme.crews:build_sales', python: '.venv/bin/python', cwd: '/srv/acme' });
void drive(crewaiAdapter({ transport }));
```

**Run it offline.** As on the Pydantic AI section, the stand-in `exec` prints the line the bridge prints. It holds the crew's final output, each task's output, the tools used and the token counts:

```ts
// file: crewai-run.ts
import { crewaiAdapter, crewaiProcess } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const reply = {
  raw: 'Hello, this is the Acme sales assistant.',
  tasks: [{ name: 'answer', agent: 'Acme sales', raw: 'Hello, this is the Acme sales assistant.' }],
  tools: [],
  usage: { prompt_tokens: 12, completion_tokens: 9 },
};
const exec = async () => ({ stdout: `driftbench-result ${JSON.stringify(reply)}\n`, stderr: '', exitCode: 0 });
void drive(crewaiAdapter({ transport: crewaiProcess({ crew: 'acme.crews:build_sales', exec }) }));
```

**Relevant commands.**

- `npx tsx crewai-run.ts`: runs the script above · it prints one line per block.

**You type and you see.**

```console
$ npx tsx crewai-run.ts
pass · Hello, this is the Acme sales assistant. · 12 in, 9 out
```

**How to read it.** The reply is the crew's final output. Each task's name is a stage, so a spec can check the order of the tasks. The default inputs are `message`, `history` and `messages`, all strings. A deployed crew reports outputs only, with no tool calls. This page did not run the bridge on the real package, because that needs Python and `crewai`.

## 9. LiteLLM

**What it wraps.** A model behind a LiteLLM proxy, or any endpoint that speaks the OpenAI chat completions shape. The adapter calls `client.chat.completions.create` and closes the tool loop itself.

**Your code (not run by our tests).** The `openai` client pointed at the proxy:

```ts
import OpenAI from 'openai';
import { litellmAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const client = new OpenAI({ baseURL: 'http://localhost:4000', apiKey: process.env.LITELLM_API_KEY });
void drive(litellmAdapter({ client, model: 'anthropic/claude-haiku-5-5', system: 'You are the Acme sales assistant.' }));
```

The command line reaches the same adapter with no code: a spec whose target is `litellm:<model>` gives `base_url` in `target.options`. See [targets from settings](../running.md#targets-from-settings).

**Run it offline.** The stand-in client has the one method the adapter calls:

```ts
// file: litellm-run.ts
import { litellmAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const completion = {
  choices: [{ message: { role: 'assistant', content: 'Hello, this is the Acme sales assistant.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 9 },
};
const client = { chat: { completions: { create: async () => completion } } };
void drive(litellmAdapter({ client, model: 'acme-sales' }));
```

**Relevant commands.**

- `npx tsx litellm-run.ts`: runs the script above · it prints one line per block.

**You type and you see.**

```console
$ npx tsx litellm-run.ts
pass · Hello, this is the Acme sales assistant. · 12 in, 9 out
```

**How to read it.** `prompt_tokens` and `completion_tokens` are the input and output tokens. The proxy may route to another deployment than the one you named. The adapter keeps the model each answer names in `raw.models`.

## 10. When the vendor refuses the call

**Why you do this.** A wrong key or a quota limit is the most common first failure with a real SDK. The stand-in below plays a vendor that answers with status 401, so you see how driftbench reports it without a real key.

**You need.** A stand-in client whose method throws an error with a status:

```ts
// file: refused-run.ts
import { anthropicAdapter } from '@agent-nexus/driftbench-adapters';
import { drive } from './drive';

const client = {
  messages: {
    create: async () => {
      throw Object.assign(new Error('401 invalid x-api-key'), { status: 401 });
    },
  },
};
void drive(anthropicAdapter({ client, model: 'claude-haiku-5-5' }));
```

**Relevant commands.**

- `npx tsx refused-run.ts`: runs the script above · it prints the run status and the error, and no block line.

**You type and you see.**

```console
$ npx tsx refused-run.ts
failed: send on block 0 failed: AgentFailure: messages.create (claude-haiku-5-5) on block 0: 401 invalid x-api-key
```

**How to read it.**

- The run is `failed`, and no block ran a check. The agent never answered.
- A status 401 is an `AgentFailure`: the vendor refused the call, and a retry would change nothing. driftbench fails the run at once.
- A status 408, a 429, a 5xx or a network error is an `AdapterTransportError`. driftbench retries it under the shared policy. Then it fails the run. The [retries](../retries.md) page lists the policy.

**If it goes wrong.**

- `Cannot find package '@agent-nexus/driftbench-adapters'` when you run a script: run it in a clone of this repository, where the guide test runs it. Or install the package in the folder.
- `Cannot find module '@anthropic-ai/sdk'` in your own code: run the install line of the section in the folder of your project.
- A block says `not_run`, and the command `ci` exits 3. The spec forces a tool result, or starts from a history, and the adapter cannot do that. The capability table in the [adapters index](../adapters/index.md#capabilities) lists what each adapter supports.
- A real run fails with a 401 or a 403: the key is missing, wrong or out of quota. Fix the key in the environment of the process that runs the script.

## Where to go next

- [Connect your agent](connect-adapters.md) connects a function, a web endpoint and a command.
- [Claude Code and Nexus agents](claude-code-and-nexus.md) connects a Claude Code folder and an agent on the Nexus platform.
- Each adapter page has its options, its end-state sources and its errors: [anthropic](../adapters/anthropic.md), [openai-agents](../adapters/openai-agents.md), [google](../adapters/google.md), [vercel-ai](../adapters/vercel-ai.md), [pydantic-ai](../adapters/pydantic-ai.md), [langgraph](../adapters/langgraph.md), [crewai](../adapters/crewai.md) and [litellm](../adapters/litellm.md).
