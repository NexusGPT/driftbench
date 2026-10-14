import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import { groundEvidenceSpan } from '../src/evidence';

// A bracket-completion task: the reply that closes the sequence is symbols alone.
const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The response correctly closes every open bracket.' },
  transcript: [
    { role: 'user', text: 'Complete the sequence: { [ { { [ <' },
    { role: 'agent', text: 'The completion is: > ] } } ] }' },
  ],
};
const ledger = (source: string, quote: string, met = true) =>
  JSON.stringify({
    checks: [{ id: 'c', reasoning: 'The closers mirror the openers.', evidence: [{ source, quote }], met }],
  });
const v3: JudgeRequest = { ...request, criterionDecoderVersion: 3 };
const v1: JudgeRequest = { ...request, criterionDecoderVersion: 1 };

describe('a quote of symbols alone, under the default decoder', () => {
  it('grounds in the source it names', () => {
    const result = parseJudgeText(ledger('transcript.1', '> ] } } ] }'), v3);
    expect(result.unparsed).toBeUndefined();
    expect(result.answer.outcome).toBe('pass');
    expect(result.answer.evidence).toBe('> ] } } ] }');
    expect(parseJudgeText(ledger('transcript.1', '> ] } } ] }'), request)).toEqual(result);
  });
  it('folds white space and compatibility forms, never case or source', () => {
    expect(
      groundEvidenceSpan(request, { source: 'transcript.1', quote: '>  ]\n}' }, { symbolQuotes: true }),
    ).toEqual({ grounded: true, where: 'transcript.1' });
  });
  it('never grounds in another source than the one named', () => {
    expect(parseJudgeText(ledger('transcript.0', '> ] } } ] }'), v3).unparsed).toBe(true);
    expect(
      groundEvidenceSpan(request, { source: 'transcript.0', quote: '> ] }' }, { symbolQuotes: true }),
    ).toEqual({ grounded: false });
  });
  it('needs at least three non-space symbols and an exact occurrence', () => {
    for (const quote of ['} }', '}', '> ] ] ]', '] > }'])
      expect(parseJudgeText(ledger('transcript.1', quote), v3).unparsed, quote).toBe(true);
  });
  it('is unchanged for a quote with any letter or digit', () => {
    expect(parseJudgeText(ledger('transcript.1', 'completion is: > ] }'), v3).unparsed).toBeUndefined();
    expect(parseJudgeText(ledger('transcript.1', 'completion was: > ] }'), v3).unparsed).toBe(true);
    // A cut word fails the word search; the symbol path does not take quotes with letters.
    expect(parseJudgeText(ledger('transcript.1', 'pletion is: > ] }'), v3).unparsed).toBe(true);
  });
  it('stays rejected by historical decoders and without the option', () => {
    for (const version of [1, 2] as const)
      expect(
        parseJudgeText(ledger('transcript.1', '> ] } } ] }'), { ...v1, criterionDecoderVersion: version })
          .unparsed,
      ).toBe(true);
    expect(groundEvidenceSpan(request, { source: 'transcript.1', quote: '> ] } } ] }' })).toEqual({
      grounded: false,
    });
  });
  it('grounds in a named data place and in the sole input under its alias', () => {
    const withInput: JudgeRequest = { ...v3, inputs: [{ path: 'expected.txt', text: 'Closers: ) ] >' }] };
    expect(
      groundEvidenceSpan(withInput, { source: 'input.expected.txt', quote: ') ] >' }, { symbolQuotes: true }),
    ).toEqual({ grounded: true, where: 'input.expected.txt' });
    expect(
      groundEvidenceSpan(withInput, { source: 'reference', quote: ') ] >' }, { symbolQuotes: true }),
    ).toEqual({ grounded: true, where: 'input.expected.txt' });
    expect(
      groundEvidenceSpan(withInput, { source: 'transcript.1', quote: ') ] >' }, { symbolQuotes: true }),
    ).toEqual({ grounded: false });
  });
});

describe('an input source label spelled another way, under the default decoder', () => {
  const two: JudgeRequest = {
    criterion: { name: 'c', rubric: 'The reply states the plan price from the reference.' },
    transcript: [{ role: 'agent', text: 'Lumen-12 costs 57 credits.' }],
    inputs: [
      { path: 'reference.txt', text: 'Lumen-12 costs 57 credits per month.' },
      { path: 'order.json', text: '{"plan_id":"Lumen-12","quantity":2}' },
    ],
  };
  const spanLedger = (source: string, quote: string) =>
    JSON.stringify({
      checks: [
        {
          id: 'c',
          reasoning: 'The price matches.',
          evidence: [
            { source: 'transcript.0', quote: 'Lumen-12 costs 57 credits.' },
            { source, quote },
          ],
          met: true,
        },
      ],
    });
  const quote = 'Lumen-12 costs 57 credits per month.';
  it.each([
    'input/reference.txt',
    'input_data/reference.txt',
    'input. reference.txt',
    'input<reference.txt>',
    'input reference.txt',
    'inputs/reference.txt',
  ])('reads %s as input.reference.txt', (source) => {
    expect(
      parseJudgeText(spanLedger(source, quote), { ...two, criterionDecoderVersion: 3 }).unparsed,
    ).toBeUndefined();
    expect(groundEvidenceSpan(two, { source, quote }, { inputSpellings: true })).toEqual({
      grounded: true,
      where: 'input.reference.txt',
    });
  });
  it('never guesses among inputs, nor reads a quote from another input', () => {
    for (const source of [
      'input_data',
      'input',
      'input/missing.txt',
      'input/order.json',
      'inputx/reference.txt',
    ])
      expect(
        parseJudgeText(spanLedger(source, quote), { ...two, criterionDecoderVersion: 3 }).unparsed,
        source,
      ).toBe(true);
  });
  it('reads a bare input label as the sole input', () => {
    const one: JudgeRequest = { ...two, inputs: two.inputs?.slice(0, 1) };
    for (const source of ['input_data', 'input', 'inputs'])
      expect(groundEvidenceSpan(one, { source, quote }, { inputSpellings: true }), source).toEqual({
        grounded: true,
        where: 'input.reference.txt',
      });
  });
  it('stays rejected by the strict decoder, version 1', () => {
    expect(
      parseJudgeText(spanLedger('input/reference.txt', quote), { ...two, criterionDecoderVersion: 1 })
        .unparsed,
    ).toBe(true);
  });
});
