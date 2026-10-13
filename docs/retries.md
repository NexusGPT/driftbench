# Retries

Model APIs fail for a moment: a rate limit, an overloaded provider, a dropped connection. driftbench retries these failures under one shared policy, in every place that calls a model or an agent: the runner around every adapter call, the adapters that call a model themselves, and the judge clients. A run never retries an answer it did not like, and every retry is recorded.

## What is retried

Only a transient failure:

| Failure | Retried |
|---|---|
| HTTP 408 (Request Timeout) | yes |
| HTTP 429 | yes |
| any HTTP 5xx, an overloaded 529 included | yes |
| a network error: refused, reset, unreachable, timed out, aborted, `fetch failed` | yes |
| any other status, 409 included | no |
| an `AgentFailure`: the agent itself failed | no |
| a transport error an adapter already retried in full (`exhausted`) | no: the runner does not retry it again |

The status is read where each SDK puts it (`status`, `statusCode`, `response.status`). A network error is told by its name or code, or those of its causes.

## The policy

Waits grow exponentially from a base, up to a cap, drawn at random below the backoff (full jitter), and never shorter than what the server asked in its `retry-after-ms` or `Retry-After` header (seconds or an HTTP date). A Retry-After longer than `max_delay_ms` ends the retries at once rather than wait past the cap.

| Setting | Spec key | Default |
|---|---|---|
| attempts per call, the first included | `max_attempts` | 4 |
| the wait before the first retry; each later retry doubles it | `base_delay_ms` | 500 |
| the longest wait between two attempts | `max_delay_ms` | 30000 |
| draw each wait at random below the backoff | `jitter` | true |
| wait at least the server's Retry-After | `retry_after` | true |

## Setting it

In a spec, on the target:

```yaml
target:
  adapter: anthropic
  retry:
    max_attempts: 6
    base_delay_ms: 1000
```

On the command line, for `campaign run` and `campaign resume`, over the spec's settings:

```sh
driftbench campaign run specs/ --target function:acme --retry-attempts 6 --retry-base-ms 1000 --retry-max-ms 60000
```

From code, `runSpec` and `runCampaign` take `retry` (`maxAttempts`, `baseDelayMs`, `maxDelayMs`, `jitter`, `retryAfter`, and `sleep` and `random` for tests). The order is: the defaults, then the spec target's `retry`, then the run's settings. The runner hands the resolved policy to the adapter on each block (`turn.retry`), so an adapter that calls a model itself retries under the same settings.

The judge clients take `retry` in their options (`createAnthropicJudge({ retry: { maxAttempts: 6 } })`); `maxRetries` still works and means attempts minus one.

## Where the retries happen

| Where | What is retried |
|---|---|
| the runner | each `open`, `send` and `trace` call of any adapter, when it throws an `AdapterTransportError` |
| anthropic, google, litellm | each model call inside the agent loop, so a retry never runs the block's tools again; the SDK client's own retries are turned off for the call where the SDK allows it (`maxRetries: 0`) |
| vercel-ai | each `doGenerate` of the model, through a wrapper; `generateText` runs with `maxRetries: 0` |
| http, nexus | the runner retries their 408, 429, 5xx and network failures |
| openai-agents, langgraph, crewai, pydantic-ai | the runner retries the block when the framework's failure is transient; the framework's own retries stay as configured |
| the judge clients | each provider call |

A retried block on an adapter whose framework runs tools may run those tools again. The payload log of every SDK adapter is kept by block, so a retried block replaces its own entries.

## What is recorded

Each retry is a `RetryEvent`: the call, the attempt that failed, the status when there was one, the reason, the wait, the Retry-After when the server sent one, and the time. A block's retries, the adapter's own and the runner's, are in its Observed as `retries`, kept in the run record. A judge's retries are in its vote as `retries`. A block replayed from the cache reports none: a replay retries nothing.

This is the first block of a run of the Acme `plan-upgrade` spec, under the default policy, on an agent whose transport answered a 429 asking for 1.2 seconds, then a 529 (`run.blocks[0].observed.retries`, real output):

```json
[
  {
    "call": "send on block 0",
    "attempt": 1,
    "status": 429,
    "reason": "AdapterTransportError: overloaded",
    "delayMs": 1200,
    "retryAfterMs": 1200,
    "at": "2026-10-12T00:18:45.484Z"
  },
  {
    "call": "send on block 0",
    "attempt": 2,
    "status": 529,
    "reason": "AdapterTransportError: overloaded",
    "delayMs": 83,
    "at": "2026-10-12T00:18:46.709Z"
  }
]
```

The first wait is the server's Retry-After, longer than the 500 ms backoff; the second is drawn at random below the doubled backoff of 1000 ms. The run completed its 5 blocks.

## In code

`@agent-nexus/driftbench-core` exports the policy for any client: `retrying(call, run, { policy })` runs a call under it, `retryPolicy(...layers)` builds a policy, `retryDecision(error)` says whether an error is retried, `collectRetries(work)` gathers the retries made inside `work`, and `RetryEvent` is the record's schema.

Not covered yet: the model port that `driftbench generate` and `extract` use keeps its own retry loop (two retries, 408 and 409 included).
