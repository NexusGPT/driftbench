import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import { requestKey } from '../src/cassette';
import type { JudgeRequest } from '../src/contract';
import { createDefaultJudge, DEFAULT_JUDGE_POLICY } from '../src/default-judge';
import { PROMPT_FINGERPRINT, SYSTEM_PROMPT, SYSTEM_PROMPT_V1 } from '../src/prompt';

const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The reply follows the supplied facts.' },
  transcript: [{ role: 'agent', text: 'I approve the discount.' }],
};
const grounded = { source: 'transcript.0', quote: 'I approve the discount.' };
const criterionSpan = { source: 'criterion', quote: request.criterion.rubric };
const parse = (evidence: unknown, met: boolean | null = true, override: Partial<JudgeRequest> = {}) =>
  parseJudgeText(JSON.stringify({ checks: [{ id: 'c', reasoning: 'checked', evidence, met }] }), {
    ...request,
    ...override,
  });

describe('handed criterion gains use decoder 3', () => {
  it.each([undefined, 3] as const)(
    'drops criterion-only spans under decoder %s while retaining grounded evidence',
    (criterionDecoderVersion) => {
      const result = parse([grounded, criterionSpan], true, { criterionDecoderVersion });
      expect(result.unparsed).toBeUndefined();
      expect(result.answer.outcome).toBe('pass');
      expect(result.criterionQuotesDropped).toBe(1);
      expect(result.checks?.[0]?.evidence).toEqual([grounded]);
    },
  );

  it.each([1, 2] as const)(
    'preserves explicit decoder %s rejection without new diagnostics',
    (criterionDecoderVersion) => {
      const result = parse([grounded, criterionSpan], true, { criterionDecoderVersion });
      expect(result.unparsed).toBe(true);
      expect(result.answer.outcome).toBe('inconclusive');
      expect(result.criterionQuotesDropped).toBeUndefined();
      expect(parse([grounded], true, { criterionDecoderVersion }).answer.outcome).toBe('pass');
    },
  );

  it.each([
    [true, 'inconclusive'],
    [false, 'fail'],
    [null, 'inconclusive'],
  ] as const)('retains dropped-only diagnostics when met is %s', (met, outcome) => {
    const result = parse([criterionSpan], met);
    expect(result.answer.outcome).toBe(outcome);
    expect(result.criterionQuotesDropped).toBe(1);
    expect(result.unparsed === true).toBe(met === true);
    if (met !== true) expect(result.checks?.[0]?.evidence).toBeNull();
  });

  it('recognizes criterion quotes under another nontranscript label and requirement-local prose', () => {
    const result = parse(
      [
        grounded,
        { ...criterionSpan, source: 'given' },
        { source: 'artifact', quote: 'The reply must name the approved discount.' },
      ],
      true,
      {
        requirements: [{ id: 'c', requirement: 'The reply must name the approved discount.' }],
      },
    );
    expect(result.answer.outcome).toBe('pass');
    expect(result.criterionQuotesDropped).toBe(2);
  });

  it('never drops a criterion quote that actually grounds in the named source', () => {
    const result = parse([{ ...criterionSpan, source: 'artifact' }], true, {
      artifact: request.criterion.rubric,
    });
    expect(result.answer.outcome).toBe('pass');
    expect(result.criterionQuotesDropped).toBeUndefined();
    expect(result.checks?.[0]?.evidence).toEqual([{ ...criterionSpan, source: 'artifact' }]);
  });

  it.each([
    { ...criterionSpan, source: 'transcript.0' },
    { source: 'input.missing', quote: 'A fabricated source quote.' },
    { source: 'artifact', quote: 'An unrelated wrong quote.' },
  ])('still rejects an unrelated or wrong-transcript span: $source', (bad) => {
    const result = parse([grounded, criterionSpan, bad]);
    expect(result.unparsed).toBe(true);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.criterionQuotesDropped).toBe(1);
  });

  it('uses the exact handed whole-reply rule and fingerprint without changing prompt 1', () => {
    const rule =
      'Read each fact in the context of the whole reply: a unit, period or subject that the surrounding text supplies carries over to a short clause, a synonym states the same fact, and an exact unit conversion is the same value.';
    expect(SYSTEM_PROMPT).toContain(rule);
    expect(SYSTEM_PROMPT_V1).not.toContain(rule);
    expect(PROMPT_FINGERPRINT).toBe('b55396660b27');
  });

  it('invalidates the full default policy identity including explicit pair requests', () => {
    const judge = createDefaultJudge({
      provider: 'claude-cli',
      model: 'fixture',
      env: {},
      transport: {
        dialect: 'scratchpad-json',
        fingerprint: 'handoff-fixture',
        async complete() {
          throw Error('no calls');
        },
      },
    });
    expect(DEFAULT_JUDGE_POLICY.version).toBe('default-on-v7');
    // Captured at the integration base 5c4de6274 with this exact transport and pair request.
    expect(judge.settings).not.toBe('cb182964c407');
    expect(
      requestKey(
        {
          criterion: { name: 'x', rubric: 'Compare.' },
          transcript: [],
          assessment: { kind: 'pairwise', items: [{ name: 'x', rubric: 'Compare.' }] },
          candidates: { A: 'a', B: 'b' },
        },
        judge,
        undefined,
        undefined,
        true,
      ),
    ).not.toBe('86e02495d028');
  });

  it('retains the diagnostic when relevance composes the original criterion', async () => {
    const outputs = [
      { route: 'relevance' },
      {
        checks: [
          {
            obligation: 'approval',
            requestQuote: 'Approve the discount.',
            reasoning: 'answered',
            answerQuote: 'I approve the discount.',
            met: true,
          },
        ],
      },
      {
        checks: [
          {
            id: 'c',
            reasoning: 'checked',
            evidence: [{ ...grounded, source: 'transcript.1' }, criterionSpan],
            met: true,
          },
        ],
      },
    ];
    const judge = createDefaultJudge({
      provider: 'claude-cli',
      transport: {
        dialect: 'scratchpad-json',
        fingerprint: 'handoff-fixture',
        async complete() {
          const text = JSON.stringify(outputs.shift());
          return { text, raw: text, dialect: 'scratchpad-json', fingerprint: 'handoff-fixture', costUsd: 0 };
        },
      },
    });
    const result = await judge.judge({
      ...request,
      transcript: [{ role: 'user', text: 'Approve the discount.' }, ...request.transcript],
    });
    expect(result.answer.outcome).toBe('pass');
    expect(result.criterionQuotesDropped).toBe(1);
    expect(JSON.parse(result.raw).criterion.criterionQuotesDropped).toBe(1);
  });
});
