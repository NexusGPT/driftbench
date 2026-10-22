# Traces

This is a hands-on guide to traces, the records of what an agent did. A trace shows the messages, the tool calls and the files of one conversation. You read the trace that your own agent leaves. You turn a recorded session and a log file into draft tests. You replay a session against a new rule without calling the agent. Nothing here calls a model, so nothing is paid for. Every command below is run by a test on GitHub, and every excerpt is real output. The full detail is in the [production traces reference](../traces.md), the [observation schema](../reference/observed.md) and the [CLI reference](../reference/cli.md).

## Before you start

**Why you do this.** A test that someone wrote by hand covers the situations that person thought of. A trace covers a situation that really happened. With traces, a test starts from a real conversation, and a new rule can be tried on old conversations at no cost.

**You need.**

- Node 22.13 or newer, and driftbench installed from a clone, as the [guide index](index.md#install) shows. That gives you the command `driftbench`. Run this page from the root of the clone.
- The folder `examples/estates/sessions` of the repository. It holds recorded sessions of a coding agent, made up for the examples. A **session** is the log file one agent run leaves, one JSON line per event.
- The folder `examples/acme` of the repository. Acme is a made-up phone company. Its sales assistant is a small program that costs nothing to run.

One recorded session, `examples/estates/sessions/clean-build.jsonl`, serves most of this page. In it, the agent receives the request "Add a discount field to the invoice total in src/invoice.ts, then run the tests." and does the work.

**Seven words first.**

- A **trace** is the record of what an agent did in one conversation.
- A **turn** is one user message and everything the agent did until the next user message.
- A **tool call** is one use of a tool by the agent, such as reading a file. It keeps the input the agent sent and the output it got.
- A **span** is one timed step inside a trace. A model call is a span. A tool call is a span.
- An **observation** is one span or one log line, kept with the id of the line that started it. Observations form a tree.
- An **observed** record is what driftbench keeps of one block: the reply, the tool calls, the cost, the time.
- A **draft** is a test that driftbench writes from a trace. It has no expectation yet, so it checks nothing.

Three sources feed driftbench, and each one gives the same trace shape.

| Source | What it is | `--from` |
|---|---|---|
| Your agent, run by driftbench | `campaign run` calls the agent and records the observed record of each block | no option, it is automatic |
| A log file of production | OpenTelemetry spans that an agent library wrote, or Nexus platform traces | `otel` or `nexus` |
| A recorded coding session | A Claude Code session log, with its decision log and step feed beside it | `claude-code` |

## 1. Read the trace your own agent leaves

**Why you do this.** Before you import a trace, look at the shape driftbench keeps. Every source ends in this shape. The imported ones are labelled with the same fields.

**You need.** One Acme test and its agent. The test is `examples/acme/specs/conversations/number-porting.yaml`, a customer who keeps a phone number when they switch plans. The target is `function:acme-sales`.

**Relevant commands.**

- `driftbench campaign run`: sends each block of the test to the agent and keeps what the agent did · `examples/acme/specs/conversations/number-porting.yaml` is the test. `--target function:acme-sales` is the agent. `--store trace.db` is the file that keeps the run. `--campaign trace-demo` names the campaign · it prints one line per cell and a count.
- `driftbench report`: writes the stored campaign as a scorecard page · `trace-demo` is the campaign. `--store trace.db` is the file to read. `--out trace.html` is the page to write. `--json` also prints the whole scorecard as JSON, trace included · it prints the JSON and writes `trace.html`.

**You type.**

```console
$ driftbench campaign run examples/acme/specs/conversations/number-porting.yaml --target function:acme-sales --store trace.db --campaign trace-demo
✓ acme-number-porting · function:acme-sales · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench report trace-demo --store trace.db --out trace.html --json
```

**You see.** The first command prints one passing cell. The second prints the scorecard as JSON, a few thousand lines. This is the part of it that holds the trace of block 1, the block where the customer gives a phone number. The agent answered by calling the tool `port.check`:

```text
          "toolCalls": [
            {
              "label": "port.check",
              "input": {
                "number": "+12025550150"
              },
              "output": {
                "number": "+12025550150",
                "eligible": true
              }
            },
```

**How to read it.**

- `label` is the name of the tool. `input` is what the agent sent. `output` is what the tool returned.
- The reply text, the cost, the time and the stage of the block sit beside `toolCalls` in the same record.
- The same record is behind every check. A check such as `tools.port.check.count` reads these lines and does not call the agent.
- Each tool call is also an event with a time. The [viewer](viewer.md) shows these events as a timeline at the top of a run.

**What the observed record holds.** The [schema](../reference/observed.md) names the fields. Unknown keys are refused.

| Field | Meaning |
|---|---|
| `text` | The reply the customer sees, in one string. |
| `segments` | The pieces of the reply in order: text, tool call, tool result, card. |
| `toolCalls` | Each tool the agent used: `label`, `input`, `output`, an `error` when it failed, the start time and the latency. |
| `runtime` | What the agent's runtime did around the reply: skills loaded, guards that fired, stages reached, files read, helpers started. |
| `executions` | Each command the agent ran, with its exit code and a cut of its output. |
| `workspaceDiff` | The files created, changed or deleted during the block. |
| `artifacts` | Files the agent left, with a hash and a size. |
| `cost` | The model, the input and output tokens, and the price in US dollars when known. |
| `latencyMs` | How long the block took, in milliseconds. |
| `retries` | Each retry of a call, with the reason and the wait. |
| `historyNormalizations` | A note when an empty turn is left out of what the model received. |

**If it goes wrong.**

- `No adapter is set up for <target>.` with exit 2: the target is unknown. Type `function:acme-sales` as shown.
- `No store at trace.db: this command reads a store and does not make one.` with exit 2: you ran `report` before `campaign run`, or in another folder.

## 2. Read a recorded session into a draft test

**Why you do this.** A session shows what an agent really did. A draft test replays the user messages of that session. A person then writes what the agent must do.

**You need.** The session `examples/estates/sessions/clean-build.jsonl` and an output folder. Here the folder is `drafts`, made by the command.

**Relevant commands.**

- `driftbench import traces`: reads the traces in a file and writes one draft test per conversation · `examples/estates/sessions/clean-build.jsonl` is the session. `--from claude-code` names the source kind. `--out drafts` is the folder to write · it prints what it read and wrote, and it exits 0.
- `ls`: lists a folder · `drafts` is the folder · it prints the file names.

**You type.**

```console
$ driftbench import traces examples/estates/sessions/clean-build.jsonl --from claude-code --out drafts
Read 1 trace from 1 file (claude-code): 2 turns.
Wrote 1 draft spec to drafts, none approved: 2 blocks, no expect yet.
  Personal data redacted: 0 values.
Next: write each block's expect from the agent spec, then driftbench import approve drafts --all.
$ ls drafts
draft-claude-code-00000000-0000-4000-8000-000000000001.yaml
```

**How to read it.**

- `1 trace ... 2 turns`: the session holds one conversation. The user typed two messages, so it has two turns.
- `2 blocks, no expect yet`: each turn became one block. A block with no `expect` checks nothing.
- `none approved`: a person must review the draft before it counts. Step 4 shows how.
- `Personal data redacted: 0 values`: driftbench removes emails, phones, bank numbers and addresses by default. This session holds none.
- The file name holds the id of the session. The same session always gives the same file.

**If it goes wrong.** Run the same command again:

```console
$ driftbench import traces examples/estates/sessions/clean-build.jsonl --from claude-code --out drafts   # exit 2
drafts/draft-claude-code-00000000-0000-4000-8000-000000000001.yaml already exists: pass --force to replace it (its review is lost).
```

- The draft exists. `--force` replaces it and drops any review you made. Without it, nothing is written.
- `error: --from takes otel, nexus, claude-code` with exit 2: you left out `--from`, or gave another name. Pick one of the three.
- `error: required option '--out <dir>' not specified` with exit 2: add `--out` and a folder.
- `No trace found in <path>.` with exit 2: the path holds no conversation. Nothing is written.

## 3. Read the draft, field by field

**Why you do this.** The draft is the contract between the trace and your tests. You must know which part is the real conversation and which part you still write.

**You need.** The draft of step 2.

**Relevant commands.**

- `cat`: prints a file · the path of the draft, here with a `*` that stands for its one file name · it prints the draft.

**You type.**

```console
$ cat drafts/*.yaml
```

**You see.** The draft is about a hundred lines. This is the part that matters:

```text
blocks:
  - user: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
  - user: Thanks. Now show me the diff summary only.
    given:
      prefix:
        - role: user
          content: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
        - role: assistant
          tool_calls:
            - id: toolu_clean-build_02
              label: Read
              input:
                file_path: /work/acme-shop/src/invoice.ts
      origin: recorded
metadata:
  imported:
    approved: false
    source: claude-code
```

**How to read it.**

- `user` is the message of the turn, the When of the block. Block 0 has no `given`, because it is the first turn.
- `given.prefix` is the conversation before block 1: the first user message, the reply and each tool call with its `input` and `output`.
- `origin: recorded` says the tool calls hold what the tools really returned. An agent trusts a recorded result more than the same fact in prose.
- There is no `expect`. A copy of the observed reply would pass by construction, so a person writes each expectation from the agent's rules.

**What the metadata holds.** The key `metadata.imported` keeps the review state and the facts of the trace.

| Field | Meaning |
|---|---|
| `approved` | `false` until a person approves the draft. |
| `source` | The kind of trace: `otel`, `nexus` or `claude-code`. |
| `trace` | The id of the conversation in the source. |
| `model` | The model the agent used, when the trace names it. |
| `started_at`, `imported_at` | The start of the conversation, and the import time. Both come from the trace. The clock plays no part. |
| `file` | The file the trace came from. |
| `redacted` | `true` when personal data was removed. |
| `observed` | One entry per block: what production did, for your review only. |
| `skipped` | The turns that could not become blocks, each with the reason. |

An `observed` entry holds `block`, the `reply`, the `tools` called with a count, the `cost` in tokens, `latency_ms`, `started_at` and `observation_id`. The last one names the log line the turn started from. Never copy these into an `expect`.

**If it goes wrong.**

- A block you expect is missing: read `skipped` at the end of `metadata.imported`. A turn with no user text is listed there with its reason.
- You see `[ADDRESS_1]` or `[NAME_1]` in the text: that is redaction at work. Step 4 explains it.

## 4. Read a log file from production

**Why you do this.** Your own agent runs in production, and a library such as OpenTelemetry writes its spans to a file. Driftbench reads that file and builds the same draft.

**You need.** A file of spans. This one holds one conversation with two turns. The first turn calls the tool `coverage.check`. Names and emails here are made up. The file follows the GenAI conventions of OpenTelemetry.

```json
// file: traces/acme-chat.json
{
  "resourceSpans": [{
    "resource": { "attributes": [{ "key": "service.name", "value": { "stringValue": "acme-sales" } }] },
    "scopeSpans": [{ "spans": [
      { "traceId": "c1000000000000000000000000000001", "spanId": "c100000000000001", "name": "invoke_agent acme-sales",
        "startTimeUnixNano": "1772445600000000000", "endTimeUnixNano": "1772445603000000000",
        "attributes": [
          { "key": "gen_ai.operation.name", "value": { "stringValue": "invoke_agent" } },
          { "key": "gen_ai.conversation.id", "value": { "stringValue": "conv-demo-1" } }] },
      { "traceId": "c1000000000000000000000000000001", "spanId": "c100000000000002", "parentSpanId": "c100000000000001",
        "name": "chat example-model-1",
        "startTimeUnixNano": "1772445600100000000", "endTimeUnixNano": "1772445601200000000",
        "attributes": [
          { "key": "gen_ai.operation.name", "value": { "stringValue": "chat" } },
          { "key": "gen_ai.conversation.id", "value": { "stringValue": "conv-demo-1" } },
          { "key": "gen_ai.request.model", "value": { "stringValue": "example-model-1" } },
          { "key": "gen_ai.usage.input_tokens", "value": { "intValue": "410" } },
          { "key": "gen_ai.usage.output_tokens", "value": { "intValue": "22" } },
          { "key": "gen_ai.input.messages", "value": { "stringValue": "[{\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"content\":\"Hi, I am Dana Brooks, dana.brooks@example.com. Is home internet available at 3 Orchard Way, Acmeville?\"}]}]" } },
          { "key": "gen_ai.output.messages", "value": { "stringValue": "[{\"role\":\"assistant\",\"parts\":[{\"type\":\"tool_call\",\"id\":\"call_1\",\"name\":\"coverage.check\",\"arguments\":{\"address\":\"3 Orchard Way, Acmeville\"}}]}]" } }] },
      { "traceId": "c1000000000000000000000000000001", "spanId": "c100000000000003", "parentSpanId": "c100000000000001",
        "name": "execute_tool coverage.check",
        "startTimeUnixNano": "1772445601250000000", "endTimeUnixNano": "1772445601400000000",
        "attributes": [
          { "key": "gen_ai.operation.name", "value": { "stringValue": "execute_tool" } },
          { "key": "gen_ai.tool.name", "value": { "stringValue": "coverage.check" } },
          { "key": "gen_ai.tool.call.id", "value": { "stringValue": "call_1" } },
          { "key": "gen_ai.tool.call.arguments", "value": { "stringValue": "{\"address\":\"3 Orchard Way, Acmeville\"}" } },
          { "key": "gen_ai.tool.call.result", "value": { "stringValue": "{\"found\":true,\"fiber_mbps\":300}" } }] },
      { "traceId": "c1000000000000000000000000000001", "spanId": "c100000000000004", "parentSpanId": "c100000000000001",
        "name": "chat example-model-1",
        "startTimeUnixNano": "1772445601450000000", "endTimeUnixNano": "1772445602900000000",
        "attributes": [
          { "key": "gen_ai.operation.name", "value": { "stringValue": "chat" } },
          { "key": "gen_ai.conversation.id", "value": { "stringValue": "conv-demo-1" } },
          { "key": "gen_ai.request.model", "value": { "stringValue": "example-model-1" } },
          { "key": "gen_ai.usage.input_tokens", "value": { "intValue": "520" } },
          { "key": "gen_ai.usage.output_tokens", "value": { "intValue": "40" } },
          { "key": "gen_ai.input.messages", "value": { "stringValue": "[{\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"content\":\"Hi, I am Dana Brooks, dana.brooks@example.com. Is home internet available at 3 Orchard Way, Acmeville?\"}]}]" } },
          { "key": "gen_ai.output.messages", "value": { "stringValue": "[{\"role\":\"assistant\",\"parts\":[{\"type\":\"text\",\"content\":\"Yes: Acme Fiber 300 is available at 3 Orchard Way. Do you want the plan details?\"}]}]" } }] },
      { "traceId": "c2000000000000000000000000000002", "spanId": "c200000000000001", "name": "chat example-model-1",
        "startTimeUnixNano": "1772445670050000000", "endTimeUnixNano": "1772445671500000000",
        "attributes": [
          { "key": "gen_ai.operation.name", "value": { "stringValue": "chat" } },
          { "key": "gen_ai.conversation.id", "value": { "stringValue": "conv-demo-1" } },
          { "key": "gen_ai.request.model", "value": { "stringValue": "example-model-1" } },
          { "key": "gen_ai.usage.input_tokens", "value": { "intValue": "560" } },
          { "key": "gen_ai.usage.output_tokens", "value": { "intValue": "18" } },
          { "key": "gen_ai.input.messages", "value": { "stringValue": "[{\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"content\":\"Yes please, how much is it per month?\"}]}]" } },
          { "key": "gen_ai.output.messages", "value": { "stringValue": "[{\"role\":\"assistant\",\"parts\":[{\"type\":\"text\",\"content\":\"Acme Fiber 300 costs 45 dollars a month. Shall I set up the order?\"}]}]" } }] }
    ] }]
  }]
}
```

**Relevant commands.**

- `driftbench import traces`: as in step 2 · `traces/acme-chat.json` is the file. `--from otel` names the source kind. `--out drafts-otel` is the folder to write · it prints what it read and wrote.

**You type.**

```console
$ driftbench import traces traces/acme-chat.json --from otel --out drafts-otel
Read 1 trace from 1 file (otel): 2 turns.
Wrote 1 draft spec to drafts-otel, none approved: 2 blocks, no expect yet.
  Personal data redacted: 5 values.
Next: write each block's expect from the agent spec, then driftbench import approve drafts-otel --all.
$ cat drafts-otel/*.yaml
```

**You see.** The draft is built from the spans. These are the lines that show the redaction and the link to the log:

```text
  - user: Hi, I am [NAME_1], [EMAIL_1]. Is home internet available at [ADDRESS_1], Acmeville?
              label: coverage.check
              input:
                address: "[ADDRESS_1], Acmeville"
    trace: conv-demo-1
    model: example-model-1
        observation_id: c100000000000002
```

**How to read it.**

- The conversation id `conv-demo-1` joins the two traces into one conversation. The spans of one turn sit in one trace.
- A turn starts at a chat span with a new user message. The tool span `execute_tool coverage.check` became a tool call, matched by the call id `call_1`.
- The name, the email and the address are replaced by placeholders. One value keeps one placeholder in the whole conversation, in the message and in the tool input.
- `Personal data redacted: 5 values` counts each replaced occurrence. Use `--no-redact` only for a private draft, and never commit it to a public repository.
- `observation_id` is the span a block started from. A reviewer can find the source of a block in the log.
- The tokens come from `gen_ai.usage.input_tokens`. A cost needs a price, from the span or from `--prices <file>`.

**Other sources.**

- Libraries that write flat attributes, such as `gen_ai.prompt.0.role`, are read too. The conversation id is then a session id.
- Nexus platform traces use `--from nexus`. They carry no span tree, so they have no observation ids.
- `--select <ids>` drafts only some traces. A single `-` as path reads standard input, for `otel` and `nexus`.

**If it goes wrong.**

- `error: no trace named nope in 1 file: nothing written` with exit 2: an id after `--select` is not in the file. Check the trace ids.
- `Cannot read the traces at <path>` with exit 2: the path does not exist. Check the spelling and the folder.
- `No trace found in <path>.` with exit 2: the file holds no chat span. A conversation with no chat span gives no trace.

## 5. Check the draft and approve it

**Why you do this.** A draft that checks nothing must not count as a test. The lint names the blocks that still need an expectation. Approval is the flag that says a person reviewed the draft.

**You need.** The draft of step 4.

**Relevant commands.**

- `driftbench spec lint`: reads spec files and prints warnings · `drafts-otel` is the folder · it prints one line per warning, and exits 0 for warnings.
- `driftbench import approve`: lists or approves drafts · `drafts-otel` is the folder. `--all` approves every draft in it · without `--all` it lists the drafts not yet approved.
- `grep`: finds a line in a file · `-n` adds line numbers. `approved:` is the text to find · it prints the matching line.

**You type.**

```console
$ driftbench spec lint drafts-otel
  ! blocks.0  BLOCK_NO_EXPECTATION  this block checks nothing
  ! blocks.1  BLOCK_NO_EXPECTATION  this block checks nothing
Checked 1 spec: 1 valid, 0 invalid, 2 warnings.
$ driftbench import approve drafts-otel
1 of 1 drafts are not approved yet:
  drafts-otel/draft-otel-conv-demo-1.yaml
$ driftbench import approve drafts-otel --all
Approved 1 draft of 1.
$ grep -n "approved:" drafts-otel/draft-otel-conv-demo-1.yaml
32:    approved: true
```

**How to read it.**

- `BLOCK_NO_EXPECTATION`: the two blocks check nothing. Write an `expect` for each one, from the rules of your agent. The page [Write tests by hand](write-tests.md) shows how.
- `import approve` without `--all` lists the drafts that wait. It exits 0 either way.
- `--all` sets `approved: true`. You can set it by hand in the file instead.
- Approval records that a person looked at the draft. It does not write the expectations for you.
- Import the same traces again, and the bytes are the same. The time comes from the trace, so the clock plays no part. With `--dataset <name> --store <file>` the drafts become a version of a dataset, and unchanged traces push no new version.

**If it goes wrong.**

- `import approve` exits 1 when a file is not an imported draft. Give the folder of drafts.
- `Cannot find <path>.` with exit 2: the path is missing. Check the folder name.

## 6. Replay a session against a rule, with no agent call

**Why you do this.** You write a new rule, such as "the agent never creates a file". You want to know whether old sessions break it. Replay runs the checks on the recorded session, so the agent runs zero times.

**You need.**

- The session `examples/estates/sessions/clean-build.jsonl`, with its decision log `clean-build.decisions.jsonl` and its step feed `clean-build.steps.jsonl`. The decision log says which guards fired. The step feed says which stages the agent reached.
- The test `examples/estates/sessions/specs/clean-build.yaml`. It names the session in `metadata.replay.session`, and lists what must hold.

**Relevant commands.**

- `driftbench replay`: runs the checks of a test folder on recorded sessions · `examples/estates/sessions/clean-build.jsonl` is the session. `--suite examples/estates/sessions/specs/clean-build.yaml` is the test. `--decisions` and `--steps` name the two side files. `--store replay.db` keeps the run · it prints one line per test, and exits 1 when a test fails.
- `driftbench campaign status`: reads the stored run again · `--store replay.db` is the file · it prints the cell and the count.

**You type.**

```console
$ driftbench replay examples/estates/sessions/clean-build.jsonl --suite examples/estates/sessions/specs/clean-build.yaml --decisions examples/estates/sessions/clean-build.decisions.jsonl --steps examples/estates/sessions/clean-build.steps.jsonl --store replay.db
✓ replay-clean-build  session clean-build from block 0 (metadata)
$ driftbench campaign status --store replay.db
✓ replay-clean-build · claude-code:clean-build · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `✓ replay-clean-build`: the session satisfies every expectation of the test. The agent loaded the right skill first, read the file before it changed it, and ran the tests.
- `from block 0 (metadata)`: the test found its session through `metadata.replay`. Without that key, tests and sessions pair by order.
- `Spent $0.00`: no model was called. A judge model runs only if you pass `--judge`.
- The last line of `replay` also prints a campaign id. It changes at each run, so this page does not show it.

**Now try a stricter rule.** Copy the test, and add `Write` to the tools that the agent must never use. The session wrote a test file, so it must now fail.

```console
$ mkdir stricter
$ sed 's/forbidden_tools: \[WebFetch\]/forbidden_tools: [WebFetch, Write]/' examples/estates/sessions/specs/clean-build.yaml > stricter/clean-build.yaml
$ grep -n "forbidden_tools" stricter/clean-build.yaml
11:  forbidden_tools: [WebFetch, Write]
$ driftbench replay examples/estates/sessions/clean-build.jsonl --suite stricter --decisions examples/estates/sessions/clean-build.decisions.jsonl --steps examples/estates/sessions/clean-build.steps.jsonl --store replay2.db   # exit 1
✗ replay-clean-build  session clean-build from block 0 (metadata)
    failing: block 0: forbidden.Write
$ driftbench campaign status --store replay2.db   # exit 1
✗ replay-clean-build · claude-code:clean-build · F · repeat 0  fail  block 0 forbidden.Write
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `failing: block 0: forbidden.Write`: the check `forbidden.Write` fails on block 0. The session called `Write` once, so the new rule rejects it.
- Only the rule changed. The session is the same bytes, so the difference is the rule and nothing else.
- Run this on every old session you keep. The sessions that fail show you what the new rule would have caught, before you change the agent.

**If it goes wrong.** Leave out the two side files, and the test cannot see the guards and the stages:

```console
$ driftbench replay examples/estates/sessions/clean-build.jsonl --suite examples/estates/sessions/specs/clean-build.yaml   # exit 1
note: replay-clean-build expects guards, but no decision log was given for clean-build: no guard was seen
note: replay-clean-build expects stages, but no step feed was given for clean-build
✗ replay-clean-build  session clean-build from block 0 (metadata)
    failing: block 1: flow.stage
```

- A `note:` line says what the test expects and the missing file. Give `--decisions` or `--steps` with one file per session, matched by file name.
- A test whose session you did not give is skipped, with a `note:` line.
- A judged criterion with no `--judge` is inconclusive, and it gates as the criterion says. It never counts as a pass.

## What you have now

- The shape of a trace: a reply, tool calls with inputs and outputs, cost, time, and a tree of observations.
- Draft tests from a recorded session and from a log file, with personal data removed and every block linked to its source.
- A way to try a new rule on old sessions with `replay`, at no cost.

To go further, see the [production traces reference](../traces.md) for `monitor --source traces`, which watches cost, latency and tool errors over time windows of your logs. The page [The viewer and scorecards](viewer.md) shows a run as a timeline. The page [Write tests by hand](write-tests.md) turns a draft into a test with expectations.
