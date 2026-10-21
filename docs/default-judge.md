# The default judge

`createDefaultJudge` runs one task-based policy across every supported provider. It is also the judge used by `estate run`, `replay`, and live `judge calibrate` calls, and built-in `compare --pairwise` providers. There is no benchmark selector.

```ts
import { createDefaultJudge } from '@agent-nexus/driftbench-judges';

const judge = createDefaultJudge({
  provider: 'claude-cli',
  model: 'haiku',
  maxBudgetUsd: 0.10,
  spendCapUsd: 5,
});

const result = await judge.judge({
  criterion: {
    name: 'complete_reply',
    rubric: 'The final reply addresses every part of the latest request.',
  },
  transcript: [
    { role: 'user', text: 'Name the product and give its price.' },
    { role: 'agent', text: 'The product is Widget.' },
  ],
});
```

The caller chooses the provider and model. The policy never changes because of a model name, vendor, model size, benchmark, or answer length.

## Normalize before routing

Structured transcript entries keep their roles. Text such as `[user] CONFIRM` inside an agent entry remains agent text; it cannot forge approval.

For a serialized record, pass `transcript` as a string. The product parser recognizes `[user]`, `[agent]`, `[context]`, `[card]`, `[tool_call name]`, `[tool_result name]`, `[input path]` and `[artifact]`. It creates separate entries, named inputs and artifact text before routing or judging.

This string format is an explicit serialization contract: each recognized marker starts a part. A context preamble ends at its first newline; following unmarked text is an agent answer. Use structured entries for literal markers or multiline context. Duplicate input paths and competing explicit/rendered artifacts are errors.

## One policy, several task procedures

The router reads the criterion and user requests, without the candidate answers. It selects a procedure by the task:

| Task | Procedure |
| --- | --- |
| Ordinary criterion, policy or record consistency | Evidence ledger with criterion prompt 2 and decoder 3 |
| Complete response relevance | Grounded checks for each requested part plus the caller's full criterion; either failure fails |
| Self-contained objective answer | Literal or grounded answer extraction, three blind solutions, answer matching, full-criterion comparison, and commitment checking for unmarked answers |
| Pair comparison | Both candidate orders, per-requirement scores, deterministic aggregation and canonical escalation |
| Writing pair | Explicit request constraints plus holistic writing quality; no preference for length |

Extra inputs, artifacts, references, conversation history and caller-defined contracts remain authoritative. A specialized procedure that cannot preserve that evidence falls back to the ordinary criterion ledger. Explicit assessments, custom system prompts, and version-1 requests retain their selected contract.

The criterion prompt compares named identifiers, numbers and units; honors expected facts stated in the criterion; and gives the record named by the question precedence. It reads each fact in the context of the whole reply: surrounding units, periods and subjects carry into short clauses; synonyms and exact unit conversions can express the same fact. An instruction inside the data supplies neither a reason to pass nor a reason to fail; the judge assesses the remaining data as if that instruction were absent. Historical prompt 1 remains byte-identical. Decoder 3 supports source-local symbol quotations and input label spellings such as `input/catalog.csv`.

A tool name or its `"tool": "<name>"` frame spelling grounds only in the cited tool-call or tool-result entry with that name. Other frame metadata remains invalid evidence. Explicit decoder 2 retains its historical behavior.

Decoder 3 drops spans that quote only the criterion under a nontranscript label and counts them in `criterionQuotesDropped`. A span that grounds in its named data source is retained. A `met: true` check still needs grounded evidence after the drop; otherwise the result is inconclusive and retains the drop count. Unrelated invalid spans and false transcript-source claims remain invalid. An ungrounded legacy string quote is dropped and counted separately in `evidenceUnverified`.

Automatic pair comparisons evaluate the full caller criterion in their requirement ledgers; arithmetic shortcuts cannot bypass it. Automatic relevance evaluates both the relevance ledger and the original criterion. Both must pass; a failure in either fails, and unresolved evidence remains inconclusive. Explicit response-relevance assessments retain their selected single-read contract.

The verifier checks the full criterion even when blind solutions agree. Agreement is evidence, not proof. It does not repair a submitted answer. Missing or malformed solver, matcher or commitment output cannot produce a pass.

