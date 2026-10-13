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
* `KNOWLEDGE_RETENTION_CRITERION`

The full list of exports is in the type declarations (`dist/index.d.ts`).

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

## Documentation

[Judges](https://github.com/achammah/driftbench/blob/main/docs/concepts/judges.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

Apache-2.0
