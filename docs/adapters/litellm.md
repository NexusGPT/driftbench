# litellm adapter

Status: shipped, release phase. It passes the [contract suite](index.md#the-contract-suite) in chat mode, on a fake proxy that plays the Acme example agent, and on the real `openai` client (7.32.0) pointed at that fake proxy through its `fetch`. It has not run against a live LiteLLM proxy yet.

The litellm adapter runs an agent whose model sits behind a [LiteLLM](https://docs.litellm.ai/) proxy, or any endpoint that speaks the OpenAI chat completions shape. You hand it a client: the `openai` package's client with its `baseURL` on the proxy, or any object with `chat.completions.create`. `openai` is an optional peer dependency of `@agent-nexus/driftbench-adapters`; driftbench does not depend on it.

From the command line, a spec whose target is `litellm:<model>` with `options.base_url` reaches this adapter with no code, through a client built on `fetch`: see [targets from settings](../running.md#targets-from-settings).

## CLI target credential handling

::: warning Successful replies and sensitive stores
A successful reply is stored as the agent sent it, except for the redactions described here. The CLI scans for literal keys, percent, base64, base64url and hex encodings, and all 16 ordered two-level compositions of those encodings, including `base64(percent(key))`. It also scans the encoded `Bearer <key>` forms. A key echoed in another form can remain in results. Keys split across fields are not detected; deeper or unlisted encodings are outside this protection. Use a test-scoped key and treat the results store and cache as sensitive.
:::

**CLI error-path guarantee:** with `target.options.debug_error_body` absent or false, upstream error bodies, headers and thrown transport details never enter output or storage. Diagnostics contain only fixed messages, status, request host and body length when known. `debug_error_body: true` is an explicitly unsafe opt-in to error-body disclosure. This guarantee belongs to the CLI target wrapper; directly constructing the library adapter does not install that wrapper.

## Options

```ts
import OpenAI from 'openai';
import { litellmAdapter } from '@agent-nexus/driftbench-adapters';
import { salesPrompt, salesTools } from './agent'; // your prompt, and a function that returns SdkTool[]

const adapter = litellmAdapter({
  client: new OpenAI({ baseURL: 'http://localhost:4000', apiKey: process.env.LITELLM_API_KEY }),
  model: 'anthropic/claude-sonnet-5-5', // a model or a model group of the proxy
  system: salesPrompt,
  tools: (given) => salesTools(),
  sideEffects: ['order.create'],
});
```

| Option | Meaning |
|---|---|
| `client` | the client. The adapter calls `client.chat.completions.create(body, { maxRetries: 0 })` and nothing else. |
| `model` | the model name the proxy routes |
| `system` | the system prompt, sent as the first message |
| `tools` | the agent's tools as `SdkTool`s (see the [anthropic adapter](anthropic.md#options)), or a factory called once per session |
| `maxTokens` | `max_tokens` of each call; unset leaves the model's default |
| `maxSteps` | the most model calls one block may take. Default 8. A block's `budget.steps` lowers it. |
| `retry`, `sleep` | the adapter's own [retry settings](../retries.md), under the spec target's and the run's, and how a wait is spent (tests) |
| `sideEffects` | the spec labels of the tools that change the world. It enables `endState`. |
| `deterministic`, `version` | as on the [anthropic adapter](anthropic.md#options) |

## The agent loop

A chat completion that asks for tools stops there, so the adapter closes the loop, as the anthropic adapter does: it answers each `tool_calls` entry (a forced result or error from the block's `world.tools` first, else the tool's own `run`), sends one `tool` message per call (the output as JSON, an error as `{"error": "..."}`), and calls again, until a completion asks for no tool or the step cap. Tool names go to the proxy with the characters the OpenAI shape accepts (`coverage.check` becomes `coverage_check`) and come back as labels.

Each completion is one model call under the [shared retry policy](../retries.md), with the client's own retries off, so a 429 or a 5xx from the proxy or the provider behind it is retried once, by the policy, and recorded in the block.

## What `send` returns

Text and tool calls in order, each tool call followed by its result. Tokens come from `usage.prompt_tokens` and `usage.completion_tokens`, on each call's first segment. `raw.models` lists the model each answer names (the deployment the proxy routed to), `raw.finishReasons` each call's `finish_reason`.

## Capabilities

`seedPrefix` and `toolStubs` yes; `endState` with `sideEffects`; `variants`, `trace` and `sandbox` no; `deterministic` as declared.

## Errors

| Error | Becomes |
|---|---|
| a 408, a 429 or a 5xx, or a connection or timeout error, after the policy's attempts | `AdapterTransportError`, marked exhausted |
| any other status, such as a 400 for a bad tool name or a 401 | `AgentFailure` |
| a completion with no `choices[0].message`, or tool calls at the step cap | `AgentFailure` |

## Target

The adapter reads no field of the target except `retry`. Its id is `litellm`.
