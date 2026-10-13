// Deterministic comparison rows against promptfoo 0.124.1 (MIT), on fictional cases with labels fixed by construction.
// Rows: 7 markup validity, 8 regex, 9 contains family, 10 icontains family, 11 equals, 12 starts-with, 16 cost and latency.
// Run from the repository root: npx tsx comparisons/promptfoo/measure-deterministic.mts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budget } from '../../packages/checks/src/checks/budget';
import { exact } from '../../packages/checks/src/checks/exact';
import { markup } from '../../packages/checks/src/checks/markup';
import { must } from '../../packages/checks/src/checks/must';
import { regex } from '../../packages/checks/src/checks/regex';
import { startsWith } from '../../packages/checks/src/checks/starts_with';
import { mulberry32 } from '../../packages/stats/src/index';
// @ts-expect-error the installed package ships compiled JavaScript without declarations
import * as pf from './node_modules/promptfoo/dist/src/index.js';
import { summarise } from './summary.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GIVEN = { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'function' }, hash: 'cmp' };

type Case = {
  text: string;
  value?: unknown;
  threshold?: number;
  cost?: number;
  latency?: number;
  truth: boolean;
};
type Side = { correct: number; n: number; interval: [number, number] };

async function theirs(
  type: string,
  value: unknown,
  c: Case,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const result = await pf.assertions.runAssertion({
    assertion: { type, value, ...extra },
    test: { vars: {}, assert: [] },
    providerResponse: { output: c.text, cost: c.cost ?? 0 },
    latencyMs: c.latency ?? 0,
    prompt: '',
    vars: {},
  });
  return result.pass === true;
}

async function ours(
  run: 'must' | 'regex' | 'exact' | 'markup' | 'starts' | 'budget',
  expect: Record<string, unknown>,
  c: Case,
  rules: Record<string, unknown> = {},
): Promise<boolean> {
  const checks: Record<string, any> = { must, regex, exact, markup, starts: startsWith, budget };
  const check = checks[run];
  const block = { expect, budget: expect.budget as never };
  const observed = {
    segments: [{ type: 'text', text: c.text }],
    text: c.text,
    toolCalls: [],
    cost: { usd: c.cost ?? 0 },
    latencyMs: c.latency ?? 0,
  };
  const spec = { id: 'cmp', version: '1', title: 'cmp', blocks: [block], rules };
  const ctx = {
    spec,
    mode: 'F',
    blockIndex: 0,
    block,
    expect,
    given: GIVEN,
    observed,
    history: [],
    ledger: {},
  } as never;
  if (!check.applies(ctx)) return false;
  const verdicts: Array<{ outcome: string }> = await check.evaluate(ctx);
  return verdicts.length > 0 && verdicts.every((verdict) => verdict.outcome === 'pass');
}

let rng = mulberry32(1);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

// Row 7: markup validity (xml, html, sql). Valid and broken forms built from templates; label = intended validity.
function markupCases(): Array<{ kind: 'xml' | 'html' | 'sql'; c: Case }> {
  rng = mulberry32(7);
  const out: Array<{ kind: 'xml' | 'html' | 'sql'; c: Case }> = [];
  const tags = ['plan', 'name', 'price', 'data', 'item'];
  const sqlValid = [
    `SELECT name FROM plans WHERE price > 20;`,
    `INSERT INTO orders (plan, status) VALUES ('Mobile L', 'open');`,
    `UPDATE plans SET price = 25 WHERE id = 3;`,
    `DELETE FROM sessions WHERE expired = 1;`,
  ];
  const sqlInvalid = [
    `SELCT * FROM plans;`,
    `SELECT * FROM plans WHERE name = 'Mobile L;`,
    `INSERT INTO orders VALUES (1;`,
    `UPDATE plans SET;`,
  ];
  for (let i = 0; i < 2000; i++) {
    const valid = Math.floor(i / 3) % 2 === 0;
    const kind = (['xml', 'html', 'sql'] as const)[i % 3] as 'xml' | 'html' | 'sql';
    if (kind === 'xml') {
      const t = pick(tags);
      const u = pick(tags);
      const text = valid ? `<${t}><${u}>Mobile L</${u}></${t}>` : `<${t}><${u}>Mobile L</${t}>`;
      out.push({ kind, c: { text, truth: valid } });
    } else if (kind === 'html') {
      const text = valid ? `<div><p>Fiber<br>5G</p><img src="x.png"></div>` : `<div><span>Fiber</div>`;
      out.push({ kind, c: { text, truth: valid } });
    } else {
      out.push({ kind, c: { text: valid ? pick(sqlValid) : pick(sqlInvalid), truth: valid } });
    }
  }
  return out;
}

