# vercel-ai adapter

Status: shipped, release phase. It passes the [contract suite](index.md#the-contract-suite) in chat mode, on a fake `generateText` with a model that plays the Acme example agent, and on the real `generateText` of the `ai` package (7.0.137) with its `MockLanguageModelV4` playing the same agent. It has not run against a live model yet.

The vercel-ai adapter runs an agent built with the [Vercel AI SDK](https://ai-sdk.dev/): a model, a system prompt and tools, run by `generateText`. You hand it the SDK's `generateText` and your model; `ai` is an optional peer dependency of `@agent-nexus/driftbench-adapters`; driftbench does not depend on it.

## Options

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { vercelAiAdapter } from '@agent-nexus/driftbench-adapters';
import { salesPrompt, salesTools } from './agent'; // your prompt, and a function that returns the tools

const adapter = vercelAiAdapter({
  generateText,
  model: openai('gpt-5'),
  system: salesPrompt,
  tools: (given) => salesTools(), // { coverage_check: tool({ ... }), ... }
  toolLabels: { coverage_check: 'coverage.check', order_create: 'order.create' },
  sideEffects: ['order.create'],
});
```

| Option | Meaning |
|---|---|
| `generateText` | the SDK's `generateText` |
| `model` | the language model |
| `system` | the system prompt. System messages in the history are appended to it. |
| `tools` | the tools by name, or a factory called once per session |
| `maxSteps` | the most steps (model calls) one block may take, through `stopWhen`. Default 8. A block's `budget.steps` lowers it. |
| `toolLabels` | the tool names mapped to spec labels; a name the providers accept takes no dot |
| `retry`, `sleep` | the adapter's own [retry settings](../retries.md), and how a wait is spent (tests) |
| `sideEffects`, `deterministic`, `version` | as on the [openai-agents adapter](openai-agents.md#options) |

## What the agent receives

Each block calls `generateText` once with the session history as model messages: a user message as text, a recorded tool call as an assistant `tool-call` part and a `tool` message with its `tool-result` (`{ type: 'json', value }`, or `{ type: 'error-text', value }` for an error), then the reply text. The SDK closes the agent loop, running each tool's `execute`.

The adapter adds two wrappers, and changes neither of your objects:

* Each tool's `execute` answers a forced result or error from the block's `world.tools` first, by spec label. The wrapper is a new tool object.
* The model's `doGenerate` runs under the [shared retry policy](../retries.md), through a proxy that keeps the model's class and fields; `generateText` runs with `maxRetries: 0`, so each model call is retried once, by the policy, and recorded.

## What the adapter reads

The `steps` of the result, in order: `text` parts become text, `tool-call` parts tool calls, `tool-result` parts their outputs, `tool-error` parts their errors (the thrown message). Reasoning parts add nothing. Each step's `usage.inputTokens` and `outputTokens` sit on its first segment. `raw.finishReasons` lists each step's finish reason. A call the run never answered gets an error result.

## Capabilities

`seedPrefix` and `toolStubs` yes; `endState` with `sideEffects`; `variants`, `trace` and `sandbox` no; `deterministic` as declared.

## Errors

| Error | Becomes |
|---|---|
| a 408, a 429 or a 5xx (`statusCode`), or a network error, after the policy's attempts | `AdapterTransportError`, marked exhausted |
| any other error `generateText` throws | `AgentFailure` |

## Target

The adapter reads no field of the target except `retry`. Its id is `vercel-ai`.
