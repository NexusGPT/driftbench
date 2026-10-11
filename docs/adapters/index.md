# Adapters

An adapter connects driftbench to the agent under test. The runner, the checks and the judges never call an agent directly; they go through an adapter. The core package imports no vendor SDK, and Nexus is one adapter among others.

The contract lives in `packages/core/src/contracts/adapter.ts`. The function, http, nexus and process adapters ship in `@driftbench/adapters`, phase 1, and each passes the contract suite.

## The contract

```ts
interface AgentAdapter {
  readonly id: string;
  readonly version: string;
  capabilities(): AdapterCapabilities;
  open(given: ResolvedGiven): Promise<Session>;
  send(session: Session, turn: Turn): Promise<Observed>;
  trace?(session: Session, turn: Turn): Promise<Observed>;
  endState?(session: Session, source: string): Promise<unknown>;
  readArtifact?(session: Session, path: string): Promise<Uint8Array>;
  close(session: Session): Promise<void>;
}

type Session = {
  readonly id: string;
  readonly adapter: string;
  readonly target: TargetRef;
  readonly given: ResolvedGiven;
  history: Message[];
  state?: unknown;
};

type Turn = {
  readonly index: number;
  readonly stimulus: Stimulus;
  readonly given: ResolvedGiven;
  readonly budget?: { steps?: number; costUsd?: number; latencyMs?: number };
};
```

* `id` is the name `target.adapter` uses. `version` is part of the runner's cache key.
* `open` creates a conversation or a task session from the resolved Given of a block: prefix, ledger, world, vars and target.
* `send` runs one block and returns everything observed: every segment and every tool call, in order.
* `trace` is an optional richer read of the last block that replaces what `send` returned, for platforms whose traces hold more than their reply.
* `endState` reads an end-state source after the run, for the `end_state` check.
* `readArtifact` reads a file the agent left in its workspace, for the artifact checks. Only an adapter that owns a workspace has it.
* `close` ends the session and releases what it holds. The runner always calls it, also after a failure.

`ResolvedGiven`, `Stimulus`, `Message`, `TargetRef` and `Observed` are zod schemas in `packages/core/src/schema`.

## The history belongs to the runner

`session.history` holds the messages so far. The runner appends the block's user message, or every message of a burst, before `send`, and the agent's reply after it: the text, and each tool call with its output or error. At send time the history ends with the current user turn. An adapter reads the history and never appends to it.

A session's history starts as a copy of the prefix, whatever the adapter can do with it. The `seedPrefix` capability says whether the agent itself sees the prefix.

## What `send` returns

The Observed of a block validates against the schema, and:

* every tool call is a `tool_call` segment followed by its `tool_result` segment;
* `toolCalls` lists the same calls in the same order, with the same input, output and error;
* `text` is the text segments joined by a newline;
* `cost` and `latencyMs` are present.

## End-state sources

`endState(session, source)` reads one source:

* `tool:<label>` is the last payload that tool received, such as `tool:order.create`. A tool that received nothing reads undefined.
* `*` is every payload the adapter recorded, in order, as a list of `{ tool, input }`. The runner reads it for `end_state: none`, and the check passes only when the list is empty.

Each adapter page says where the payloads come from.

## Errors

| Error | Means | The runner |
|---|---|---|
| `AdapterTransportError` | the transport failed: no connection, a timeout, a status the adapter treats as retryable | retries the call 3 times, after 200, 400 and 800 ms, then fails the run |
| `AgentFailure` | the agent itself failed: an error it threw, an answer that is not an Observed, a failing status | fails the run at once, with no retry |

Any other error fails the run at once too. A failed run is recorded with status `failed` and the error; it is never skipped. See [running](../running.md).

## Capabilities