// Row 8: regex. Pattern and reply; label = a case-sensitive JavaScript match, the flagless reading.
const REGEX_PATTERNS = [
  'fiber \\d+ ?Mbps',
  'ORD-\\d{6}',
  'Acme\\s+Care',
  '\\+1 202 555 \\d{4}',
  'sales advisor',
  '^Hi',
];
const REGEX_PHRASES = [
  'Fiber 100 Mbps is available',
  'fiber 100Mbps',
  'Your order is ORD-123456',
  'order ord-123456',
  'Call Acme Care',
  'call ACME CARE',
  'Hi there',
  'hi there',
  'Reach a sales advisor',
  'Reach a SALES ADVISOR',
  'Call +1 202 555 0100',
  'nothing relevant here',
];

function regexCases(): Array<{ pattern: string; c: Case }> {
  rng = mulberry32(8);
  const out: Array<{ pattern: string; c: Case }> = [];
  for (let i = 0; i < 120; i++) {
    const pattern = pick(REGEX_PATTERNS);
    const phrase = pick(REGEX_PHRASES);
    const truth = new RegExp(pattern).test(phrase);
    out.push({ pattern, c: { text: phrase, truth } });
  }
  return out;
}

// Rows 9 and 10: contains (one word), contains-all (two words), contains-any (two words). Case-sensitive (9) and case-insensitive (10).
const WORDS = ['Fiber', 'fiber', 'Mobile', 'mobile', 'plan', 'Plan', 'order', 'ORDER', 'price', 'Price'];
const SENTENCES = [
  'Our Fiber plan starts at 25 EUR.',
  'The mobile order is confirmed.',
  'We have a Mobile plan and a FIBER plan.',
  'Your price is listed below.',
  'nothing to see here',
  'ORDER placed; the price is fixed.',
];

function containsCases(
  insensitive: boolean,
): Array<{ kind: 'contains' | 'all' | 'any'; words: string[]; c: Case }> {
  rng = mulberry32(insensitive ? 10 : 9);
  const out: Array<{ kind: 'contains' | 'all' | 'any'; words: string[]; c: Case }> = [];
  const has = (text: string, word: string) =>
    insensitive ? text.toLowerCase().includes(word.toLowerCase()) : text.includes(word);
  for (let i = 0; i < 120; i++) {
    const kind = (['contains', 'all', 'any'] as const)[i % 3] as 'contains' | 'all' | 'any';
    const words = kind === 'contains' ? [pick(WORDS)] : [pick(WORDS), pick(WORDS)];
    const text = pick(SENTENCES);
    const truth = kind === 'any' ? words.some((w) => has(text, w)) : words.every((w) => has(text, w));
    out.push({ kind, words, c: { text, truth } });
  }
  return out;
}

// Row 11: equals against a reference. Strict truth = identical text; loose truth = equal after case, punctuation and spacing are dropped.
function equalsCases(): Array<{ reference: string; c: Case; loose: boolean }> {
  rng = mulberry32(11);
  const reference = 'Mobile L, 25 EUR a month.';
  const out: Array<{ reference: string; c: Case; loose: boolean }> = [];
  const loose = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const variants = [
    reference,
    reference.toLowerCase(),
    'Mobile L 25 EUR a month',
    'Mobile L, 25 EUR a month',
    'Mobile S, 19 EUR a month.',
    'Mobile L, 25 EUR a month. Anything else?',
  ];
  for (let i = 0; i < 120; i++) {
    const text = pick(variants);
    out.push({ reference, c: { text, truth: text === reference }, loose: loose(text) === loose(reference) });
  }
  return out;
}

// Row 12: starts-with. Truth = the reply, without leading space, starts with the text (case-sensitive).
const PREFIXES = ['Hi', 'Sure', 'Thanks for', 'Yes,'];
const STARTS = [
  'Hi, I am Sam.',
  'Sure, here is the plan.',
  ' Thanks for calling.',
  'Yes, the order is placed.',
  'Well, hi there.',
  'sure thing',
  'Sure.\nHi, I am Sam.',
  '  Yes, confirmed.',
];

function startsCases(): Array<{ prefix: string; c: Case }> {
  rng = mulberry32(12);
  const out: Array<{ prefix: string; c: Case }> = [];
  for (let i = 0; i < 2000; i++) {
    const prefix = pick(PREFIXES);
    const text = pick(STARTS);
    out.push({ prefix, c: { text, truth: text.replace(/^\s+/, '').startsWith(prefix) } });
  }
  return out;
}

