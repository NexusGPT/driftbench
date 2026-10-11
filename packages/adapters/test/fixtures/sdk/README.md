# SDK adapter fixtures

Fakes and recorded exchanges for the four SDK adapters: openai-agents, anthropic, google and langgraph. No test here reaches a network, holds a key or makes a paid call. Every value is fictional Acme Telecom data from `examples/acme`.

## The fakes

| File | What it plays |
|---|---|
| `acme-model.ts` | The Acme sales agent as a model. A fake turns its request into customer turns, and `nextAction` answers with the next tool call or the reply, from the Acme policy. Earlier turns replay from the tool results in the conversation, so a tool never runs twice for a past turn. |
| `acme-tools.ts` | The five Acme tools as SDK tools over a fresh store per session, what a developer hands the anthropic and google adapters. |
| `anthropic.ts` | `messages.create` in the Messages API shape. It refuses a request the API would refuse: roles that do not alternate, a tool name outside `^[a-zA-Z0-9_-]{1,64}$`, a `tool_use` not answered first thing in the next message, an empty text block. |
| `google.ts` | `models.generateContent` in the Gemini shape. It signs each function call as Gemini 3 does and refuses a current turn that sends a signed call back without its signature. |
| `openai-agents.ts` | `Runner.run`: it runs the agent's tools on the agent's own store and returns the new items in the SDK's shapes. Tools are named as an OpenAI agent names them, with no dot (`coverage_check`). |
| `langgraph.ts` | A compiled ReAct graph: an agent node, a tools node, and with `checkpointed` a `MemorySaver`-like checkpointer that `getState` reads and `deleteThread` clears. |

Each fake has a dead twin whose transport fails the way its SDK reports it, and a `recorded*` twin that answers with recorded answers in order.

## The recorded exchanges

`recorded/` holds what the real SDK packages produced on 2026-10-11, run in a scratch folder outside this repository with fake transports in place of the network: the anthropic and google clients with a fake `fetch`, the OpenAI Agents `Runner` with a fake `Model`, a LangGraph `StateGraph` with a real `ToolNode` and `MemorySaver`. The answers come from the fakes above; the shapes are the SDKs' own.

| File | SDK | Holds |
|---|---|---|
| `anthropic-coverage.json` | `@anthropic-ai/sdk` 0.133.0 | the three request bodies the client sent and the three `Message` answers, for the coverage question |
| `google-coverage.json` | `@google/genai` 2.28.0 | the three REST bodies the client sent (`config` moved to the top, the system instruction as a content) and the answers |
| `openai-agents-runs.json` | `@openai/agents` 0.20.0 | four runs: tool calls, a handoff, the block after it on the agent taking over, and an input guardrail tripwire (`thrown`) |
| `langgraph-coverage.json` | `@langchain/langgraph` 1.4.21, `@langchain/core` 1.2.17 | the thread's messages as `JSON.stringify` writes them (LangChain's constructor form) |

The same run also passed `adapterContract` for each adapter on the real SDK objects. To record again, install those versions in a folder outside the repository, run the four adapters against them with fake transports, and copy the new captures here. The SDKs are never a dependency of this repository.
