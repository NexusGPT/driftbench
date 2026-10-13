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
references do not establish identification.
Relevance does not prove factual truth or real execution. Sources and execution receipts are required
only when the user asks for them.

The strict `ResponseRelevanceAnswer` schema contains a nonempty `checks` array. Each check has
`obligation`, `requestQuote`, `reasoning`, `answerQuote` and `met`. Quotes must match their selected
source: `requestQuote` in the latest user entry and `answerQuote` in the final agent reply. A true
check requires an answer quote; false and null checks may use null. Matching tolerates presentation
formatting and whitespace through the existing quote matcher. Code rejects repeated obligations,
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

## Documentation

[Judges](https://github.com/achammah/driftbench/blob/main/docs/concepts/judges.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

Apache-2.0
