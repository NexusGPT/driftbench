# pydantic-ai adapter

Status: shipped, release phase. It passes the [contract suite](index.md#the-contract-suite) in chat mode, on a fake bridge that plays the Acme example agent. Its bridge ran end to end on the real `pydantic-ai` 2.55.0 with a `FunctionModel`, two blocks with the history replayed. It has not run against a live model yet.

The pydantic-ai adapter runs a [Pydantic AI](https://ai.pydantic.dev/) agent in a Python process, one process per block, through a bridge script that ships with the adapter. Python and `pydantic-ai` are yours to install; driftbench depends on neither.

## Options

```ts
import { pydanticAiAdapter } from '@agent-nexus/driftbench-adapters';

const adapter = pydanticAiAdapter({
  agent: 'acme.agents:sales', // an Agent, or a function that returns one
  python: '.venv/bin/python',
  cwd: '/srv/acme', // where the agent's module is importable; also set as PYTHONPATH
  toolLabels: { coverage_check: 'coverage.check' },
  sideEffects: ['order.create'],
});
```

| Option | Meaning |
|---|---|
| `agent` | the agent, as `<module>:<name>` |
| `python` | the interpreter. Default `python3`. |
| `cwd`, `env` | where the process runs, and extra variables. Keys come from the environment, never from an option. |
| `timeoutMs` | the most milliseconds one block may take. Default 600000. |
| `exec` | runs the process. Default `spawnExec`; tests pass one that plays the bridge. |
| `toolLabels`, `sideEffects`, `deterministic`, `version` | as on the [openai-agents adapter](openai-agents.md#options) |

## The bridge

The adapter writes the bridge (`packages/adapters/src/pydantic-ai/bridge.py`) to a file under the temporary folder, named by its hash, and runs `python bridge.py <agent>`. On stdin it gets `{ "user_prompt": ..., "message_history": [...] }`: the block's user text, and the earlier turns in Pydantic AI's own format (what `ModelMessagesTypeAdapter` reads). It runs the agent once (`run_sync`) and prints one line, `driftbench-result <the run's new messages>`. Everything else the agent prints goes to stderr, and the adapter skips any other line on stdout, such as a banner.

| History message | Pydantic AI |
|---|---|
| a user message, or a `tool` note | a request with a `user-prompt` part |
| a system message | a request with a `system-prompt` part |
| a recorded tool call | a response with a `tool-call` part, then a request with its `tool-return`, or a `retry-prompt` carrying the error |
| the reply text | a response with a `text` part |

## What the adapter reads

The new messages, in order: a response's `text` parts are text, its `tool-call` parts tool calls (arguments parsed when they are JSON text), its usage (`input_tokens`, `output_tokens`) on its first segment; a request's `tool-return` is the call's result (an error when its `outcome` is not `success`), and a `retry-prompt` that names a tool is that call's error (the tool asked the model to try again). The agent runs its own tools, so `world.tools` cannot reach them.

## Capabilities

`seedPrefix` yes; `toolStubs` no; `endState` with `sideEffects`; the rest no; `deterministic` as declared.

## Errors

| What happens | Error |
|---|---|
| the bridge prints `driftbench-error` with a 408, a 429 or a 5xx (`ModelHTTPError.status_code`), or a connection or timeout error type | `AdapterTransportError`: the runner retries under the [shared policy](../retries.md) |
| the interpreter cannot start | `AdapterTransportError`, marked exhausted: not retried |
| the process gives no answer within `timeoutMs` | `AdapterTransportError` |
| any other `driftbench-error`, or an exit without a result line | `AgentFailure`, with the error or the end of stderr |

## Target

The adapter reads no field of the target except `retry`. Its id is `pydantic-ai`.
