# Adapters

The [README](../README.md#adapters) lists the adapters. This page adds how to write one and the other extension points.

An adapter is the one piece of code between driftbench and your agent: it opens a session, sends a block, and returns what the agent did. Thirteen ship today in `@agent-nexus/driftbench-adapters`, and every one passes the same [contract suite](adapters/index.md#the-contract-suite).

| Reach your agent as | Adapter |
|---|---|
| A function in your process | [function](adapters/function.md) |
| An HTTP endpoint | [http](adapters/http.md) |
| A command, in a sandbox with a workspace | [process](adapters/process.md) |
| An SDK agent | [OpenAI Agents](adapters/openai-agents.md) · [Anthropic](adapters/anthropic.md) · [Google](adapters/google.md) · [LangGraph](adapters/langgraph.md) · [CrewAI](adapters/crewai.md) · [Vercel AI SDK](adapters/vercel-ai.md) · [Pydantic AI](adapters/pydantic-ai.md) · [LiteLLM](adapters/litellm.md) |
| A code agent, replayed or live | [Claude Code](adapters/claude-code.md) |
| A hosted agent platform | [Nexus](adapters/nexus.md) |

A minimal complete adapter is the `functionAdapter` of [Evaluate your own agent](recipes.md#evaluate-your-own-agent): a dozen lines around your function. To write one from scratch, implement the [contract](adapters/index.md#the-contract): `open`, `send` and `close`.

## The other extension points

| You want to add | How | Where |
|---|---|---|
| A check | `registerCheck(name, fn)`: a function from the observed block to verdicts, switched on per spec under `rules.custom` | [custom checks](reference/checks.md#custom-checks) |
| A judge | A client with one method that answers a judge request; clients for OpenAI, Anthropic, Google and HTTP ship | [judge clients](concepts/judges.md#judge-clients) |
| A criterion | One YAML file: a rubric, a pass transcript, a fail transcript | [criteria folders](concepts/judges.md#criteria-folders-and-fixture-pairs) |
| A similarity model | `denseEmbedder({ id, embed })`: one call from texts to vectors | [similarity](reference/checks.md#similarity-relevancy-and-knowledge-retention) |
| A file reader for artifacts | A reader per file kind; spreadsheets, documents, decks and PDF ship | [artifacts](reference/checks.md#code-files-and-workspace) |
| A map of situations | A YAML file of dimensions, values and constraints, proposed by `extract` or written by hand | [the map](generating.md#the-map-of-situations) |
| A store or a report | Runs live in one SQLite file with a versioned JSON export; reports are HTML, JUnit XML and JSON | [the store](running.md#the-store) · [scorecards](scorecards.md) |
