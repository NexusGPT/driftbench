# Production traces: import and monitor

driftbench reads what an agent did in production and uses it two ways. `driftbench import traces` turns traced conversations into draft specs, so a test starts from a state real users reached. `driftbench monitor --source traces` runs the drift detectors over production traffic in time windows, and alerts with an exit code and JSON.

Three sources are read into one trace shape: a conversation, its user turns in order, and for each turn what the agent did (text, tool calls with their results, tokens, cost, latency), the same Observed a block records in a run.

| `--from` | Reads | One conversation is | One turn is |
|---|---|---|---|
| `otel` | OTLP JSON: one document, or JSON Lines as the OpenTelemetry file exporter writes them, with spans that follow the GenAI semantic conventions | the spans that share `gen_ai.conversation.id`, else a session id (`session.id`, `traceloop.association.properties.session_id`), else one trace id | the chat spans from one new user message to the next, with the tool spans of the same trace and time |
| `nexus` | Nexus platform traces as `GET /tracing/traces/:id` answers them, with their generations: one answer, a list, or JSON Lines, with or without the `{ success, data }` envelope | the platform traces that share `conversationId` | one platform trace |
| `claude-code` | a recorded Claude Code session transcript (JSONL), with its decision log and step feed beside it when present | the session | one typed user message to the next, as `driftbench replay` reads it |

## OpenTelemetry

The reader follows the GenAI semantic conventions in the two shapes SDKs write today.

| Field | Current conventions | Flat indexed attributes |
|---|---|---|
| a chat span | `gen_ai.operation.name` chat, text_completion or generate_content | `llm.request.type` chat or completion |
| what was sent | `gen_ai.input.messages`, JSON with roles and typed parts | `gen_ai.prompt.N.role`, `.content`, `.tool_call_id` |
| what came back | `gen_ai.output.messages`: text parts and `tool_call` parts | `gen_ai.completion.0.content`, `gen_ai.completion.0.tool_calls.M.id`, `.name`, `.arguments` |
| a tool call | an `execute_tool` span: `gen_ai.tool.name`, `gen_ai.tool.call.id`, `.arguments`, `.result` | a span with `traceloop.span.kind` tool: `traceloop.entity.name`, `.input`, `.output` |
| a failed tool call | span status code 2 (error), its message | the same |
| model | `gen_ai.response.model`, else `gen_ai.request.model` | the same |
| tokens | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | `gen_ai.usage.prompt_tokens`, `gen_ai.usage.completion_tokens` |

The span events of the earlier conventions (`gen_ai.user.message`, `gen_ai.choice`) are read too. A tool result comes from its tool span, matched by call id, else by name; else from the tool message a later chat span sent. Times are read in nanoseconds exactly. The conventions define no cost attribute: the reader takes `gen_ai.usage.cost` when an SDK writes it, else computes one from a price table (`--prices`, USD per million tokens by model, `{"example-model-1": {"input": 2, "output": 8}}`). A turn has a cost only when every chat span in it has one.

Every span of the conversation is also kept as an observation on the trace: its id, its parent span id, its kind (chat, tool or other), its name, its start and end as ISO 8601 times, its level (`error` when the span status is an error, else `default`). A chat span also carries its input and output tokens, and its cost in USD: the span's own cost attribute, else the price table. The tree is what the spans said, so a tool span sits under the span that ran it.

A recorded Claude Code session keeps the same tree from its transcript: each line is an observation under the line it answers, a tool result is a tool observation, an assistant line a chat one, and a line a subagent wrote is marked `subagent`, nested under the line that started it. A tool result with an error is at the `error` level. A tool observation keeps its arguments as `input` and its result as `output`; a chat observation keeps its reply text as `output`. Each observed turn records the id of the observation it starts from, and the draft spec writes it as `observation_id` beside that block's observed entry, so every block links to its source.