| Capability | The adapter can |
|---|---|
| `variants` | run a named variant of the agent, such as a prompt version |
| `seedPrefix` | let the agent see a session's prefix, which teacher-forced mode needs |
| `toolStubs` | force tool results and errors from `world.tools` |
| `trace` | offer `trace` |
| `sandbox` | run the agent in a sandboxed workspace, which task specs need; it then offers `readArtifact` |
| `endState` | read end-state sources through `endState` |
| `deterministic` | give the same output for the same input; the [smoke](../running.md#driftbench-smoke) command reports a difference as a broken claim |

| Capability | function | http | nexus | process |
|---|---|---|---|---|
| `variants` | no | as declared | yes | no |
| `seedPrefix` | yes | yes | no | no |
| `toolStubs` | yes | as declared | no | no |
| `trace` | no | no | yes | no |
| `sandbox` | no | no | no | yes |
| `endState` | with a payload log | with an end-state URL | yes | no |
| `deterministic` | as declared | as declared | no | as declared |

The runner uses `trace` and `endState` today. It does not act on the others yet: a forced tool result in `world.tools` on an adapter without `toolStubs` is not applied, and a spec's `prefix` on an adapter without `seedPrefix` is not replayed to the agent.

## The contract suite

`packages/adapters/test/contract.ts` exports `adapterContract(name, makeAdapter, options)`, the suite every adapter passes. `makeAdapter` builds a fresh adapter for each test. The suite plays the runner: it appends each user message before `send` and the reply after it.

It runs in one of two modes. A chat adapter holds the conversation of the Acme Telecom example agent ([`examples/acme`](../../examples/acme/README.md)), tool calls and end states included. An adapter that runs a code agent in a sandbox names a `task` instead: a workspace, two instructions or more, and the file the first one produces. The suite then runs its generic tests on the task's blocks and skips the Acme ones, saying why.

| Test | What it holds |
|---|---|
| names itself and declares every capability | `id` equals the name, `version` is set, the seven capabilities are booleans, and `trace`, `endState` and `readArtifact` exist when `trace`, `endState` and `sandbox` are declared |
| opens a session for the Given | the session carries the adapter, the target and the Given, and its history is a copy of the prefix |
| sends a block and returns the whole turn | chat: the Observed follows the rules above, and the Acme agent's two tool calls and its reply all arrive |
| sends a task block | task: the Observed follows the rules above, the workspace diff lists the produced file as created, the artifacts hold it, and `readArtifact` reads it back |
| never appends to the history | `send` leaves the history as it was, and a second send on the same session carries it forward |
| delivers a forced tool error | chat, with `toolStubs`: an error in `world.tools` reaches the tool's `tool_result` segment and `toolCalls` |
| reads the last payload through `endState` | chat, with `endState`: after four blocks that place an upgrade order, `tool:order.create` reads that order, a tool that received nothing reads undefined, and `*` lists the order alone |
| lists no payload for source `*` | chat, with `endState`: `*` is an empty list before the first block and after two blocks that place no order |
| traces the last block | with `trace`: the traced block follows the same rules, with the same tool calls and the sent text |
| releases the session on close | a later `send` rejects, and the adapter's own release probe agrees when one is given |
| throws `AdapterTransportError` when the transport fails | a broken transport fails `open` or `send` with that error |

The function, http and nexus adapters run it in chat mode. The process adapter runs it in task mode on the Acme price-sheet task, with the fixture code agent of the sandbox tests (`packages/adapters/test/process.contract.test.ts`). A test a capability or the mode rules out is skipped, never failed. Run it from the repository root:

```sh
pnpm vitest run packages/adapters
```

## The adapters

| Adapter | Reaches | Status |
|---|---|---|
| [function](function.md) | an async function in the same process | shipped, phase 1 |
| [http](http.md) | an endpoint that speaks JSON, answering with an Observed or an OpenAI-compatible chat completion | shipped, phase 1 |
| [nexus](nexus.md) | an agent on the Nexus platform | shipped, phase 1; tested against recorded answer shapes, not yet run against a live agent |
| [process](process.md) | a code-interpreter agent run as a command in a sandbox | shipped, phase 1 |
| `openai-agents`, `anthropic`, `google`, `langgraph` | agents built on these SDKs and frameworks | planned, release phase |

## Runtime vocabulary

Every adapter maps its runtime onto the four concepts that specs and checks know: tools, skills, guards and stages. See [block](../concepts/block.md#tools-skills-guards-and-stages). No spec and no check uses a runtime's own names; the mapping lives in the adapter.

* The first example is the Nexus runtime: its mapping is on the [nexus adapter](nexus.md#runtime-vocabulary) page.
* A Claude Code harness is the second:

| Claude Code harness | Maps to |
|---|---|
| a hook that ran, with its decision | a guard, with the decision as its verdict |
| a skill it loads | a skill |
| a shell command | a command it ran, with its exit code |
| any other tool call | a tool call |

The process adapter carries the first three today: a code agent reports its skills, guards and stages, and the commands it ran, in two files the adapter reads after each block. See [the process adapter](process.md#what-the-agent-reports). No adapter reads a harness's own event log yet: the transcript adapter of the runtime battery is planned, phase 4. The guardrails of an agent SDK map to guards in the same way; the SDK adapters are planned, release phase.

## Choosing the agent in a spec

`target` sets the default agent of a spec: `adapter`, plus `agent`, `variant`, `deployment` and `options`. The adapter decides what the other fields mean, and each adapter page lists them. A run can override the target: the runner takes the target it is given, else the spec's, else `{ adapter: <the adapter's id> }`.

```yaml
target:
  adapter: http
  agent: support-bot
```

The command line reaches one target today, `function:acme`, the Acme example agent. The other adapters are used from code. See [running](../running.md).
