# Nexus API fixtures

Response shapes of the Nexus public API v1, as the nexus adapter reads them. The field names, the nesting
and the value types are the platform's. Every id, name and text is fictional: one Acme Telecom turn, where
the customer asks about 3 Orchard Way and the agent calls `coverage.check`, then `catalog.search`, then
answers.

Each file holds the raw HTTP answer: `{ "success": true, "data": ..., "meta": ... }`. The CLI prints it with
`success` removed; its SDK unwraps `data` and `meta` from this envelope, and so does the adapter.

| File | Route | Shape from |
|---|---|---|
| `tracing-traces.json` | `GET /tracing/traces?conversationId=<chat id>` | read live, CLI 1.11.0 |
| `tracing-trace.json` | `GET /tracing/traces/:traceId` | read live, CLI 1.11.0 |
| `tracing-generations.json` | `GET /tracing/generations?traceId=<trace id>` | read live, CLI 1.11.0 |
| `tracing-generation-1.json` to `-3.json` | `GET /tracing/generations/:generationId` | read live, CLI 1.11.0 |
| `emulator-session.json` | `GET /emulator/:deploymentId/sessions/:sessionId` | read live, CLI 1.11.0 |
| `workflow-executions.json` | `GET /workflows/executions?workflowId=<stub id>` | read live, CLI 1.11.0 |
| `workflow-execution.json` | `GET /workflows/executions/:executionId` | read live, CLI 1.11.0 |
| `golden-conversation.create.json` | `POST /prompt-eval/golden-conversations` | published response contract |
| `golden-conversation.turn-user.json` | `POST /prompt-eval/golden-conversations/:id/turns/user` | published response contract |
| `golden-conversation.generate.json` | `POST /prompt-eval/golden-conversations/:id/generate` | published response contract and the CLI help |
| `golden-conversation.accept.json` | `POST /prompt-eval/golden-conversations/:id/accept` | published response contract |
| `golden-conversation.delete.json` | `DELETE /prompt-eval/golden-conversations/:id` | published response contract |
| `error.json` | any failing route | the error envelope the CLI's SDK parses |

"Read live" means read-only commands (`nexus tracing traces|trace|generations|generation`, `nexus emulator
session get`, `nexus execution list|get`, `nexus api GET ...`) on 2026-10-11, with every key set and value
type compared against these files. The organization read held no golden conversation, and creating one was
out of bounds, so those five files follow the response contract the CLI 1.11.0 ships (`V1_RESPONSE_CONTRACT`)
and the notes of `nexus eval conv generate --help`. Three values there were not observed: the `role` of a
turn, the shape of `candidate.tokensUsed` (taken from the emulator's `{ input, output, total }`), and how a
tool error reads inside a `tool_result` block.

What the live captures showed, and the adapter relies on:

* A turn's traces are found by the emulator session's `chatId`, passed as `conversationId`; the session id
  itself matches no trace.
* A generation's `responseJson` is in the OpenAI shape: `content` (a string, or null) and `tool_calls` with
  `function.name` and `function.arguments` as JSON text. Its `messages` are in content blocks: `text`,
  `thinking`, `tool_use`, `tool_result`.
* A tool call's `id` equals the `tool_use_id` of the `tool_result` block the next generation received; the
  result is a `text` block holding JSON.
* A trace can end on a generation whose `finishReason` is `tool_use` (seen with `end_conversation`), so its
  last calls may have no `tool_result` in the trace. The adapter then takes their output from the candidate.
* A stub workflow's execution holds the tool input as `triggerData`, with `triggerType` `AGENT_INPUT`, and no
  field that names the conversation.
