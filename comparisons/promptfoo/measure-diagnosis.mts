// Diagnosis for rows 9, 10 and 16. When a check fails, does its evidence name the closest span of the reply and say what
// differs? Counted over every failing verdict on fictional cases. Ours: the must check (contains family) and the budget
// check (cost and latency). Promptfoo: the reason on its own failing assertion.
// Writes out/diagnosis.json and prints one example of each side. No model calls.
// Run from the repository root: npx tsx comparisons/promptfoo/measure-diagnosis.mts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budget } from '../../packages/checks/src/checks/budget';
import { must } from '../../packages/checks/src/checks/must';
import { mulberry32 } from '../../packages/stats/src/index';
// @ts-expect-error the installed package ships compiled JavaScript without declarations
import * as pf from './node_modules/promptfoo/dist/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GIVEN = { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'function' }, hash: 'diag' };
const rng = mulberry32(90);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
const WORDS = [
  'Fiber',
  'fiber',
  'Mobile',
  'mobile',
  'plan',
  'Plan',
  'order',
  'ORDER',
  'price',
  'Price',
  'Acme Care',
  'Sunday',
];
const SENTENCES = [
  'Our Fiber plan starts at 25 EUR.',
  'The mobile order is confirmed.',
  'We have a Mobile plan and a FIBER plan.',
  'Your price is listed below.',
  'nothing to see here',
  'ORDER placed; the price is fixed.',
  'Call Acme Care for help.',
];

function ourMust(source: string, text: string, ignoreCase: boolean) {
  const block = { expect: { must: [source] } };
  const spec = { id: 'diag', version: '1', title: 'diag', blocks: [block], rules: {} };
  const observed = {
    segments: [{ type: 'text', text }],
    text,
    toolCalls: [],
    cost: { usd: 0 },
    latencyMs: 0,
  };
  void ignoreCase;
  return must.evaluate({
    spec,
    mode: 'F',
    blockIndex: 0,
    block,
    expect: block.expect,
    given: GIVEN,
    observed,
    history: [],
    ledger: {},
  } as never) as Promise<Array<{ outcome: string; evidence: string }>>;
}

function ourBudget(limits: Record<string, number>, cost: number, latency: number) {
  const block = { expect: {}, budget: limits };
  const spec = { id: 'diag', version: '1', title: 'diag', blocks: [block], rules: {} };
  const observed = {
    segments: [{ type: 'text', text: 'ok' }],
    text: 'ok',
    toolCalls: [],
    cost: { usd: cost },
    latencyMs: latency,
  };
  return budget.evaluate({
    spec,
    mode: 'F',
    blockIndex: 0,
    block,
    expect: {},
    given: GIVEN,
    observed,
    history: [],
    ledger: {},
  } as never) as Promise<Array<{ outcome: string; evidence: string }>>;
}

const containsRows: Array<{ word: string; text: string; ours: string[]; theirs: string[] }> = [];
const ourFailures: string[] = [];
let oursNamingSpan = 0;
let oursFailTotal = 0;
for (let i = 0; i < 120; i++) {
  const word = pick(WORDS);
  const text = pick(SENTENCES);
  const verdicts = await ourMust(word, text, true);
  for (const v of verdicts.filter((v) => v.outcome === 'fail')) {
    oursFailTotal += 1;
    ourFailures.push(v.evidence);
    if (/closest/.test(v.evidence)) oursNamingSpan += 1;
  }
  if (verdicts.some((v) => v.outcome === 'fail') && containsRows.length < 3) {
    const r = await pf.assertions.runAssertion({
      assertion: { type: 'contains', value: word },
      test: { vars: {}, assert: [] },
      providerResponse: { output: text },
      prompt: '',
      vars: {},
    });
    containsRows.push({
      word,
      text,
      ours: verdicts.filter((v) => v.outcome === 'fail').map((v) => v.evidence),
      theirs: [String(r.reason)],
    });
  }
}

let theirsFailTotal = 0;
let theirsNamingSpan = 0;
for (let i = 0; i < 120; i++) {
  const word = pick(WORDS);
  const text = pick(SENTENCES);
  const r = await pf.assertions.runAssertion({
    assertion: { type: 'icontains', value: word },
    test: { vars: {}, assert: [] },
    providerResponse: { output: text },
    prompt: '',
    vars: {},
  });
  if (r.pass === true) continue;
  theirsFailTotal += 1;
  if (/closest/.test(String(r.reason))) theirsNamingSpan += 1;
}

let oursBudgetFail = 0;
let oursBudgetSpan = 0;
const budgetExamples: string[] = [];
for (let i = 0; i < 120; i++) {
  const cost = Number((rng() * 0.1).toFixed(4));
  const latency = Math.round(rng() * 4000);
  const verdicts = await ourBudget({ cost_usd: 0.05, latency_ms: 2000 }, cost, latency);
  for (const v of verdicts.filter((v) => v.outcome === 'fail')) {
    oursBudgetFail += 1;
    if (/over by/.test(v.evidence)) oursBudgetSpan += 1;
    if (budgetExamples.length < 2) budgetExamples.push(v.evidence);
  }
}
const theirsBudgetExample = await pf.assertions
  .runAssertion({
    assertion: { type: 'latency', threshold: 2000 },
    test: { vars: {}, assert: [] },
    providerResponse: { output: 'ok' },
    latencyMs: 3000,
    prompt: '',
    vars: {},
  })
  .then((r: { reason: string }) => r.reason)
  .catch((e: Error) => `(${e.message})`);

const out = {
  rows: '9 and 10 (contains family, must)',
  ours: { failingVerdicts: oursFailTotal, namingClosestSpan: oursNamingSpan },
  theirsIcontains: { failingAssertions: theirsFailTotal, namingClosestSpan: theirsNamingSpan },
  row16: {
    ours: { failingVerdicts: oursBudgetFail, sayingHowFarOver: oursBudgetSpan },
    theirsLatencyExample: theirsBudgetExample,
  },
  examples: {
    containsFailures: containsRows,
    mustEvidence: ourFailures.slice(0, 2),
    budgetEvidence: budgetExamples,
  },
};
await mkdir(join(HERE, 'out'), { recursive: true });
await writeFile(join(HERE, 'out', 'diagnosis.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
