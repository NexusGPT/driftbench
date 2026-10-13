import type { JudgeResult } from '@agent-nexus/driftbench-judges';
import { type BankItem, between, filler, fn, item, type Tier } from '../bank';

/**
 * The answer contract under hostile model output (packages/judges/src/contract.ts). Each item wraps a seeded
 * answer in one shape a model may produce. The bank decides, per shape, whether the contract must read the
 * answer or refuse it as inconclusive:
 * - read: the answer object alone, fenced, in prose, pretty printed, with a BOM, in an XML tag, inside an array,
 *   after prose that holds a brace pair or an example object;
 * - read through a repair (docs/concepts/judges.md, "The request and the answer": near-JSON is repaired and the
 *   result says `repaired: true`): the outcome in capitals, the score as a string, single quotes, a trailing
 *   comma, a line comment, typographic quotes, a double quote left unescaped inside a string;
 * - refuse: no object, an extra key, a score out of range, a score that contradicts the outcome, two answers
 *   that disagree, a key given twice with two values, a truncated object, a missing reasoning, a null outcome.
 */

type Answer = { outcome: 'pass' | 'fail'; score?: number; reasoning: string; evidence?: string };
type Read = { outcome: string; score?: number; unparsed: boolean };
type Input = { raw: string; base: Answer };

const COMPONENT = 'packages/judges/src/contract.ts';

function base(random: () => number): Answer {
  const outcome = random() < 0.5 ? 'pass' : 'fail';
  const score =
    outcome === 'pass'
      ? Math.round((0.7 + random() * 0.29) * 100) / 100
      : Math.round(random() * 0.29 * 100) / 100;
  const answer: Answer = { outcome, score, reasoning: filler(random, between(random, 4, 12)) };
  if (random() < 0.5) answer.evidence = filler(random, 3);
  return answer;
}

const json = (answer: Answer) => JSON.stringify(answer);
const pretty = (answer: Answer) => JSON.stringify(answer, null, 2);

type Shape = { id: string; tier: Tier; read: boolean; wrap(answer: Answer, random: () => number): string };

