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

Specs and checks know four runtime concepts: tools, skills, guards and stages. See [block](../concepts/block.md#tools-skills-guards-and-stages). Each runtime has its own names for them. The adapter that reads a runtime maps those names onto the four concepts, so no spec and no check uses a runtime's own vocabulary.

| Runtime | Its own name | Maps to | Read by |
|---|---|---|---|
| Claude Code, and harnesses built on it | a tool call | a tool | the process adapter, planned, phase 1; the transcript adapter of the runtime battery, planned, phase 4 |
| Claude Code, and harnesses built on it | a write to a task board, such as the Nexus tracks board, through a CLI or a server tool | a tool: a board write is a tool call | the same |
| Claude Code, and harnesses built on it | a skill read into the session | a skill | the same |
| Claude Code, and harnesses built on it | a hook that ran, with its decision | a guard, with the decision as its verdict | the same |
| Claude Code, and harnesses built on it | a process step the harness logs | a stage | the same |
| An agent SDK | a guardrail that ran, with its result | a guard | the SDK adapters, planned, release phase |
| A Nexus agent | a tool call, including a workflow, an AI task or a document search the agent calls as one of its skills | a tool | the nexus adapter, planned, phase 1 |
| A Nexus agent | a step of the flow its prompt defines | a stage, named in the spec's `stages` | the nexus adapter, planned, phase 1 |

A Nexus skill is something the agent calls, so it maps to a tool; a skill in driftbench is a capability the agent loads.

## Choosing the agent in a spec

`target` sets the default agent of a spec: `adapter`, plus `agent`, `variant`, `deployment` and `options`. The adapter decides what the other fields mean. A run can override the target.

```yaml
target:
  adapter: http
  agent: support-bot
```

The names inside `options` are fixed by each adapter when it ships.
