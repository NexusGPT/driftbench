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
const v2: JudgeRequest = { ...request, criterionDecoderVersion: 2 };
const v1: JudgeRequest = { ...request, criterionDecoderVersion: 1 };

describe('a quote of symbols alone, under the default decoder', () => {
  it('grounds in the source it names', () => {
    const result = parseJudgeText(ledger('transcript.1', '> ] } } ] }'), v2);
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
    expect(parseJudgeText(ledger('transcript.0', '> ] } } ] }'), v2).unparsed).toBe(true);
    expect(
      groundEvidenceSpan(request, { source: 'transcript.0', quote: '> ] }' }, { symbolQuotes: true }),
    ).toEqual({ grounded: false });
  });
  it('needs at least three non-space symbols and an exact occurrence', () => {
    for (const quote of ['} }', '}', '> ] ] ]', '] > }'])
      expect(parseJudgeText(ledger('transcript.1', quote), v2).unparsed, quote).toBe(true);
  });
  it('is unchanged for a quote with any letter or digit', () => {
    expect(parseJudgeText(ledger('transcript.1', 'completion is: > ] }'), v2).unparsed).toBeUndefined();
    expect(parseJudgeText(ledger('transcript.1', 'completion was: > ] }'), v2).unparsed).toBe(true);
    // A cut word fails the word search; the symbol path does not take quotes with letters.
    expect(parseJudgeText(ledger('transcript.1', 'pletion is: > ] }'), v2).unparsed).toBe(true);
  });
  it('stays rejected by the strict decoder, version 1, and without the option', () => {
    expect(parseJudgeText(ledger('transcript.1', '> ] } } ] }'), v1).unparsed).toBe(true);
    expect(groundEvidenceSpan(request, { source: 'transcript.1', quote: '> ] } } ] }' })).toEqual({
      grounded: false,
    });
  });
  it('grounds in a named data place and in the sole input under its alias', () => {
    const withInput: JudgeRequest = { ...v2, inputs: [{ path: 'expected.txt', text: 'Closers: ) ] >' }] };
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