const SHAPES: readonly Shape[] = [
  { id: 'bare-object', tier: 1, read: true, wrap: json },
  { id: 'fenced-json', tier: 1, read: true, wrap: (a) => `\`\`\`json\n${pretty(a)}\n\`\`\`` },
  { id: 'fenced-plain', tier: 1, read: true, wrap: (a) => `\`\`\`\n${json(a)}\n\`\`\`` },
  { id: 'prose-around', tier: 1, read: true, wrap: (a, r) => `${filler(r, 8)}\n${json(a)}\n${filler(r, 5)}` },
  { id: 'pretty-printed', tier: 1, read: true, wrap: pretty },
  { id: 'trailing-space', tier: 1, read: true, wrap: (a) => `  \n${json(a)}\n\n\t ` },
  { id: 'byte-order-mark', tier: 2, read: true, wrap: (a) => `﻿${json(a)}` },
  { id: 'xml-tag', tier: 1, read: true, wrap: (a) => `<answer>${json(a)}</answer>` },
  { id: 'inside-array', tier: 2, read: true, wrap: (a) => `[${json(a)}]` },
  {
    id: 'escaped-strings',
    tier: 2,
    read: true,
    wrap: (a) => json({ ...a, reasoning: `${a.reasoning} The reply said "{ok}" and \\ path.` }),
  },
  {
    id: 'unicode-escaped-keys',
    tier: 2,
    read: true,
    wrap: (a) => json(a).replace('"outcome"', '"\\u006futcome"'),
  },
  {
    id: 'brace-pair-before',
    tier: 3,
    read: true,
    wrap: (a, r) => `Applying {rubric} to {data}: ${filler(r, 3)} ${json(a)}`,
  },
  {
    id: 'example-object-before',
    tier: 4,
    read: true,
    wrap: (a) => `The format is {"outcome": "<pass or fail>", "reasoning": "<why>"}. My answer: ${json(a)}`,
  },
  {
    id: 'outcome-capitals',
    tier: 3,
    read: true,
    wrap: (a) => json(a).replace(`"${a.outcome}"`, `"${a.outcome.toUpperCase()}"`),
  },
  {
    id: 'score-as-string',
    tier: 3,
    read: true,
    wrap: (a) => json(a).replace(`"score":${a.score}`, `"score":"${a.score}"`),
  },
  { id: 'single-quotes', tier: 4, read: true, wrap: (a) => json(a).replace(/"/g, "'") },
  { id: 'trailing-comma', tier: 4, read: true, wrap: (a) => json(a).replace(/}$/, ',}') },
  {
    id: 'line-comment',
    tier: 5,
    read: true,
    wrap: (a) => pretty(a).replace('{\n', '{\n  // the verdict follows\n'),
  },
  { id: 'typographic-quotes', tier: 5, read: true, wrap: (a) => json(a).replace(/"([^"]*)"/g, '“$1”') },
  {
    id: 'unescaped-quotes',
    tier: 5,
    read: true,
    wrap: (a) => json(a).replace(/"reasoning":"/, '"reasoning":"the reply said "yes" here. '),
  },
  {
    id: 'two-agreeing-answers',
    tier: 2,
    read: true,
    wrap: (a) => `${json(a)}\nTo repeat: ${json({ ...a, reasoning: 'same verdict' })}`,
  },
  { id: 'no-object', tier: 1, read: false, wrap: (a) => a.outcome.toUpperCase() },
  { id: 'empty', tier: 1, read: false, wrap: () => '' },
  { id: 'extra-key', tier: 1, read: false, wrap: (a) => json({ ...a, confidence: 'high' } as Answer) },
  { id: 'score-above-one', tier: 1, read: false, wrap: (a) => json({ ...a, score: 1.4 }) },
  { id: 'score-negative', tier: 1, read: false, wrap: (a) => json({ ...a, score: -0.2 }) },
  {
    id: 'score-contradicts-outcome',
    tier: 3,
    read: false,
    wrap: (a) => json({ ...a, score: a.outcome === 'pass' ? 0.05 : 0.97 }),
  },
  {
    id: 'two-disagreeing-answers',
    tier: 3,
    read: false,
    wrap: (a) =>
      `${json(a)}\nOn reflection: ${json({ outcome: a.outcome === 'pass' ? 'fail' : 'pass', reasoning: 'changed' })}`,
  },
  {
    id: 'key-given-twice',
    tier: 4,
    read: false,
    wrap: (a) => json(a).replace(/^\{/, `{"outcome":"${a.outcome === 'pass' ? 'fail' : 'pass'}",`),
  },
  { id: 'truncated', tier: 1, read: false, wrap: (a) => json(a).slice(0, json(a).length - 6) },
  {
    id: 'missing-reasoning',
    tier: 1,
    read: false,
    wrap: (a) => json({ outcome: a.outcome, score: a.score } as Answer),
  },
  {
    id: 'null-outcome',
    tier: 1,
    read: false,
    wrap: (a) => json({ ...a, outcome: null } as unknown as Answer),
  },
  {
    id: 'nan-score',
    tier: 2,
    read: false,
    wrap: (a) => json(a).replace(`"score":${a.score}`, '"score":NaN'),
  },
  { id: 'wrapped-in-key', tier: 3, read: false, wrap: (a) => json({ answer: a } as unknown as Answer) },
  {
    id: 'outcome-unknown-word',
    tier: 2,
    read: false,
    wrap: (a) => json({ ...a, outcome: 'maybe' } as unknown as Answer),
  },
  {
    id: 'long-prose-before',
    tier: 2,
    read: true,
    wrap: (a, r) => `${filler(r, 20000)}\n${json(a)}`,
  },
];

function readOf(result: JudgeResult): Read {
  return {
    outcome: result.answer.outcome,
    ...(result.answer.score === undefined ? {} : { score: result.answer.score }),
    unparsed: result.unparsed === true,
  };
}

export function contractItems(): BankItem[] {
  const out: BankItem[] = SHAPES.map((shape) =>
    item<Input, Read>({
      id: `contract/${shape.id}`,
      family: 'contract',
      tier: shape.tier,
      level: 'contract',
      component: COMPONENT,
      generate: (random) => {
        const answer = base(random);
        return { base: answer, raw: shape.wrap(answer, random) };
      },
      oracle: ({ base: answer }) =>
        shape.read
          ? {
              outcome: answer.outcome,
              ...(answer.score === undefined ? {} : { score: answer.score }),
              unparsed: false,
            }
          : { outcome: 'inconclusive', unparsed: true },
      observe: (api, { raw }) => readOf(fn<(raw: string) => JudgeResult>(api, 'parseAnswerText')(raw)),
      same: (expected, observed) =>
        expected.outcome === observed.outcome &&
        expected.unparsed === observed.unparsed &&
        (expected.score === undefined || expected.score === observed.score),
    }),
  );
  // A repaired answer says so (docs/concepts/judges.md): `repaired: true` on the result, and never on strict JSON.
  const REPAIRED = [
    'outcome-capitals',
    'score-as-string',
    'single-quotes',
    'trailing-comma',
    'line-comment',
    'typographic-quotes',
  ];
  for (const shape of SHAPES.filter((s) => REPAIRED.includes(s.id) || s.id === 'bare-object')) {
    const strict = shape.id === 'bare-object';
    out.push(
      item<Input, boolean>({
        id: strict ? 'contract/strict-not-marked-repaired' : `contract/repaired-marked-${shape.id}`,
        family: 'contract',
        tier: strict ? 2 : 3,
        level: 'contract',
        component: COMPONENT,
        generate: (random) => {
          const answer = base(random);
          return { base: answer, raw: shape.wrap(answer, random) };
        },
        oracle: () => !strict,
        observe: (api, { raw }) => {
          const result = fn<(raw: string) => JudgeResult & { repaired?: boolean }>(
            api,
            'parseAnswerText',
          )(raw);
          return result.unparsed !== true && result.repaired === true;
        },
        show: (marked) => (marked ? 'read and marked repaired' : 'not marked repaired (or not read)'),
      }),
    );
  }
  // The probability mapping of system 1 judges.
  const probability = (
    id: string,
    tier: Tier,
    make: (random: () => number) => { p: number; bounds?: { passAt?: number; failAt?: number } },
    expect: (p: number, bounds?: { passAt?: number; failAt?: number }) => string,
  ) =>
    item<{ p: number; bounds?: { passAt?: number; failAt?: number } }, string>({
      id: `contract/probability-${id}`,
      family: 'contract',
      tier,
      level: 'contract',
      component: COMPONENT,
      generate: make,
      oracle: ({ p, bounds }) => expect(p, bounds),
      observe: (api, { p, bounds }) => {
        try {
          return fn<(p: number, b?: object) => string>(api, 'outcomeFromProbability')(p, bounds);
        } catch (cause) {
          if (cause instanceof RangeError) return 'refused';
          throw cause;
        }
      },
    });
  out.push(
    probability(
      'at-pass-bound',
      1,
      () => ({ p: 0.6 }),
      () => 'pass',
    ),
    probability(
      'at-fail-bound',
      1,
      () => ({ p: 0.4 }),
      () => 'fail',
    ),
    probability(
      'coin-toss',
      1,
      (r) => ({ p: 0.41 + r() * 0.18 }),
      () => 'inconclusive',
    ),
    probability(
      'nan',
      2,
      () => ({ p: Number.NaN }),
      () => 'inconclusive',
    ),
    probability(
      'above-one',
      3,
      (r) => ({ p: 1.01 + r() }),
      () => 'inconclusive',
    ),
    probability(
      'below-zero',
      3,
      (r) => ({ p: -0.01 - r() }),
      () => 'inconclusive',
    ),
    probability(
      'crossed-bounds',
      4,
      (r) => ({ p: r(), bounds: { passAt: 0.3, failAt: 0.7 } }),
      () => 'refused',
    ),
    probability(
      'custom-bounds',
      2,
      (r) => ({ p: 0.8 + r() * 0.05, bounds: { passAt: 0.9, failAt: 0.1 } }),
      () => 'inconclusive',
    ),
  );
  return out;
}

export const CONTRACT_SHAPES = SHAPES;
