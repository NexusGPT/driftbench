import { describe, expect, it } from 'vitest';
import { length } from '../src/checks/length';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const short = 'Thanks, your order is in.';

function lengthCtx(
  text: string,
  bounds: { words?: { min?: number; max?: number }; chars?: { min?: number; max?: number } },
) {
  return context(coverage, 1, observed(text), { expect: { length: bounds } });
}

describe('length', () => {
  it('passes a reply inside its word and character bounds, with the counts in the evidence', async () => {
    const ctx = lengthCtx(short, { words: { min: 1, max: 10 }, chars: { min: 1, max: 100 } });
    const verdicts = await run(length, ctx);
    expect(outcomes(verdicts)).toEqual({ 'length.words': 'pass', 'length.chars': 'pass' });
    expect(verdict(verdicts, 'length.words').evidence).toBe('5 words, within 1 to 10');
    expect(verdict(verdicts, 'length.chars').evidence).toBe(`${short.length} characters, within 1 to 100`);
  });

  it('fails a reply above the word maximum and names the maximum', async () => {
    const verdicts = await run(length, lengthCtx(short, { words: { max: 3 } }));
    expect(failing(verdicts)).toEqual(['length.words']);
    expect(verdict(verdicts, 'length.words').evidence).toBe('5 words, above the maximum 3');
  });

  it('fails a reply below the word minimum', async () => {
    const verdicts = await run(length, lengthCtx('Yes.', { words: { min: 2 } }));
    expect(failing(verdicts)).toEqual(['length.words']);
    expect(verdict(verdicts, 'length.words').evidence).toBe('1 word, below the minimum 2');
  });

  it('counts characters as code points, so an accented letter and an emoji are one each', async () => {
    const verdicts = await run(length, lengthCtx('é😀', { chars: { min: 2, max: 2 } }));
    expect(outcomes(verdicts)).toEqual({ 'length.chars': 'pass' });
    expect(verdict(verdicts, 'length.chars').evidence).toBe('2 characters, within 2 to 2');
  });

  it('counts a block with no visible text as zero words', async () => {
    const verdicts = await run(length, lengthCtx('', { words: { min: 1 } }));
    expect(failing(verdicts)).toEqual(['length.words']);
    expect(verdict(verdicts, 'length.words').evidence).toBe('0 words, below the minimum 1');
  });

  it('passes a reply at exactly the maximum, and counts a line break as a word separator', async () => {
    const verdicts = await run(length, lengthCtx('one\ntwo', { words: { max: 2 } }));
    expect(outcomes(verdicts)).toEqual({ 'length.words': 'pass' });
    expect(verdict(verdicts, 'length.words').evidence).toBe('2 words, within 0 to 2');
  });

  it('gives no verdict when the block declares no length', async () => {
    expect(await run(length, context(coverage, 1, observed(short)))).toEqual([]);
  });

  it('mutation: a reply four times the allowed length fails on the same bound that the short reply passes', async () => {
    const long = `${short} `.repeat(4).trim();
    const passing = await run(length, lengthCtx(short, { words: { max: 5 } }));
    const failed = await run(length, lengthCtx(long, { words: { max: 5 } }));
    expect(outcomes(passing)).toEqual({ 'length.words': 'pass' });
    expect(failing(failed)).toEqual(['length.words']);
  });
});
