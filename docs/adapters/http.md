# http adapter

Status: planned, phase 1.

The http adapter reaches an agent behind an HTTP endpoint that speaks JSON in the OpenAI-compatible chat shape: the conversation so far goes in as a list of messages, and the reply comes back with its tool calls.

## Contract as designed

* `open` builds the message list from the block's prefix.
* `send` adds the stimulus, posts the messages, and turns the reply and its tool calls into segments.
* Keys come from the environment, never from a spec.
* It passes the same contract tests as every adapter. See [adapters](index.md).

The settings it reads from `target.options` are fixed when the adapter ships.

## Target

```yaml
target:
  adapter: http
  agent: support-bot
```
