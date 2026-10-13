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

## Documentation

[Judges](https://github.com/achammah/driftbench/blob/main/docs/concepts/judges.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

Apache-2.0

## Pointwise fact ledger (opt-in)

For factual replies with a trusted reference, pass `assessment: { kind: 'fact-ledger' }`
and `reference` in a `JudgeRequest`, without `candidates`. The model reports facts;
code passes only when every fact is `match` and `unsupported` is empty. The default
judge is unchanged. Add `grounding: 'strict'` inside `assessment` to reject copied
text that cannot be grounded in its reference or reply.

See the [API and recorded results](https://github.com/achammah/driftbench/blob/main/docs/concepts/judges.md#pointwise-fact-ledger-against-a-trusted-reference).
