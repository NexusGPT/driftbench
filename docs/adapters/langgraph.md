# langgraph adapter

Status: shipped, release phase. It passes the [contract suite](index.md#the-contract-suite) in chat mode twice, on a fake graph compiled with a checkpointer and without one, and on a real LangGraph `StateGraph` with a real `ToolNode`. It has not run against a live model yet.

The langgraph adapter runs an agent built as a LangGraph graph: a compiled `StateGraph(MessagesAnnotation)`, or a prebuilt `createReactAgent`, whose state holds a `messages` list. LangGraph is not a dependency of driftbench: the adapter takes your compiled graph and types it with a local interface. `@langchain/langgraph` is an optional peer dependency of `@agent-nexus/driftbench-adapters`; the shapes match version 1.4.21 with `@langchain/core` 1.2.17.

## Options

```ts
import { MemorySaver } from '@langchain/langgraph';
import { langgraphAdapter } from '@agent-nexus/driftbench-adapters';
import { workflow } from './agent'; // your StateGraph(MessagesAnnotation), with its tool node

const graph = workflow.compile({ checkpointer: new MemorySaver() });
const adapter = langgraphAdapter({
  graph,
  toolLabels: { coverage_check: 'coverage.check' },
  sideEffects: ['order.create'],
});
```

| Option | Meaning |
|---|---|
| `graph` | the compiled graph. The adapter calls `invoke`, `getState` and the checkpointer's `deleteThread`. |
| `threadId` | a function from the session id to the thread id. Default `driftbench-<session id>`, one thread per session. |
| `recursionLimit` | the graph's limit of super-steps per invoke. Unset leaves LangGraph's default. |
| `toolLabels` | the graph's tool names mapped to spec labels, such as `{ coverage_check: 'coverage.check' }`. A name absent from the map is its own label. |
| `sideEffects` | the spec labels of the tools that change the world. Their inputs are the payloads `tool:` and `*` read. |
| `deterministic` | true when the same input gives the same output. Default false. |
| `version` | the version the runner's cache key carries. The graph is code, so name its version here. Default the adapter's version. |

## What the graph receives

Each block invokes the graph with `{ messages }` and the config `{ configurable: { thread_id } }`, plus `recursionLimit` when it is set. The messages are message-like dicts that LangChain turns into its message classes:

| History message | Message |
|---|---|
| a user message, or a `tool` note with no call id | `{ role: 'user', content }` |
| a system message | `{ role: 'system', content }` |
| a recorded tool call | an assistant message with `tool_calls`, then one `tool` message per call: the output as JSON text, an error with `status: 'error'` |
| the reply text | `{ role: 'assistant', content }` |

A graph compiled without a checkpointer keeps nothing between calls, so every block sends the whole history. A graph compiled with one keeps the thread itself: the first block of a session sends the whole history, prefix included, and each later block sends only its own user messages, on the session's thread.

## What the adapter reads

The block's turn is what the returned `messages` hold after the last user message. Messages are read as LangChain instances, as dicts with `type` or `role` (a remote graph's answer), or in LangChain's serialized form (`{ lc: 1, type: 'constructor', id: [..., 'AIMessage'], kwargs }`).

* An AI message adds its text, then a tool call per `tool_calls` entry. Its `usage_metadata` sits on its first segment, and `cost` sums them.
* A tool message adds the result of the call it answers. It is an error when its status is `error`, or when it holds a single `error`; otherwise it is the content, parsed when it is JSON.
* Human and system messages add nothing.
* `__interrupt__` adds a card named `interrupt` with the interrupt values, and a call left open is closed with an error saying the graph stopped before the tool answered.
* `latencyMs` is the invoke, and sits on the first segment.

## Capabilities

`seedPrefix` is on. `toolStubs` is off: the graph runs its own tool node, so a block with a forced result in `world.tools` is `not_run`. `endState` is on when `sideEffects` is given or the graph has a checkpointer. `deterministic` is as declared. `variants`, `trace` and `sandbox` are off.

A block's `budget.steps` is not mapped: a super-step is not a model call. `recursionLimit` is the graph's own cap.

## End state

* `endState(session, 'tool:<label>')` and `endState(session, '*')` read the payloads of the `sideEffects` tools, as on the [openai-agents adapter](openai-agents.md#end-state).
* With a checkpointer, `endState(session, 'state')` reads the thread's values from the checkpoint, and `state:<key>` one of them. Without one, a `state` source is an error.

`close` deletes the thread from the checkpointer, when the session sent a block and the checkpointer has `deleteThread`.

In a checkpointed session, the thread, not the runner's history, is what the agent sees after the first block. A teacher-forced block whose Given differs from the session's is not replayed into the thread.

## Errors

| Error | Becomes |
|---|---|
| a 408, 429 or any 5xx status, or a network error (refused, reset, timed out, `fetch failed`), in the error or its causes | `AdapterTransportError`: the runner retries the block under the [shared policy](../retries.md) |
| `GraphRecursionError`, any other error | `AgentFailure` |
| a state with no `messages` list | `AgentFailure` |

A session used after `close` is an error.

## Target

```yaml
target:
  adapter: langgraph
  agent: acme-sales
```

The adapter reads no field of the target: the graph is the one you pass. Its id is `langgraph`.

With a prompt on the target (`campaign run --prompt`), the messages the graph receives start with a system message of its text; a checkpointed graph receives it once, with the first block. See [datasets](../datasets.md#the-prompt-reaches-the-agent).
