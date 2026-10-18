# crewai adapter

Status: shipped, release phase. It passes the [contract suite](index.md#the-contract-suite) in chat mode, through its process interface, on a fake bridge that plays the Acme example agent. Its bridge ran end to end on the real `crewai` 1.15.27 with a scripted model, tools reported from the event bus. The HTTP interface is tested on a fake AMP API built from its documented shape; it has not run against a deployed crew yet.

The crewai adapter runs a [CrewAI](https://docs.crewai.com/) crew. A crew runs tasks; a conversation reaches it through its inputs. It has two interfaces:

* `crewaiProcess`: the crew in a Python process, through a bridge script that ships with the adapter. It reports the final output, each task's output, and every tool the crew's agents used.
* `crewaiHttp`: a crew deployed on CrewAI AMP, through `POST /kickoff` and `GET /status/{kickoff_id}`. That API reports outputs only, no tool calls.

Python and `crewai` are yours to install; driftbench depends on neither.

## Options

```ts
import { crewaiAdapter, crewaiHttp, crewaiProcess } from '@agent-nexus/driftbench-adapters';

const local = crewaiAdapter({
  transport: crewaiProcess({ crew: 'acme.crews:build_sales', python: '.venv/bin/python', cwd: '/srv/acme' }),
  toolLabels: { coverage_check: 'coverage.check' },
  sideEffects: ['order.create'],
});

const deployed = crewaiAdapter({
  transport: crewaiHttp({ url: 'https://acme-sales.crewai.com', token: process.env.CREWAI_TOKEN ?? '' }),
});
```

| Option | Meaning |
|---|---|
| `transport` | `crewaiProcess(...)` or `crewaiHttp(...)` |
| `inputs` | the crew's inputs for a block, from the history and the turn. Default `{ message, history, messages }`: the block's user text, the earlier turns as `role: text` lines, and the whole history as JSON. All strings, as CrewAI interpolates them into task descriptions. |
| `toolLabels`, `sideEffects`, `deterministic`, `version` | as on the [openai-agents adapter](openai-agents.md#options) |

| `crewaiProcess` option | Meaning |
|---|---|
| `crew` | the crew, as `<module>:<name>`: a Crew, or a function that returns a fresh one (one per block, so no state leaks between blocks) |
| `python`, `cwd`, `env`, `timeoutMs`, `exec` | as on the [pydantic-ai adapter](pydantic-ai.md#options) |

| `crewaiHttp` option | Meaning |
|---|---|
| `url`, `token` | the crew's URL and bearer token from the AMP dashboard. Read the token from the environment; it reaches no message. |
| `pollIntervalMs` | the wait between two status reads. Default 2000. |
| `timeoutMs` | the most milliseconds one kickoff may take, polling included. Default 600000. |
| `fetch`, `sleep` | for tests |

## The bridge

The adapter writes the bridge (`packages/adapters/src/crewai/bridge.py`) to the temporary folder and runs `python bridge.py <crew>`, with `{ "inputs": {...} }` on stdin. The bridge listens on CrewAI's event bus for `ToolUsageFinishedEvent` and `ToolUsageErrorEvent`, kicks the crew off, and prints `driftbench-result {"raw", "tasks", "tools", "usage"}`. A tool that fails and is tried again by CrewAI appears once per attempt.

## What `send` returns

Each tool use as a tool call followed by its result (an output that is JSON text is parsed), then the crew's final output as text. Each task's name is a stage, in order. The token usage, when the crew reports it, is the block's cost. The task outputs are kept in `raw.tasks`.

## Capabilities

`seedPrefix` yes (the history goes in the inputs; with the default inputs a Given prefix whose tool calls the spec states as a record, `origin: recorded` or `authored`, is refused, since the crew would read them as prose; a canonical prefix, as in mode T, runs); `toolStubs` no (the crew runs its own tools); `endState` with `sideEffects` through the process interface only; the rest no; `deterministic` as declared.

## Errors

| What happens | Error |
|---|---|
| a 408, a 429 or a 5xx from AMP (Retry-After kept), or a bridge error with such a status or a connection error | `AdapterTransportError`: the runner retries under the [shared policy](../retries.md) |
| a crew run that does not finish within `timeoutMs` | `AdapterTransportError`, marked exhausted |
| any other status, a run whose status is `error`, or a bridge exit without a result | `AgentFailure` |

## Target

The adapter reads no field of the target except `retry`. Its id is `crewai`.
