# anthropic adapter

Status: shipped, release phase. It passes the [contract suite](index.md#the-contract-suite) in chat mode, on a fake client that plays the Acme example agent, and on the real `@anthropic-ai/sdk` client driven through a fake `fetch`. It has not run against a live model yet.

The anthropic adapter runs an agent built on the Anthropic Messages API: a model, a system prompt and tools. The SDK is not a dependency of driftbench: the adapter takes your client and types it with a local interface that mirrors `client.messages.create`. `@anthropic-ai/sdk` is an optional peer dependency of `@agent-nexus/driftbench-adapters`; the shapes match version 0.133.0.

## Options

```ts
import Anthropic from '@anthropic-ai/sdk';
import { anthropicAdapter } from '@agent-nexus/driftbench-adapters';
import { salesPrompt, salesTools } from './agent'; // your prompt, and a function that returns SdkTool[]

const adapter = anthropicAdapter({
  client: new Anthropic(), // reads ANTHROPIC_API_KEY from the environment
  model: 'claude-sonnet-5-5',
  system: salesPrompt,
  tools: (given) => salesTools(), // a fresh store for each conversation
  sideEffects: ['order.create'],
});
```

| Option | Meaning |
|---|---|
| `client` | the client. The adapter calls `client.messages.create(body, { maxRetries: 0 })` and nothing else. |
| `model` | the model id |
| `system` | the system prompt. System messages in the history are appended to it. |
| `maxTokens` | `max_tokens` of each call. Default 1024. |
| `tools` | the agent's tools, or a factory called once per session with its resolved Given |
| `maxSteps` | the most model calls one block may take. Default 8. A block's `budget.steps` lowers it. A block still asking for tools at the cap fails. |
| `sideEffects` | the spec labels of the tools that change the world. It enables `endState`. |
| `deterministic` | true when the same input gives the same output. Default false. |
| `version` | the version the runner's cache key carries. Default the adapter's version with a hash of the model and the system prompt. |
| `retry`, `sleep` | the adapter's own [retry settings](../retries.md), under the spec target's `retry` and the run's, and how a wait is spent (tests). Each model call runs under the policy, with the client's own retries off (`maxRetries: 0`). |

A tool is an `SdkTool`:

| Field | Meaning |
|---|---|
| `name` | the spec label, such as `coverage.check` |
| `description` | what the model reads about the tool |
| `inputSchema` | the JSON Schema of the input. Default an object. |
| `run(input, context)` | your implementation. It receives a copy of the input and `{ sessionId, blockIndex, world, vars }`. A throw is the tool's error, with the thrown message. |

## The agent loop

The Messages API answers with a tool request and stops, so the adapter closes the loop.

1. It sends the session history, the system prompt and the tools.
2. While the answer holds `tool_use` blocks, it answers each call: a forced result or error from the block's `world.tools` first, else the tool's own `run`. A call that neither answers fails the block.
3. It sends the `tool_result` blocks back and calls the model again. A `pause_turn` stop resumes the same way, with no tool result.
4. It stops at the first answer with no tool call, or fails the block at the step cap.

The answer's own content goes back unchanged within the block, thinking blocks included.

## What the model receives

| History message | Messages API |
|---|---|
| a system message | appended to the `system` text |
| a user message, or a `tool` note with no call id | a user text block |
| a recorded tool call | an assistant `tool_use` block, then a user `tool_result` block: the output as JSON text, an error with `is_error` |
| the reply text | an assistant text block |

Messages of the same role in a row merge into one, so roles alternate as the API expects. A recorded call with no id gets one.

Empty text-only turns are omitted because this wire sends nonempty text blocks. No placeholder text replaces them. The neutral session history stays intact. `Observed.historyNormalizations` records each omitted turn's wire, original role and zero-based history index. HTML and JUnit reports show one summary line per block, such as `3 empty turns not sent on anthropic`; JSON retains the per-index detail, even when the block passes. Read-back stays exact for all carried text and tool records. See the [observation schema reference](../reference/observed.md#history-normalization).

For example, user `Hello.`, assistant `Ready.`, user `""`, assistant `Still ready.` sends one user text block and two assistant text blocks. The empty user turn is recorded as `anthropic`, history index `2`, `omitted-empty-turn`. Both assistant texts remain, in order.

Adapter versions and model-request bytes are unchanged. Cached observations recorded before this change carry no normalization note until they are rerun.

Tool names go on the wire with the characters the API accepts, letters, digits, underscore and dash, 64 at most: `coverage.check` becomes `coverage_check`. Each label gets a name unique within the session, and names come back as labels.

## What `send` returns

* Each text block is a text segment. Each `tool_use` is a tool call, followed by its result. The order is the order of the answers.
* Each model call's tokens and latency sit on the first segment it adds. `cost` sums `usage.input_tokens` and `usage.output_tokens`. `latencyMs` sums the model calls.
* `raw.stopReasons` lists the `stop_reason` of each model call, in order. `max_tokens` on the last one means a cut reply.
* Thinking and server tool blocks add no segment.

## Capabilities

`seedPrefix` and `toolStubs` are on. `endState` is on when `sideEffects` is given. `deterministic` is as declared. `variants`, `trace` and `sandbox` are off.

## End state

Each call of a `sideEffects` tool that did not fail is a payload, recorded by block, so a retried block replaces its own entries.

* `endState(session, 'tool:<label>')` returns the input of the last payload of that tool, or undefined.
* `endState(session, '*')` returns every payload, in order, as `{ tool, input }`.

## Errors

| Error | Becomes |
|---|---|
| a 408, 429 or any 5xx status (529 overloaded included), or a network error (refused, reset, timed out, `fetch failed`) in the error or its causes, after the [shared retry policy](../retries.md)'s attempts where the adapter retries the model call itself | `AdapterTransportError`, marked exhausted: the runner does not retry the block on top |
| any other status or error | `AgentFailure` |
| an answer with no content list | `AgentFailure` |
| tool calls still asked at the step cap | `AgentFailure` |
| a tool call that neither `world.tools` nor a `run` answers | `AgentFailure` |

A session used after `close` is an error.

## Target

```yaml
target:
  adapter: anthropic
  agent: acme-sales
```

The adapter reads no field of the target: the model and the prompt are the options you pass. Its id is `anthropic`.

With a prompt on the target (`campaign run --prompt`), its text replaces the `system` option as the system prompt; system messages in the history are still appended. See [datasets](../datasets.md#the-prompt-reaches-the-agent).
