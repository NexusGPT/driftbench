# google adapter

Status: shipped, release phase. It passes the [contract suite](index.md#the-contract-suite) in chat mode, on a fake client that plays the Acme example agent, and on the real `@google/genai` client with its `fetch` stubbed. It has not run against a live model yet.

The google adapter runs an agent built on the Gemini API: a model, a system instruction and function declarations. The SDK is not a dependency of driftbench: the adapter takes your client and types it with a local interface that mirrors `client.models.generateContent`. `@google/genai` is an optional peer dependency of `@agent-nexus/driftbench-adapters`; the shapes match version 2.28.0.

## Options

```ts
import { GoogleGenAI } from '@google/genai';
import { googleAdapter } from '@agent-nexus/driftbench-adapters';
import { salesPrompt, salesTools } from './agent'; // your prompt, and a function that returns SdkTool[]

const adapter = googleAdapter({
  client: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
  model: 'gemini-3-pro',
  system: salesPrompt,
  tools: (given) => salesTools(),
  sideEffects: ['order.create'],
});
```

The options are those of the [anthropic adapter](anthropic.md#options), with `maxOutputTokens` in place of `maxTokens`:

| Option | Meaning |
|---|---|
| `client` | the client. The adapter calls `client.models.generateContent({ model, contents, config })` and nothing else. |
| `model` | the model id |
| `system` | the system instruction. System messages in the history are appended to it. |
| `maxOutputTokens` | `maxOutputTokens` of each call. Unset leaves the model's default. |
| `tools` | the agent's tools as `SdkTool` (`name`, `description`, `inputSchema`, `run`), or a factory called once per session |
| `maxSteps` | the most model calls one block may take. Default 8. A block's `budget.steps` lowers it. A block still asking for tools at the cap fails. |
| `sideEffects` | the spec labels of the tools that change the world. It enables `endState`. |
| `deterministic` | true when the same input gives the same output. Default false. |
| `version` | the version the runner's cache key carries. Default the adapter's version with a hash of the model and the system instruction. |
| `retry`, `sleep` | the adapter's own [retry settings](../retries.md), under the spec target's `retry` and the run's, and how a wait is spent (tests). Each model call runs under the policy; the client's own retry settings stay as you built it. |

## The agent loop

The adapter closes the loop as the anthropic adapter does. Each call sends `config` with `systemInstruction`, the tools as `functionDeclarations` (each with `parametersJsonSchema`) and `maxOutputTokens` when set. While the answer holds `functionCall` parts, the adapter answers each call (a forced result or error from the block's `world.tools` first, else the tool's own `run`), sends a `functionResponse` part per call, `{ output }` or `{ error }` as the API documents, and calls again.

The model's content goes back unchanged within the block, so a Gemini 3 signed function call keeps its `thoughtSignature`. Calls from earlier blocks carry none, which the API accepts.

## What the model receives

| History message | Gemini contents |
|---|---|
| a system message | appended to the system instruction |
| a user message, or a `tool` note with no call id | a user text part |
| a recorded tool call | a model `functionCall` part, then a user `functionResponse` part, `{ output }` or `{ error }` |
| the reply text | a model text part |

Contents of the same role in a row merge into one. Function names keep their dots: the API accepts letters, digits, underscore, dot, colon and dash, 128 at most. A call without an id gets one for its segments and goes back without one.

The current Google serializer omits empty text-only turns without adding placeholder text. This describes the adapter's serialization rule, not a Gemini API restriction. `Observed.historyNormalizations` records `google`, the original role and the zero-based history index for each omission. The neutral session history stays intact. HTML and JUnit reports show one summary line per block, such as `3 empty turns not sent on google`; JSON retains the per-index detail. All carried text and tool records remain subject to exact read-back checks. See the [observation schema reference](../reference/observed.md#history-normalization).

Adapter versions and model-request bytes are unchanged. Cached observations recorded before this change carry no normalization note until they are rerun.

## What `send` returns

* Text parts are text segments. Thought parts (`thought: true`) are reasoning and add no segment. Each `functionCall` is a tool call, followed by its result.
* Each model call's tokens and latency sit on the first segment it adds. `cost` counts `promptTokenCount` as input, and `candidatesTokenCount` plus `thoughtsTokenCount` as output. `latencyMs` sums the model calls.
* `raw.finishReasons` lists the `finishReason` of each model call, in order. `MAX_TOKENS` on the last one means a cut reply.

## Capabilities

`seedPrefix` and `toolStubs` are on. `endState` is on when `sideEffects` is given. `deterministic` is as declared. `variants`, `trace` and `sandbox` are off.

## End state

As on the anthropic adapter: each call of a `sideEffects` tool that did not fail is a payload, recorded by block. `tool:<label>` reads the last input of that tool, `*` the whole log as `{ tool, input }`.

## Errors

| Error | Becomes |
|---|---|
| an `ApiError` with a 408, 429 or any 5xx status, or a network error in the error or its causes (a `fetch failed` with `ECONNREFUSED` in its cause), after the [shared retry policy](../retries.md)'s attempts | `AdapterTransportError`, marked exhausted: the runner does not retry the block on top |
| any other status or error | `AgentFailure` |
| an answer that is not an object | `AgentFailure` |
| an answer with no candidate: the block fails, naming `promptFeedback.blockReason` when the prompt was blocked | `AgentFailure` |
| tool calls still asked at the step cap | `AgentFailure` |
| a tool call that neither `world.tools` nor a `run` answers | `AgentFailure` |

A session used after `close` is an error.

## Target

```yaml
target:
  adapter: google
  agent: acme-sales
```

The adapter reads no field of the target: the model and the instruction are the options you pass. Its id is `google`.

With a prompt on the target (`campaign run --prompt`), its text replaces the `system` option as the system instruction; system messages in the history are still appended. See [datasets](../datasets.md#the-prompt-reaches-the-agent).
