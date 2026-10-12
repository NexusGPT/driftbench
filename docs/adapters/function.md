# function adapter

Status: shipped, phase 1. It passes the [contract suite](index.md#the-contract-suite) in chat mode.

The function adapter runs an agent that is an async function in the same process as driftbench. There is no network call and no API key. It suits tests of an agent's logic, and it drives the Acme sales assistant, the command line's `function:acme-sales` target (short form `function:acme`).

## Options

The command line builds its `function:acme-sales` target this way:

```ts
import { functionAdapter } from '@driftbench/adapters';
import { createAcmeAgent, createStore } from './examples/acme/src/index';

const adapter = functionAdapter({
  create: () => {
    const store = createStore();
    return { store, agent: createAcmeAgent(store) };
  },
  respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
  payloads: (session) => session.store.payloads,
  deterministic: true,
});
```

| Option | Meaning |
|---|---|
| `respond(messages, world, vars, state)` | the agent. It returns an Observed, or a promise of one. |
| `create(given)` | builds the state of one session from its resolved Given, so nothing leaks between conversations. Without it, `state` is undefined. |
| `payloads(state)` | the payloads the side-effecting tools received, oldest first, as `{ tool, input }`. It enables `endState`. |
| `deterministic` | true when the same input gives the same output. Default false. |
| `version` | the version the runner's cache key carries. Change it when the agent changes. |

## What the agent receives

* `messages`: the session history as the runner left it, ending with the block's user messages. The history starts as a copy of the prefix, so the agent sees the prefix.
* `world` and `vars`: the block's resolved world and runtime variables, so `world.tools` can force tool results and errors.
* `state`: what `create` built for the session.
* `context`: `{ target, prompt }`. `prompt` is `target.prompt.text`, the prompt version `campaign run --prompt` restored from the store, byte for byte; it is absent without one. See [datasets](../datasets.md#the-prompt-reaches-the-agent).

Every argument is a copy: the agent cannot change the session or the Given. The adapter validates what the agent returns.

## Capabilities

`seedPrefix` and `toolStubs` are on: the agent receives the history and the world. `endState` is on when `payloads` is given. `deterministic` is as declared. `variants`, `trace` and `sandbox` are off.

## End state

* `endState(session, 'tool:<label>')` returns the input of the last payload of that tool, or undefined.
* `endState(session, '*')` returns the whole log, in order, as `{ tool, input }`.
* Any other source is a configuration error.

## Errors

An error the agent throws becomes an `AgentFailure`, except an `AdapterTransportError` or an `AgentFailure`, which pass through as they are. An Observed that does not validate is an `AgentFailure` that names its first issues. A session used after `close` is an error.

## Target

```yaml
target:
  adapter: function
  agent: acme-sales
```

The adapter reads no field of the target: the function is the agent. The command line maps `function:acme-sales` and `function:acme` to the Acme sales assistant, with a fresh Acme store per session and its payload log as the end-state source.
