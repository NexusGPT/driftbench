import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bleu, bleuScore, rougeL, rougeLScore } from '../src/checks/overlap';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';

const spec = acme('acme-new-customer-coverage');

describe('rougeLScore: the longest common subsequence of words, as an F measure', () => {
  it('scores identical text 1 and text with nothing shared 0', () => {
    expect(rougeLScore('the cat sat on the mat', 'the cat sat on the mat')).toBe(1);
    expect(rougeLScore('dogs bark', 'the cat sat')).toBe(0);
  });

  it('scores a one-word change by the shared subsequence: 5 of 6 words in each, F 5/6', () => {
    expect(rougeLScore('the cat is on the mat', 'the cat sat on the mat')).toBeCloseTo(5 / 6, 10);
  });

  it('is case-insensitive and ignores punctuation', () => {
    expect(rougeLScore('The cat, sat!', 'the cat sat')).toBe(1);
  });
});

describe('bleuScore: clipped n-gram precision up to 4 grams, with a brevity penalty', () => {
  it('scores identical text 1', () => {
    expect(bleuScore('the cat sat on the mat', 'the cat sat on the mat')).toBe(1);
  });

  it('scores 0 when some n-gram size has no match at all (no smoothing)', () => {
    expect(bleuScore('the cat sat', 'the cat sat on the mat')).toBe(0);
    expect(bleuScore('dogs bark loudly here', 'the cat sat on the mat')).toBe(0);
  });

  it('applies the brevity penalty alone when every n-gram of a shorter reply matches: exp(1 - 6/5)', () => {
    // 'the cat sat on the' (5 words) is inside the 6-word reference, so each precision is 1 and only the penalty remains.
    expect(bleuScore('the cat sat on the', 'the cat sat on the mat')).toBeCloseTo(Math.exp(1 - 6 / 5), 10);
  });

  it('applies the brevity penalty to a reply shorter than the reference', () => {
    // 3 unigrams match of 3 (precision 1); bigrams 2 of 2; trigrams 1 of 1; no 4-gram match in a 3-word reply, so 0.
    expect(bleuScore('the cat sat', 'the cat sat on the mat')).toBe(0);
    // Same 6 words in order but a longer reply: no penalty, precision 1 at every size.
    expect(bleuScore('the cat sat on the mat today', 'the cat sat on the mat')).toBeLessThan(1);
  });
});

describe('rouge_l and bleu checks', () => {
  it('pass when the reply reaches the minimum, and quote the score', async () => {
    const ctx = context(spec, 1, observed('The cat sat on the mat.'), {
      expect: { rouge_l: { reference: 'the cat sat on the mat', min: 0.9 } },
    });
    const [only] = await run(rougeL, ctx);
    expect(only?.outcome).toBe('pass');
    expect(only?.evidence).toMatch(/ROUGE-L 1\.000 is at least 0\.9/);
  });

  it('fail below the minimum, naming the score', async () => {
    const ctx = context(spec, 1, observed('A dog ran away.'), {
      expect: { rouge_l: { reference: 'the cat sat on the mat', min: 0.5 } },
    });
    expect(failing(await run(rougeL, ctx))).toEqual(['rouge_l.0']);
  });

  it('bleu passes on identical text and fails on an unrelated reply', async () => {
    const same = context(spec, 1, observed('the cat sat on the mat'), {
      expect: { bleu: { reference: 'the cat sat on the mat', min: 0.5 } },
    });
    expect(outcomes(await run(bleu, same))).toEqual({ 'bleu.0': 'pass' });
    const other = context(spec, 1, observed('a dog ran away quickly'), {
      expect: { bleu: { reference: 'the cat sat on the mat', min: 0.5 } },
    });
    expect(verdict(await run(bleu, other), 'bleu.0').outcome).toBe('fail');
  });

  it('apply only to a block that names a reference', async () => {
    const ctx = context(spec, 1, observed('hi'));
    expect(outcomes(await run(rougeL, ctx))).toEqual({});
    expect(outcomes(await run(bleu, ctx))).toEqual({});
  });
});

describe('the ragas profile reproduces the reference implementation on fixed pairs', () => {
  const reference = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'ragas-overlap-reference.json'), 'utf8'),
  ) as {
    pairs: Array<{ reply: string; reference: string; rougeL_stem: number; bleu_13a_exp: number }>;
  };
  for (const pair of reference.pairs) {
    it(`ROUGE-L matches on: ${pair.reply.slice(0, 40)}`, () => {
      expect(rougeLScore(pair.reply, pair.reference, 'ragas')).toBeCloseTo(pair.rougeL_stem, 9);
    });
    it(`BLEU matches on: ${pair.reply.slice(0, 40)}`, () => {
      expect(bleuScore(pair.reply, pair.reference, 'ragas')).toBeCloseTo(pair.bleu_13a_exp, 9);
    });
  }
  it('keeps the driftbench profile as the default', () => {
    expect(rougeLScore('Fibre is available', 'fibre is available')).toBe(
      rougeLScore('Fibre is available', 'fibre is available', 'driftbench'),
    );
  });
});
