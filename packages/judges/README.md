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

## Pair ledger (opt in)

`pairLedgerRequest` selects `answerContract: 'ledger'` and `assessment.kind: 'pairwise'`.
The reader scores FIRST and SECOND from 0 to 4 (or null) on caller-owned requirements.
Optional evidence quotes are validated against either candidate. There is no model-authored winner.
The existing default and explicit `legacy` requests keep their previous behavior.

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
native Claude transport throw. General clients have no reasoning default. The optional
`FROZEN_BENCHMARK_REASONING` map fixes gpt-6-luna and gemini-3.8-flash to `medium` for both
contestants on every benchmark row; native Haiku and Jev settings are unset.

The example `examples/judge-benchmarks/src/llm-shim.mjs` accepts `--json-schema` with a JSON schema
string and `--reasoning-effort` with the provider setting. `SHIM_SCHEMA_FLAG` exports that schema
flag name. `pairLedgerSchema(request)` supplies the pair schema. Pointwise callers supply their
own schema. Fingerprints include dialect and reasoning so incompatible calls cannot share recordings.

## Documentation

[Judges](https://github.com/achammah/driftbench/blob/main/docs/concepts/judges.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

Apache-2.0
