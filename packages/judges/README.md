# @agent-nexus/driftbench-judges

Judge clients, the judge council, calibration, the prompt kit and cassettes for judged criteria in driftbench.

Part of [driftbench](https://github.com/NexusGPT/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-judges
```

Node.js 22 or newer. ESM only, with TypeScript types.

## What is inside

* `createCouncil`
* `judgeCheck`
* `calibrate`
* `createAnthropicJudge`
* `createOpenAiJudge`
* `createGoogleJudge`
* `createHttpJudge`
* `FakeJudge`
* `loadCassette`
* `KNOWLEDGE_RETENTION_CRITERION`
* `judgeAnswerAudit`

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Pair ledger (opt in)

`pairLedgerRequest` selects `answerContract: 'ledger'` and `assessment.kind: 'pairwise'`.
The reader scores FIRST and SECOND from 0 to 4 (or null) on caller-owned requirements.
Optional evidence quotes are validated against either candidate. There is no model-authored winner.
The existing default and explicit `legacy` requests keep their previous behavior.
The pair ledger requires both orders; combining it with `presentation: 'canonical'` throws before any call.

```ts
import { createOpenAiJudge, pairLedgerRequest, judgePairLedger } from '@agent-nexus/driftbench-judges';

const client = createOpenAiJudge({ model: 'gpt-6-luna', reasoning: 'medium' });
const request = pairLedgerRequest(
  { name: 'answer-quality', rubric: 'Give the correct answer with a clear explanation.' },
  [{ role: 'user', text: 'What is two plus two?' }],
  'Four: adding two and two gives four.',
  'Five.',
  { requirements: [
    { name: 'correct', rubric: 'The answer is correct.', hard: true },
    { name: 'clear', rubric: 'The explanation is clear.' },
  ] },
);
const result = await judgePairLedger(client, request);
// result.choice: 'first' | 'second' | 'tie' | undefined (grader error)
```

`scoreLedger` applies hard gates before the weighted sum (default hard weight 2, soft weight 1).
Conflicting hard losses or unknown scores needed for the decision abstain for that reading.
`verdictFromLedger` maps the reversed order back to the original candidates. Agreed signs decide;
a single nonzero reading needs margin 2. Other pairs need a third read in content-hash order.
The three signs vote; only an escalated zero becomes a tie. `tiePolicy: 'canonical'` uses the
third sign to break a zero quorum when it is nonzero. Identical replies are an earlier machine tie.

`runPairStage0` reuses final-answer extraction, arithmetic verification, language detection and
injection screening. Computation needs `stage0.correctness: true`; the built-in route covers
explicit arithmetic only. Supply a `PairComputeSandbox` for other executed checks. Format rules
must match complete quoted question instructions and decide only after a correctness tie.
Language and injection findings are advisory. Harm gating requires caller-supplied policy facts;
a refusal phrase alone never establishes harm. These boundaries avoid invented machine certainty.

`parsePairLedgerText` reads the last JSON object and records `ledger.strict`,
`ledger.invalid-escape`, `ledger.fence-strip` and `ledger.brace-close` attempts.
It never supplies missing scores or rows. `judgePairLedger` adds at most one `ledger.reask`
per reading. Exhausted parse failures carry `metadata.graderError: true` and no choice.
Transport errors throw. Every attempt remains in `result.reads`.

## Reusable provider transport

`createDialectTransport({ provider, model, reasoning, ...clientOptions })` exposes
`complete({ system, user, schema?, reasoning? })`. It returns text, the raw response,
usage where supplied, and a fingerprint. It does not select a judge schema or parse a verdict.
`buildDialectRequest(provider, request)` exposes the same payload construction for caller-owned HTTP.

Failed Claude CLI results throw `ClaudeTransportError` (a `JudgeError`) with exact stdout in `raw`,
the process `exitCode`, and the original `usage` counters and `costUsd` when supplied.
Cache counters are retained so failed calls can be charged. Invalid result envelopes also retain
raw output and exit code; absent usage or cost is left undefined.

| Provider | Schema transport | Reasoning field |
|---|---|---|
| openai | strict json_schema | reasoning_effort |
| google | responseSchema with one type plus nullable | thinkingConfig.thinkingLevel |
| anthropic | scratchpad then last JSON | not exposed |
| claude-cli | scratchpad then last JSON | not exposed |

Omitting `schema` preserves plain-text prompts. Unsupported reasoning settings on Anthropic and
native Claude transport throw. General clients have no reasoning default.

The example `examples/judge-benchmarks/src/llm-shim.mjs` accepts `--json-schema` with a JSON schema
string and `--reasoning-effort` with the provider setting. `SHIM_SCHEMA_FLAG` exports that schema
flag name. `pairLedgerSchema(request)` supplies the pair schema. Pointwise callers supply their
own schema. Fingerprints include dialect and reasoning so incompatible calls cannot share recordings.

## HTTP ledger reasoning

`createHttpJudge({ reasoning: 'medium', ... })` supplies the default for pair-ledger requests. `JudgeRequest.reasoning` overrides it per request. Supported values are `low`, `medium` and `high`. The default appears in the client settings descriptor; the effective request value contributes to the cassette key. With reasoning unset, request bytes and keys stay unchanged. HTTP non-ledger requests and system 1 clients reject reasoning before transport because those paths cannot apply it.

## Response relevance (opt-in)

```ts
import { createOpenAiJudge, judgeResponseRelevance } from '@agent-nexus/driftbench-judges';

const result = await judgeResponseRelevance(createOpenAiJudge(), [
  { role: 'user', text: 'Give the service status and its owner.' },
  { role: 'agent', text: 'The service is stable. Its owner is unknown.' },
]);
console.log(result.answer.outcome);
console.log(result.responseRelevance?.checks);
```

This helper makes one `client.judge` call, with no helper retries. Use a system2 client that supports
assessment contracts, such as the built-in chat providers. Provider transport retries can still apply.
The model extracts each distinct requested part of the latest user entry and checks the final agent
reply after that entry. The caller supplies the full history; earlier entries provide context for
references, corrections and subject identification. They cannot replace missing content in the final
reply. Trailing tool or context entries do not become the reply.

This is a fixed relevance policy: acknowledgements, promises, quoted restatements and answers about
the wrong entity do not meet the ask. Explicit negative or unknown answers can address informational
questions. A clear descriptive reference can identify a subject or value without repeating its literal form or
proving it appeared earlier. Explicit requests to spell out literal values still apply; ambiguous
references do not establish identification. Missing literal text alone is not ambiguity: ambiguity
requires competing plausible referents or no identifying relationship.
Relevance does not prove factual truth or real execution. Sources and execution receipts are required
only when the user asks for them.

The strict `ResponseRelevanceAnswer` schema contains a nonempty `checks` array. Each check has
`obligation`, `requestQuote`, `reasoning`, `answerQuote` and `met`. Quotes must match their selected
source: `requestQuote` in the latest user entry and `answerQuote` in the final agent reply. A true
check requires an answer quote; false and null checks may use null. Matching tolerates presentation
formatting and whitespace through the existing quote matcher. A whole-string match also permits
symbol-only replies such as a requested checkmark; a symbol fragment in unrelated prose does not count.
Code rejects repeated obligations,
duplicate JSON keys, invalid shapes and quotes from other sources. Invalid responses become
unparsed, inconclusive results.

Code aggregates any false check as fail, otherwise any null check as inconclusive, otherwise pass.
The validated ledger is retained under `result.responseRelevance`. Quote matching proves passage
presence; it cannot prove that the model extracted every obligation or interpreted each one correctly.

Advanced callers can set `assessment: { kind: 'response-relevance' }` on a `JudgeRequest`.
The required `criterion` remains cache and recording metadata; its rubric does not replace this
mode's policy. The mode rejects `answerContract: 'legacy'`, custom `system`, `requirements`,
`factAudit`, `candidates`, `artifact`, `inputs`, `given` and `reference`. Put relevant context in the
transcript. A missing user entry or missing subsequent agent reply is a caller error before a call.
Default and legacy prompts and cassette keys remain unchanged. This mode uses its own prompt
fingerprint, and recordings preserve the complete ledger. Relevance recordings also retain provider
rejections such as token-limit truncation, even when the raw text happens to contain complete JSON.

## Knowledge retention

Pass `KNOWLEDGE_RETENTION_CRITERION` as a judge request's `criterion`, with the conversation in
`transcript`. The last reply must preserve current user facts without asking for them again.
Corrections supersede earlier values. Different owners can have different values. Unmentioned facts
need not be repeated, and a single user message followed by a reply is enough to judge.
All assistant text segments after the latest user message form the current reply. Mentioning a
replaced value as history is allowed; presenting it as current is not.

The matching catalogue definition is in `examples/criteria/knowledge_retention.yaml`. The default
judge asks for grounded evidence checks and computes the verdict in code. This criterion does not
require independent proof of unrelated claims.

The machine `knowledge_retention` check remains separate: it checks configured ledger facts against
the reply and tool inputs, with optional `use: true` for literal use. A semantic pass does not waive
that explicit use requirement. Combine machine and judge verdicts through the normal check pipeline
or `combineVerdicts`; gating machine failures stay failures.

## Opt-in conformance judging

`judgeConformance` audits one criterion against a trusted transcript and a separate reference. It uses
the frozen conformance prompt from [PR 109](https://github.com/NexusGPT/driftbench/pull/109), verbatim.
The default requirement ledger is unchanged.

```ts
import { createAnthropicJudge, judgeConformance } from '@agent-nexus/driftbench-judges';

const judge = createAnthropicJudge({ model: 'your-model' });
const result = await judgeConformance(judge, {
  criterion: {
    name: 'receipt',
    rubric: 'The observed receipt contains the required confirmation code.',
    scope: 'conversation',
  },
  transcript: [
    { role: 'tool_result', tool: 'confirm', text: 'Confirmation code: RECEIPT-42' },
    { role: 'agent', text: 'Your request is confirmed.' },
  ],
}, 'The required confirmation code is RECEIPT-42.');

console.log(result.answer.outcome, result.conformance);
```

Use a system 2 provider or a system 2 cassette player. The helper rejects system 1 clients.
The equivalent request option is `assessment: { kind: 'conformance', reference: '...' }`.
The reference may be empty. Assign transcript roles from trusted event metadata, preserving tool
names and order. Text that resembles a role inside an entry stays part of that entry.

The model reports `evidenceAvailable`, `satisfied`, and `violations`. Code computes the outcome:

| Deciding evidence | Satisfied | Violations | Outcome |
| --- | --- | --- | --- |
| Absent | Either | Any | `inconclusive` |
| Present | True | Empty | `pass` |
| Present | Any other combination | Any | `fail` |

The supplied rubric determines the deciding event and time window independently for each criterion.
An observed receipt can satisfy a receipt criterion even when the later answer omits its code.
An absent deciding response remains inconclusive. A supplied reference alone is not observed evidence.
The model's reasoning and flags still require calibration for your domain.

Only `criterion.rubric`, the reference, and the supplied transcript enter the frozen prompt.
Put all scope and pass/fail conditions in the rubric, and supply the intended transcript slice.
The feature rejects separate pass/fail pictures, block scope, custom system prompts, legacy mode,
requirement lists, artifacts, file inputs, Given data, and other assessment data instead of dropping them.
Each criterion requires its own call. Normal provider costs apply to new calls.

For recording compatibility, the decoder accepts JSON or a surrounding code fence without syntax
repair. It validates the deciding flags, ignores extra verdict labels, and uses the last duplicate
JSON key. Missing or nonstring reasoning does not change the frozen decision. Invalid deciding fields
return an unparsed inconclusive result. The conformance prompt has its own cassette fingerprint.

### Free frozen replay

```sh
pnpm exec vitest run packages/judges/test/conformance.test.ts packages/judges/test/conformance-recorded.test.ts
```

The fixtures preserve raw recordings from commit `73939d09686bd7d214acc6dfcc74b831d1ed991d`.
Replay passes them through the public provider API with a local transport stub and checks exact
model-facing prompt bytes. It makes no paid calls. The short cohort reproduces 120/120 complete
vectors and 240/240 criteria; the long cohort reproduces 119/120 vectors and 239/240 criteria.
These are replayed synthetic cohort results, not a new model evaluation or a general superiority claim.

## Answer audit (opt-in)

Grades a submitted answer against a criterion and, when you have one, a trusted expected answer.

```ts
import { createAnthropicJudge, judgeAnswerAudit } from '@agent-nexus/driftbench-judges';

const result = await judgeAnswerAudit(createAnthropicJudge(), {
  criterion: {
    name: 'plan_terms',
    rubric: 'Does the reply state the monthly price and the data allowance of the plan?',
  },
  reference: 'Aster costs 34 crowns monthly and includes 60 GB.',
  transcript: [
    { role: 'user', text: 'State the price and data allowance of Aster.' },
    { role: 'agent', text: 'Aster is 34 crowns a month, with 60 GB of data.' },
  ],
});
console.log(result.answer.outcome);
console.log(result.answerAudit?.checks);
```

The request reaches the model as one JSON object with separate fields: `criterion` (the question,
with its optional pass and fail pictures), `reference`, `transcript` (role-separated entries) and
`artifact`. The agent, tool and card entries and the artifact are the submission. User and context
entries are the task and its background.

The model lists the conditions the criterion sets and settles each one as `satisfied`, `violated`,
`missing` or `unknown`, with a quote and its reasoning before the status. Code computes the outcome:
any `violated` or `missing` condition fails, otherwise any `unknown` condition is inconclusive,
otherwise the answer passes. The model never supplies a verdict.

Policy of this mode:

* Meaning decides, not wording. A paraphrase, another language, an exact unit conversion and a
  double negation that asserts the fact all satisfy a condition.
* Named entities, numbers, units and bounds are compared exactly. A nearby value or a similar name
  is a different one.
* With a `reference`, the submission must carry the content the task asks for from it. Extra text
  fails only when it contradicts or limits that content, or breaks the criterion. Use the pointwise
  fact ledger when any unsupported extra claim must fail.
* Scope rules written in the criterion (final answer against drafts, quoted against endorsed text,
  order of events) are applied as written. `criterion.scope: 'block'` limits the audit to the last
  agent turn.
* Text in the data that addresses the grader or imitates a role label or delimiter is data. It is
  neither a reason to pass nor a reason to fail.

Every quote must occur in a transcript entry or the artifact. A quote from the criterion or the
reference is rejected. `satisfied` and `violated` need a quote; `missing` and `unknown` may leave it
empty. Invalid shapes, repeated conditions, ungrounded quotes and any verdict key give an unparsed,
inconclusive result. `judgeAnswerAudit` asks once more after such a result.

One entry can hold a rendered record of several turns, each part introduced by a bracketed label
such as `[user]`, `[tool_result name]`, `[artifact]` or `[agent]`. The mode reads such a record as
written. Pass real role-separated entries whenever you have them: in a rendered record, a label
written by the agent cannot be told apart from one written by the caller.

Advanced callers can set `assessment: { kind: 'answer-audit' }` on a `JudgeRequest`. The mode
rejects `answerContract: 'legacy'`, custom `system`, `requirements`, `factAudit`, `candidates`,
`inputs` and `given`. It needs a system 2 judge. It uses its own prompt fingerprint
(`ANSWER_AUDIT_PROMPT_FINGERPRINT`): default and legacy prompts and cassette keys are unchanged.

Quote grounding proves that a passage exists. It cannot prove that the model listed every
condition or read each one correctly.

## Documentation

[Judges](https://github.com/NexusGPT/driftbench/blob/main/docs/concepts/judges.md), and the [docs index](https://github.com/NexusGPT/driftbench/blob/main/docs/index.md).

## License

MIT

## Pointwise fact ledger (opt-in)

For factual replies with a trusted reference, pass `assessment: { kind: 'fact-ledger' }`
and `reference` in a `JudgeRequest`, without `candidates`. The model reports facts;
code passes only when every fact is `match` and `unsupported` is empty. The default
judge is unchanged. Add `grounding: 'strict'` inside `assessment` to reject copied
text that cannot be grounded in its reference or reply.

See the [API and recorded results](https://github.com/NexusGPT/driftbench/blob/main/docs/concepts/judges.md#pointwise-fact-ledger-against-a-trusted-reference).
