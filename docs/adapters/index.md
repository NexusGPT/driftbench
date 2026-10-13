# Adapters

An adapter connects driftbench to the agent under test. The runner, the checks and the judges never call an agent directly; they go through an adapter. The core package imports no vendor SDK, and Nexus is one adapter among others.

The contract lives in `packages/core/src/contracts/adapter.ts`. Every adapter ships in `@agent-nexus/driftbench-adapters`. The function, http, nexus and process adapters (phase 1) and the openai-agents, anthropic, google and langgraph adapters (release phase) each pass the contract suite. The Claude Code adapter replays a recorded session, with no model call.

`@agent-nexus/driftbench-adapters` imports no vendor SDK either. The four SDK adapters take the vendor's client, runner or graph from you, and `@agent-nexus/driftbench-adapters` declares `@openai/agents`, `@anthropic-ai/sdk`, `@google/genai` and `@langchain/langgraph` as optional peer dependencies, with the versions the shapes were proven against.

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
| `AdapterTransportError` | the transport failed: a 408, a 429, a 5xx, or a network error | retries the call under the [shared retry policy](../retries.md) (4 attempts, backoff from 500 ms with jitter, Retry-After honoured), records each retry in the block, then fails the run; one marked `exhausted` (the adapter already retried it) is not retried again |
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

| Capability | openai-agents | anthropic | google | langgraph | claude-code (replay) |
|---|---|---|---|---|---|
| `variants` | no | no | no | no | no |
| `seedPrefix` | yes | yes | yes | yes | yes |
| `toolStubs` | no: the SDK runs the tools | yes | yes | no: the graph runs the tools | no |
| `trace` | no | no | no | no | no |
| `sandbox` | no | no | no | no | no |
| `endState` | with `sideEffects` | with `sideEffects` | with `sideEffects` | with `sideEffects`, or a checkpointer | no |
| `deterministic` | as declared | as declared | as declared | as declared | yes |

| Capability | crewai | vercel-ai | pydantic-ai | litellm |
|---|---|---|---|---|
| `variants` | no | no | no | no |
| `seedPrefix` | yes | yes | yes | yes |
| `toolStubs` | no: the crew runs the tools | yes: the adapter wraps each `execute` | no: the agent runs the tools | yes |
| `trace` | no | no | no | no |
| `sandbox` | no | no | no | no |
| `endState` | with `sideEffects`, process interface only | with `sideEffects` | with `sideEffects` | with `sideEffects` |
| `deterministic` | as declared | as declared | as declared | as declared |

The four SDK adapters report tokens, never a cost in USD.

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

The function, http and nexus adapters, the four SDK adapters and the four framework adapters run it in chat mode (crewai through its process interface); the langgraph adapter runs it twice, on a graph with a checkpointer and on one without. The SDK adapters run it on fakes that play the Acme agent and refuse what the real API refuses (roles out of order, a dotted Anthropic tool name, an unanswered `tool_use`, a Gemini 3 call sent back without its signature). Their requests are also checked against exchanges the real SDK packages recorded with fake transports (`packages/adapters/test/fixtures/sdk/recorded`). The process adapter runs it in task mode on the Acme price-sheet task, with the fixture code agent of the sandbox tests (`packages/adapters/test/process.contract.test.ts`). A test a capability or the mode rules out is skipped, never failed. Run it from the repository root:

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
| [openai-agents](openai-agents.md) | an agent built with the OpenAI Agents SDK, run by your runner | shipped, release phase; contract proven on fakes and on the real SDK with fake transports, not yet run against a live model |
| [anthropic](anthropic.md) | an agent on the Anthropic Messages API, through your client; the adapter closes the tool loop | shipped, release phase; contract proven on fakes and on the real SDK with fake transports, not yet run against a live model |
| [google](google.md) | an agent on the Gemini API, through your client; the adapter closes the tool loop | shipped, release phase; contract proven on fakes and on the real SDK with fake transports, not yet run against a live model |
| [langgraph](langgraph.md) | a compiled LangGraph graph whose state holds `messages`, with or without a checkpointer | shipped, release phase; contract proven on fakes and on the real SDK with fake transports, not yet run against a live model |
| [crewai](crewai.md) | a CrewAI crew, in a Python process through a bridge that reports its tools, or deployed on CrewAI AMP over HTTP | shipped, release phase; contract proven on a fake bridge, the bridge run on the real `crewai` with a scripted model; not yet run against a live model or a deployed crew |
| [vercel-ai](vercel-ai.md) | an agent run by the Vercel AI SDK's `generateText` | shipped, release phase; contract proven on a fake and on the real `ai` package with its mock model; not yet run against a live model |
| [pydantic-ai](pydantic-ai.md) | a Pydantic AI agent, in a Python process through a bridge | shipped, release phase; contract proven on a fake bridge, the bridge run on the real `pydantic-ai` with a `FunctionModel`; not yet run against a live model |
| [litellm](litellm.md) | a model behind a LiteLLM proxy or any OpenAI-compatible chat completions endpoint, the agent loop closed in the adapter | shipped, release phase; contract proven on a fake proxy and on the real `openai` client; not yet run against a live proxy |
| [claude-code](claude-code.md) | a recorded Claude Code session (transcript, guard decision log, step feed), replayed with no model call; also the reader of a Claude Code estate | the session reader, the replay adapter, the estate reader and the live runner are shipped |

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

Two adapters carry it today:

* The [claude-code adapter](claude-code.md) reads a recorded session: the transcript gives the tool calls, the Skill loads and the shell commands with their exit codes; the hook decision log gives the guards; the step feed gives the stages.
* The process adapter reads what a code agent reports: its skills, guards and stages, and the commands it ran, in two files the adapter reads after each block. See [the process adapter](process.md#what-the-agent-reports).

The SDK adapters map their runtimes the same way:

| SDK runtime | Maps to |
|---|---|
| an OpenAI Agents input or output guardrail result | a guard, `block` when its tripwire fired, `pass` otherwise |
| an OpenAI Agents handoff | a transfer tool call, and a stage named after the agent taking over |
| an OpenAI Agents call waiting for approval | a tool call closed with an error |
| a LangGraph interrupt | a card named `interrupt` |
| an Anthropic thinking block, a Gemini thought part | nothing |

## Choosing the agent in a spec

`target` sets the default agent of a spec: `adapter`, plus `agent`, `variant`, `deployment` and `options`. The adapter decides what the other fields mean, and each adapter page lists them. A run can override the target: the runner takes the target it is given, else the spec's, else `{ adapter: <the adapter's id> }`.

```yaml
target:
  adapter: http
  agent: support-bot
```

The command line reaches the Acme example agents: `function:acme-sales` (or `function:acme`), the sales assistant behind the function adapter, and `process:acme-ops`, the ops agent behind the process adapter. `driftbench pilot` adds its control agent, `function:acme-random`, and `driftbench replay` runs specs on the claude-code replay adapter. The other adapters are used from code. See [running](../running.md).