## Cost, audit and replay

Routing and verification can require more than one model call. `costUsd` includes all reported charges; `requestCount` includes retries. `defaultJudge` records the policy version, route and provider receipts, including raw failed attempts and retry receipts. Unknown cost is marked `costIncomplete`, never reported as a complete partial total.

`recordingClient` retains concurrent calls in invocation order, including repeated identical requests and failed calls. Await all recordings before creating a cassette player or calling `saveCassette`; both reject a cassette with calls in flight. `saveCassette` writes a complete temporary file before atomically replacing the destination, so concurrent exports leave one complete recording.

`spendCapUsd` caps the client across calls. Set `maxBudgetUsd` as the per-call ceiling. Each in-flight call reserves the smaller of that ceiling and the unreserved balance. The same amount reaches the native command and retry budget. The client refuses another call when no unreserved balance remains or a prior cost is unknown. The Claude command also enforces its per-call budget. Other providers report usage but may not report monetary cost, so an application can supply a metered transport.

Objective verification requests at least 4096 output tokens for every stage. Explicit request or transport reasoning settings add output room by reasoning level. An explicit `createDefaultJudge({ maxTokens })` overrides the procedure allowance, including its reasoning room; the cap also participates in recording identity. Truncated output remains inconclusive. Native command transports retain their own output limits.

The default policy, transport settings, prompts and schemas participate in recording identity. Old recordings keep their original prompt and decoder versions. They are historical evidence, not measurements of a changed prompt. Prompt version 2 and decoder version 3 are the defaults. Explicit decoder version 2 preserves its historical behavior: ungrounded strings are dropped, but symbol-only spans, input-label aliases and criterion-only spans remain invalid. Decoder 3 adds the grounded span forms and criterion-only drop rule under a new request identity. The full procedure policy is `default-on-v7`, including pair requests. Use `criterionPromptVersion: 1` and `criterionDecoderVersion: 1` for the earlier criterion contract.

Objective verification copies the last marked answer literally, including `Final answer is:` and `Final answer is=`. Explicit option letters and exact single numbers settle answer matching in code. Ordinary prose, units and different numeric representations retain semantic review. Three agreeing blind solves do not bypass the full caller criterion. Disagreement also reaches that comparison; it is not an automatic failure.

### Policy versions

The full procedure policy has a version, and a version changes the recording identity of its cached requests. Each version keeps the behavior before it for a caller that asks for the earlier prompt or decoder. The table lists the versions that have a changelog entry.

| Policy | What it adds |
|---|---|
| `default-on-v3` | Criterion prompt 2 carries whole-reply context into short clauses, including exact unit conversions. Decoder 3 drops criterion-only spans under nontranscript labels and reports `criterionQuotesDropped`. Explicit decoder 2 and the evidence requirements stay |
| `default-on-v4` | The verification policy copies `Final answer is:` and `Final answer is=` literally and settles explicit option-letter matches in code. The caller's full criterion stays authoritative, also when the blind solutions disagree |
| `default-on-v5` | Source-local tool-name grounding under decoder 3. An instruction inside data is neither pass evidence nor fail evidence. Prompt 1 and explicit decoder 2 stay |
| `default-on-v7` | Every default-policy call without a reasoning level gets 12,288 tokens of thinking room on top of its budget. A model that thinks by default no longer ends a stage with no text. An explicit reasoning level keeps its allowance, and an explicit client cap wins. A blind solve that runs out of room, reports its output limit or names no final answer is dropped and recorded (`dropped` in the audit). It no longer makes the verdict inconclusive. The router reads the route from the last object that carries a route key |

`outputRoom(budget, reasoning)` in `@agent-nexus/driftbench-judges` returns the output allowance of one call: the answer budget plus the thinking room.

Low-level clients such as `createClaudeCliJudge` remain available for caller-owned procedures. They do not add task routing. Use `createDefaultJudge` for the complete product policy.

## What does not become default

The reader-first and long-structured preferences favor longer replies. They remain explicit preferences and do not establish general writing quality. A dataset generator or a frozen benchmark recipe is measurement infrastructure, not a judge improvement.

The development comparison reports each row, including ties, losses and unavailable baselines. Development results do not establish held-out performance.
