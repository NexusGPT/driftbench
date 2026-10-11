# Adapters

An adapter connects driftbench to the agent under test. The runner, the checks and the judges never call an agent directly; they go through an adapter. The core package imports no vendor SDK, and Nexus is one adapter among others.

Every adapter is planned. This page gives the contract as designed.

## The contract

```ts
interface AgentAdapter {
  readonly id: string;
  capabilities(): { variants: boolean; seedPrefix: boolean; toolStubs: boolean; trace: boolean; sandbox: boolean };
  open(given: ResolvedGiven): Promise<Session>;
  send(session: Session, stimulus: Stimulus): Promise<Observed>;
  trace?(session: Session, block: number): Promise<Observed>;
  endState?(session: Session): Promise<WorldState>;
  close(session: Session): Promise<void>;
}
```

* `open` creates a conversation or a task session from the resolved Given of a block: prefix, ledger, world, vars and target.
* `send` runs one block and returns everything observed: every segment and every tool call, in order.
* `trace` is an optional richer read that replaces what `send` saw, for platforms whose traces hold more than their reply.
* `endState` reads the world after the run, for the `end_state` check.
* `close` ends the session and releases what it holds.

`ResolvedGiven`, `Stimulus`, `Observed` and `WorldState` are zod schemas in `packages/core/src/schema`. The interface itself lands with the runner, planned, phase 1.

## Capabilities

| Capability | The adapter can |
|---|---|
| `variants` | run a named variant of the agent, such as a prompt version |
| `seedPrefix` | start a session from a prefix of messages, which teacher-forced mode needs |
| `toolStubs` | force tool results and errors from `world.tools` |
| `trace` | offer `trace` |
| `sandbox` | run the agent in a sandboxed workspace, which task specs need |

## Contract tests

Every adapter passes the same contract test suite against the synthetic example agent. An adapter that returns part of a turn fails it. Planned, phase 1.

## The adapters

| Adapter | Reaches | Status |
|---|---|---|
| [function](function.md) | an async function in the same process | planned, phase 1 |
| [http](http.md) | an endpoint that speaks JSON in the OpenAI-compatible chat shape | planned, phase 1 |
| [nexus](nexus.md) | an agent on the Nexus platform | planned, phase 1 |
| [process](process.md) | a code-interpreter agent run as a command in a sandbox | planned, phase 1 |
| `openai-agents`, `anthropic`, `google`, `langgraph` | agents built on these SDKs and frameworks | planned, release phase |

## Runtime vocabulary

Every adapter maps its runtime onto the four concepts that specs and checks know: tools, skills, guards and stages. See [block](../concepts/block.md#tools-skills-guards-and-stages). No spec and no check uses a runtime's own names; the mapping lives in the adapter.

* The first example is the Nexus runtime: its mapping is on the [nexus adapter](nexus.md#runtime-vocabulary) page.
* A Claude Code harness is the second:

| Claude Code harness | Maps to |
|---|---|
| a hook that ran, with its decision | a guard, with the decision as its verdict |
| a skill it loads | a skill |
| a shell command, or any other tool call | a tool call |

The process adapter reads a Claude Code harness when the harness exposes these events (planned, phase 1), and so does the transcript adapter of the runtime battery (planned, phase 4). The guardrails of an agent SDK map to guards in the same way; the SDK adapters are planned, release phase.

## Choosing the agent in a spec

`target` sets the default agent of a spec: `adapter`, plus `agent`, `variant`, `deployment` and `options`. The adapter decides what the other fields mean. A run can override the target.

```yaml
target:
  adapter: http
  agent: support-bot
```

The names inside `options` are fixed by each adapter when it ships.
