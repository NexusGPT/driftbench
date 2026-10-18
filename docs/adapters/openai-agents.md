# openai-agents adapter

Status: shipped, release phase. It passes the [contract suite](index.md#the-contract-suite) in chat mode, on a fake runner that plays the Acme example agent, and on the real `@openai/agents` package driven through a fake model. It has not run against a live model yet.

The openai-agents adapter runs an agent built with the OpenAI Agents SDK. The SDK is not a dependency of driftbench: the adapter takes your runner and your agent, and types them with a local interface that mirrors the SDK's call shape. `@openai/agents` is an optional peer dependency of `@agent-nexus/driftbench-adapters`; the shapes match version 0.20.0.

## Options

```ts
import { Runner } from '@openai/agents';
import { openaiAgentsAdapter } from '@agent-nexus/driftbench-adapters';
import { buildSalesAgent } from './agent'; // your own Agent, built with new Agent({ ... })

const adapter = openaiAgentsAdapter({
  runner: new Runner(),
  agent: (given) => buildSalesAgent(), // or one Agent for every session
  toolLabels: { coverage_check: 'coverage.check', order_create: 'order.create' },
  sideEffects: ['order.create'],
});
```

| Option | Meaning |
|---|---|
| `runner` | the runner. The adapter calls `runner.run(agent, items, { maxTurns, context })` and nothing else. |
| `agent` | the agent, or a factory called once per session with its resolved Given, such as one that gives each conversation a fresh store |
| `maxTurns` | the most model calls one block may take, the SDK's `maxTurns`. Default 10. A block's `budget.steps` lowers it. |
| `followHandoffs` | after a handoff, the next block starts from the agent the run ended with (`lastAgent`), as the SDK's own chat loop does. Default true. With false, every block starts from the first agent. |
| `context` | a factory that builds the run context of a session, handed to the agent's tools and guardrails |
| `toolLabels` | the agent's tool names mapped to spec labels. An OpenAI function name takes no dot, so `coverage_check` maps to `coverage.check`. A name absent from the map is its own label. |
| `sideEffects` | the spec labels of the tools that change the world. It enables `endState`. |
| `deterministic` | true when the same input gives the same output. Default false. |
| `version` | the version the runner's cache key carries. The agent is code, so name its version here. Default the adapter's version. |

## What the agent receives

Each block runs the agent once, on the session history as SDK input items. The runner has ended the history with the block's user messages.

| History message | Input item |
|---|---|
| a user message, or a `tool` note with no call id | a user message |
| a system message | a system message |
| a recorded tool call | a `function_call` item, then a `function_call_result` item: the output as JSON text, an error as `{"error": "..."}` |
| the reply text | an assistant message with an `output_text` part |

The adapter never passes an SDK session: the history belongs to the driftbench runner, and the SDK's own memory would keep a second copy of the conversation. The SDK runs the model, the agent's tools and the handoffs, up to `maxTurns`.

## What the adapter reads

The adapter reads the items the run added, `newItems`, in order:

| Run item | Becomes |
|---|---|
| `message_output_item` | a text segment: its `output_text` parts, and a `refusal` |
| `tool_call_item`, a `function_call` | a tool call under its label, with the arguments parsed |
| `tool_call_item`, a hosted tool | a tool call named by the tool, with its output as the result when the item carries one |
| `tool_call_output_item` | the result of that call; a value that is a single `{ "error": ... }` is the call's error |
| `handoff_call_item`, `handoff_output_item` | the transfer call (`transfer_to_<agent>`) with the result `{ agent }`, and a stage named after the agent taking over |
| `tool_approval_item` | the waiting call, closed with an error saying it waits for an approval |
| reasoning and other items | nothing |

* The input and output guardrail results become guards: `block` when the tripwire fired, `pass` otherwise.
* A tripwire that stops the run (`InputGuardrailTripwireTriggered` and its output and tool twins) is the agent's behaviour, not a failure. The block's Observed holds that guard with the verdict `block`, and no text.
* A call the run never answered gets a result with an error.
* `cost` sums the token usage of every model response in `rawResponses`. `latencyMs` is the whole run, and sits on the first segment.

A tool that reports a failure should return `{ "error": "..." }`. The SDK's default error text reaches the adapter as an ordinary output.

## Capabilities

`seedPrefix` is on: the agent receives the whole history, prefix included. `toolStubs` is off: the SDK runs the agent's own tools, so a block with a forced result in `world.tools` is `not_run`. `endState` is on when `sideEffects` is given. `deterministic` is as declared. `variants`, `trace` and `sandbox` are off.

## End state

Each call of a `sideEffects` tool that did not fail is a payload, recorded by block, so a retried block replaces its own entries.

* `endState(session, 'tool:<label>')` returns the input of the last payload of that tool, or undefined.
* `endState(session, '*')` returns every payload, in order, as `{ tool, input }`.

## Errors

| Error | Becomes |
|---|---|
| a 408, 429 or any 5xx status, or a network error (refused, reset, timed out, `fetch failed`), in the error or its causes | `AdapterTransportError`: the runner retries the block under the [shared policy](../retries.md) |
| `MaxTurnsExceededError`, any other status or error | `AgentFailure` |
| a run that returns no `newItems` list | `AgentFailure` |
| a guardrail tripwire | no error: a guard with the verdict `block` |

A session used after `close` is an error.

## Target

```yaml
target:
  adapter: openai-agents
  agent: acme-sales
```

The adapter reads no field of the target: the agent is the one you pass. Its id is `openai-agents`.

With a prompt on the target (`campaign run --prompt`), the input starts with a system message of its text; the agent's own instructions stay. See [datasets](../datasets.md#the-prompt-reaches-the-agent).