// Row 16: cost and latency bounds. Truth = the observed cost (or latency) is at or under the bound.
function costCases(): Array<{ kind: 'cost' | 'latency'; bound: number; c: Case }> {
  rng = mulberry32(16);
  const out: Array<{ kind: 'cost' | 'latency'; bound: number; c: Case }> = [];
  for (let i = 0; i < 120; i++) {
    const kind = i % 2 === 0 ? 'cost' : 'latency';
    const bound = kind === 'cost' ? 0.05 : 2000;
    const value = kind === 'cost' ? Number((rng() * 0.1).toFixed(4)) : Math.round(rng() * 4000);
    out.push({
      kind,
      bound,
      c: {
        text: 'ok',
        cost: kind === 'cost' ? value : 0,
        latency: kind === 'latency' ? value : 0,
        truth: value <= bound,
      },
    });
  }
  return out;
}

const results: Record<string, unknown> = {};

{
  const rows = [];
  for (const { kind, c } of markupCases()) {
    const type = kind === 'xml' ? 'is-xml' : kind === 'html' ? 'is-html' : 'is-sql';
    rows.push({
      truth: c.truth,
      a: await theirs(type, undefined, c),
      b: await ours('markup', { markup: kind }, c),
    });
  }
  results.row7 = summarise('7 markup validity (xml, html, sql)', rows, ['theirs', 'ours']);
}
{
  const rows = [];
  for (const { pattern, c } of regexCases()) {
    rows.push({
      truth: c.truth,
      a: await theirs('regex', pattern, c),
      b: await ours('regex', { regex: [pattern] }, c),
    });
  }
  results.row8 = summarise('8 regex (ours: expect.regex, case-sensitive)', rows, ['theirs', 'ours']);
  const rowsMust = [];
  for (const { pattern, c } of regexCases()) {
    rowsMust.push({
      truth: c.truth,
      a: await theirs('regex', pattern, c),
      b: await ours('must', { must: [pattern] }, c),
    });
  }
  results.row8_must_ignores_case = summarise(
    '8 regex (ours: expect.must, case-insensitive, for reference)',
    rowsMust,
    ['theirs', 'ours'],
  );
}
for (const insensitive of [false, true]) {
  const row = insensitive ? 10 : 9;
  const rows = [];
  for (const { kind, words, c } of containsCases(insensitive)) {
    const literal = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const typeMap = {
      contains: insensitive ? 'icontains' : 'contains',
      all: insensitive ? 'icontains-all' : 'contains-all',
      any: insensitive ? 'icontains-any' : 'contains-any',
    } as const;
    const value = kind === 'contains' ? words[0] : words;
    const ourPatterns = kind === 'any' ? [`(?:${words.map(literal).join('|')})`] : words.map(literal);
    rows.push({
      truth: c.truth,
      a: await theirs(typeMap[kind], value, c),
      b: await ours('must', { must: ourPatterns }, c, { match_case: !insensitive }),
    });
  }
  results[`row${row}`] = summarise(insensitive ? '10 icontains family' : '9 contains family', rows, [
    'theirs',
    'ours',
  ]);
}
{
  const rows = [];
  const looseRows = [];
  for (const { reference, c, loose } of equalsCases()) {
    rows.push({
      truth: c.truth,
      a: await theirs('equals', reference, c),
      b: await ours('exact', { exact: reference, exact_strict: true }, c),
    });
    looseRows.push({
      truth: loose,
      a: await theirs('equals', reference, c),
      b: await ours('exact', { exact: reference }, c),
    });
  }
  results.row11_strict = summarise(
    '11 equals, strict truth (identical text): ours in exact_strict mode',
    rows,
    ['theirs', 'ours'],
  );
  results.row11_loose = summarise(
    '11 equals, loose truth (case, punctuation, spacing ignored): ours in default mode',
    looseRows,
    ['theirs', 'ours'],
  );
}
{
  const rows = [];
  for (const { prefix, c } of startsCases()) {
    rows.push({
      truth: c.truth,
      a: await theirs('starts-with', prefix, c),
      b: await ours('starts', { starts_with: prefix }, c),
    });
  }
  results.row12 = summarise('12 starts-with', rows, ['theirs', 'ours']);
}
{
  const rows = [];
  for (const { kind, bound, c } of costCases()) {
    const type = kind;
    const a = await theirs(type, undefined, c, { threshold: bound });
    const b = await ours(
      'budget',
      { budget: { [kind === 'cost' ? 'cost_usd' : 'latency_ms']: bound } } as never,
      c,
    );
    rows.push({ truth: c.truth, a, b });
  }
  results.row16 = summarise('16 cost and latency bounds', rows, ['theirs', 'ours']);
}

const out = join(HERE, 'out');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'deterministic.json'), `${JSON.stringify(results, null, 2)}\n`);
for (const value of Object.values(results)) console.log(JSON.stringify(value));
