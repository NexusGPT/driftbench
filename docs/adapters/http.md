# http adapter

Status: shipped, phase 1. It passes the [contract suite](index.md#the-contract-suite) in chat mode, against a local endpoint that answers with the Acme example agent.

The http adapter reaches an agent behind an HTTP endpoint that speaks JSON. Each block is one POST with the conversation so far in the OpenAI-compatible chat shape. The endpoint answers with an Observed, or with an OpenAI-compatible chat completion.

From the command line, a spec whose target is `http:<agent>` with `options.url` reaches this adapter with no code: see [targets from settings](../running.md#targets-from-settings).

## CLI target credential handling

::: warning Successful replies and sensitive stores
A successful reply is stored as the agent sent it, except for the redactions described here. The CLI scans for literal keys, percent, base64, base64url and hex encodings, and all 16 ordered two-level compositions of those encodings, including `base64(percent(key))`. It also scans the encoded `Bearer <key>` forms. A key echoed in another form can remain in results. Keys split across fields are not detected; deeper or unlisted encodings are outside this protection. Use a test-scoped key and treat the results store and cache as sensitive.
:::

**CLI error-path guarantee:** with `target.options.debug_error_body` absent or false, upstream error bodies, headers and thrown transport details never enter output or storage. Diagnostics contain only fixed messages, status, request host and body length when known. `debug_error_body: true` is an explicitly unsafe opt-in to error-body disclosure. This guarantee belongs to the CLI target wrapper; directly constructing the library adapter does not install that wrapper.

## Options

```ts
import { httpAdapter } from '@agent-nexus/driftbench-adapters';

const adapter = httpAdapter({
  url: 'http://localhost:8080/turn',
  headers: { authorization: `Bearer ${process.env.SUPPORT_BOT_TOKEN}` },
  endStateUrl: 'http://localhost:8080/end-state',
  closeUrl: 'http://localhost:8080/close',
});
```

| Option | Meaning |
|---|---|
| `url` | the endpoint that answers one block |
| `headers` | headers sent with every request |
| `endStateUrl` | where end states are read; it enables `endState` |
| `closeUrl` | told when a session closes |
| `capabilities` | what the endpoint honours: `variants`, `toolStubs`, `deterministic`. Each defaults to false. |
| `timeoutMs` | the most milliseconds one request may take. Default 120000. |
| `maxToolRounds` | the most rounds of tool calls a chat completion may ask for in one block. Default 8. |
| `fetch` | the fetch to use. Default the global fetch. |

Keys come from the environment, never from a spec: build `headers` from your environment, as above. The adapter reads no `target.options`; it sends the whole target to the endpoint. An error message names the method, the URL, the status and the start of the body, never a header.

## The request

One `POST <url>` per block, with `content-type: application/json`. The fields:

* `session`: the session id.
* `turn`: the block's position in the run, from 0.
* `model`: `target.agent`, when it is set, for an endpoint that picks a model or an agent by name.
* `messages`: the session history as the runner left it, ending with the block's user messages, in the chat shape.
* `stimulus`, `world`, `vars` and `target`: the block's stimulus, its resolved world and variables, and the target.

An assistant message that recorded tool calls becomes three parts, in the order they happened: an assistant message with `tool_calls` and no content, one `tool` message per call holding the JSON of its output (or `{"error": "..."}` for an error), then the assistant's reply text.

The body of the second block of an Acme conversation, as the adapter posted it to a local endpoint:

```json
{
  "session": "cf1c56e5-256c-4efa-97b8-5b45453654c4",
  "turn": 1,
  "model": "acme-sales",
  "messages": [
    {
      "role": "user",
      "content": "Hi, do you have home internet at 3 Orchard Way, Acmeville?"
    },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call-1",
          "type": "function",
          "function": {
            "name": "coverage.check",
            "arguments": "{\"address\":\"3 Orchard Way, Acmeville\"}"
          }
        },
        {
          "id": "call-2",
          "type": "function",
          "function": {
            "name": "catalog.search",
            "arguments": "{\"category\":\"home\",\"address_id\":\"addr-102\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call-1",
      "content": "{\"found\":true,\"address_id\":\"addr-102\",\"address\":\"3 Orchard Way, Acmeville\",\"fiber_mbps\":300,\"five_g\":true}"
    },
    {
      "role": "tool",
      "tool_call_id": "call-2",
      "content": "{\"plans\":[{\"id\":\"fiber-300\",\"name\":\"Acme Fiber 300\",\"category\":\"home\",\"monthly_usd\":40,\"speed_mbps\":300,\"access\":\"fiber\"},{\"id\":\"air-5g\",\"name\":\"Acme Air 5G\",\"category\":\"home\",\"monthly_usd\":35,\"speed_mbps\":200,\"access\":\"5g\"}]}"
    },
    {
      "role": "assistant",
      "content": "Hi, I'm the Acme Telecom sales assistant. Good news: 3 Orchard Way, Acmeville has fiber up to 300 Mbps. Plans available there: Acme Fiber 300, 300 Mbps for $40 a month; Acme Air 5G, up to 200 Mbps for $35 a month. Which one would you like: Acme Fiber 300 or Acme Air 5G?"
    },
    {
      "role": "user",
      "content": "Acme Fiber 300, please."
    }
  ],
  "stimulus": {
    "user": "Acme Fiber 300, please."
  },
  "world": {},
  "vars": {
    "channel": "chat"
  },
  "target": {
    "adapter": "http",
    "agent": "acme-sales"
  }
}
```

## The response

A response with status 200 holds one of two shapes.

1. An Observed, recognised by `segments`. `text`, `toolCalls`, `cost` and `latencyMs` may be left out: the adapter fills them with the text segments joined by a newline, the calls paired with their results, no cost, and the measured round trip. Then it validates the whole.
2. An OpenAI-compatible chat completion, recognised by `choices`. The content of `choices[0].message`, a string or text parts, becomes a text segment, and `usage.prompt_tokens` and `usage.completion_tokens` become the tokens. When the message asks for `tool_calls`, the adapter answers each call from `world.tools` (its `result` or its `error`, with `latency_ms` kept), adds the assistant and `tool` messages, and posts again. It stops when a completion asks for no tool, and fails after `maxToolRounds` rounds. A call to a tool that `world.tools` gives no result or error fails the block. Each round's latency and tokens sit on its first segment, so the segments add up to the block.

## Errors

| What happens | Error |
|---|---|
| no connection, a timeout, a body that breaks off, status 408, 429 or any 5xx | `AdapterTransportError` with the status and the `Retry-After` wait: the runner retries under the [shared policy](../retries.md) |
| any other failing status, a body that is not a JSON object, a body of neither shape | `AgentFailure`: the run fails |

## End state and close

* `endState(session, source)` posts `{ session, source }` to `endStateUrl` and reads `{ state }` from the answer. A 404 reads undefined.
* For source `*` the state is the list of every payload, as `{ tool, input }`. A 404 or an answer with no state reads an empty list; a state that is not a list fails the block.
* `close` posts `{ session }` to `closeUrl`, when it is set.

## Capabilities and version

`seedPrefix` is on: the endpoint receives the whole history. `endState` is on when `endStateUrl` is set. `variants`, `toolStubs` and `deterministic` are as declared. `trace` and `sandbox` are off.

The version is `<adapter version>+<hash of url>`, using the exported `HTTP_ADAPTER_VERSION` and the content hash of `url`. The same URL gives the same version; different URLs give different versions, so two endpoints never share a cache entry.

## Target

```yaml
target:
  adapter: http
  agent: support-bot
```

`agent` becomes `model` in the request. The endpoint receives the whole target and decides what `variant`, `deployment` and `options` mean.

With a prompt on the target (`campaign run --prompt`), the request's `target.prompt` holds it, and `messages` starts with a system message of its text, for both response shapes. See [datasets](../datasets.md#the-prompt-reaches-the-agent).
