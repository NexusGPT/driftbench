# @agent-nexus/driftbench-judges

Judge clients, the judge council, calibration, the prompt kit and cassettes for judged criteria in driftbench.

Part of [driftbench](https://github.com/achammah/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

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

The full list of exports is in the type declarations (`dist/index.d.ts`).

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
fingerprint, and recordings preserve the complete ledger.

## Opt-in conformance judging

`judgeConformance` audits one criterion against a trusted transcript and a separate reference. It uses
the frozen conformance prompt from [PR 109](https://github.com/achammah/driftbench/pull/109), verbatim.
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

## Documentation

[Judges](https://github.com/achammah/driftbench/blob/main/docs/concepts/judges.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

Apache-2.0
