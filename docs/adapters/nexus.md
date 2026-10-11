# nexus adapter

Status: planned, phase 1.

The nexus adapter reaches an agent on the Nexus platform. It is one adapter among others; the core never imports it.

## Contract as designed

* `send` generates the agent's turn under the prompt variant named in `target.variant`, with the agent's tools live.
* `trace` reads the whole turn from the platform's tracing: every text segment in order, every tool call with its input and output, tokens, cost and latency per segment. The block's text is built from these segments, so text the agent sends before a tool call is kept.
* `endState` reads the payload a recording stub received. The stub stands in for a tool with side effects, so a run submits nothing for real, and the `end_state` check compares that payload with the spec.
* Emulator sessions serve manual checks.
* In teacher-forced mode, the adapter can use the platform's own golden conversations. Planned, phase 3.
* It passes the same contract tests as every adapter. See [adapters](index.md).

## Target

```yaml
target:
  adapter: nexus
  agent: sales-agent
  variant: candidate
  deployment: web-chat
```

The meaning of `agent`, `variant` and `deployment` is fixed when the adapter ships.