Nexus traces carry no tree and have no observations. A workflow that gates a suite built from traces is in [running](running.md#project-config-and-the-pull-request-gate).

`rollUp(observations)` (package `@agent-nexus/driftbench-adapters`) rolls the tree up: for each line, the cost, input and output tokens, and span count of the line and everything under it, and the time from the earliest start to the latest end of that subtree. It also returns the slowest path: from the root that finishes last, the child that finishes last at each step, down to a leaf. Lines without a figure count as zero.

A conversation with no chat span gives no trace and is named in a note. The fixtures, fictional, are in `packages/adapters/test/traces/fixtures`: `otel-semconv.json` (current conventions, two traces of one conversation) and `otel-flat.jsonl` (flat attributes, one trace per turn joined by session id).

## Draft specs: `driftbench import traces`

```
driftbench import traces <path> --from otel|nexus|claude-code --out <dir> [--select <ids>] [--prices <file>] [--no-redact] [--force] [--dataset <name> --store <file>]
driftbench import approve <path> [--all]
```

`<path>` is a file, a folder (its `.json` and `.jsonl` files, in name order; for OpenTelemetry all their spans are read together, so a conversation split over files is one trace), or `-` for standard input (otel and nexus). Each conversation becomes `<dir>/draft-<source>-<id>.yaml`:

* each observed user turn is a block, its When the user message;
* its Given is what production observed before it, as the block's `prefix`: the earlier user messages, the agent's replies, its tool calls with their results;
* no block has an `expect`. One copied from the observed reply would pass by construction, the self-affirming test this design forbids. A person writes each expect from the agent's spec. What production did (the reply, the tool counts, tokens, cost, latency) is kept in `metadata.imported.observed` for that review;
* `metadata.imported.approved` is false until the person runs `driftbench import approve <path> --all`, or sets it by hand.

`--select <ids>` drafts only the traces named by a comma-separated list of trace ids. An id that names no trace in the input stops the run with exit 2 and writes nothing.

`--dataset <name> --store <file>` pushes the drafts as the next version of that dataset in the store, the same push as `driftbench dataset push`. The drafts take their time from the traces, never the clock, so the same traces draft the same bytes: importing unchanged traces again pushes no new version and prints that the dataset already holds them. Traces that changed make the next version. `--dataset` without `--store` exits 2.

Personal data is redacted by default with the [intake](generating.md) privacy rules: checksum detectors for emails, phones, IBANs, national ids, card numbers and addresses, then the independent second pass. One value keeps one placeholder across the whole conversation (`[ADDRESS_1]` in the user message and in the tool input). `--no-redact` keeps the data; do not commit such drafts to a public repository.

Exit 0 when the drafts are written, 2 on a usage or input error or an existing draft without `--force` (nothing is written). `import approve` exits 0 after listing or approving, 1 when a file is not an imported draft, 2 when the path is missing.

Real output, on the current-conventions fixture:

```
$ driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out drafts
Read 1 trace from 1 file (otel): 2 turns.
Wrote 1 draft spec to drafts, none approved: 2 blocks, no expect yet.
  Personal data redacted: 3 values.
Next: write each block's expect from the agent spec, then driftbench import approve drafts --all.
```

An excerpt of the draft, the tool output folded onto one line:

```text
blocks:
  - user: Hi, do you have home internet at [ADDRESS_1], Acmeville?
  - user: Yes please, how much is it per month?
    given:
      prefix:
        - role: user
          content: Hi, do you have home internet at [ADDRESS_1], Acmeville?
        - role: assistant
          content: "Yes: Acme Fiber 300 is available at [ADDRESS_1]. Do you want the plan details?"
          tool_calls:
            - id: call_cov_1
              label: coverage.check
              input:
                address: "[ADDRESS_1], Acmeville"
              output: { found: true, address_id: addr-102, fiber_mbps: 300, five_g: true }
      origin: recorded
```

Every prefix of a draft carries `origin: recorded`: its tool calls hold what the tools really returned, which an agent trusts in a way it does not trust the same fact in prose. See [Given](concepts/given-when-then.md#tool-history-records-not-prose).

## Monitoring: `driftbench monitor --source traces`

```
driftbench monitor --source traces <path> --metric <metric> [--from otel|nexus|claude-code] [--every <duration>] [--window <n>] [--prices <file>] [--series] [--json]
```

Conversations fall into fixed time windows by their start (`--every`, default `1h`; units s, m, h, d). Each window is one point: the mean of the metric over its conversations, with the standard error of that mean. The detectors are those of `driftbench monitor --store`: CUSUM, Page-Hinkley and a sliding two-sample KS test, the in-control level from the first `--window` windows (default 20), and a shift when two of the three alarm. Windows with no conversation, or none that has the metric, are left out and listed.

| `--metric` | Per conversation |
|---|---|
| `latency` | mean turn latency, ms |
| `cost` | total USD, only when every turn has a cost |
| `tokens` | total input and output tokens, when the source counts them |
| `tool_calls` | tool calls per turn |
| `tool_errors` | the share of failed tool calls over all the calls of a window |
| `turns` | number of turns |

The alert says when the vote was reached: the window where the second detector first alarmed (KS counts at the end of its second segment, the first window where its test can run). With `--json` it is the `alert` field (`index`, `createdAt` of the window, the two `detectors`), beside `alarm`, `votes` and every detector's alarms. Exit 1 on a shift, 0 without one, 2 on bad input (a store metric such as `pass_rate`, no path, a bad `--every`, fewer than twice `--window` windows).

### Detection delay and false alarms, measured

On synthetic fictional series (`packages/cli/test/trace-series.ts`): 60 hourly windows, 6 one-turn conversations an hour, latency normal with mean 1200 ms and sd 300 ms; in the shifted series the mean becomes 1500 ms from window 40 (one sd of a conversation, about 2.4 standard errors of a window mean). 200 seeds each, `--window 20`. Measured by `packages/cli/test/monitor-traces.test.ts`, which pins these counts:

| Series | Result |
|---|---|
| no shift | 12 of 200 raise a false alarm (6 percent) |
| shift at window 40 | 200 of 200 alarm; 8 of them alarm before window 40 (a false alarm first), 192 at or after it |
| delay, the 192 | median 2 windows after the shift, 90th percentile 4 |

One window is one hour here, so the median delay is two hours. A larger window per point lowers the noise of each point and the false alarms, and lengthens the delay in hours. The false alarm rate comes from the in-control level being estimated on 20 windows; the store monitor documents the same trade-off.

Real output, on one shifted series (seed 3):

```
driftbench monitor: latency over 60 windows of shift.jsonl (otel traces, 360 conversations, windows of 1h), oldest first. Window 20.
In control (the first 20): mean 1158 ms, sd 143 ms (the spread of the window values). CUSUM k 0.5 sd, h 5 sd; Page-Hinkley delta 0.5 sd, lambda 5 sd; KS segments of 20, alpha 0.05 over the splits scanned.
  detector      first alarm  window                    created                   direction  detail
  CUSUM         42           2026-03-03T18:00:00.000Z  2026-03-03T18:00:00.000Z  up         shift began at 37; 5 alarms in all
  Page-Hinkley  42           2026-03-03T18:00:00.000Z  2026-03-03T18:00:00.000Z  up         1 alarm in all
  KS            37           2026-03-03T13:00:00.000Z  2026-03-03T13:00:00.000Z  up         D 0.80, p 0.0000013

Alert at 42 (2026-03-03T18:00:00.000Z), when CUSUM and Page-Hinkley had both alarmed.
Shift detected: 3 of 3 detectors alarmed. Exit 1.
```

The same series without the shift prints `No shift: 0 of 3 detectors alarmed, 2 needed. Exit 0.`

## What is not built

* Reading live from a collector or a platform API: the commands read files and standard input.
* A runner rule that refuses an unapproved draft: approval is a flag the reviewer sets and `import approve` lists.
* Pass rate over production traces: traces carry no verdict; run the approved drafts to get one.
