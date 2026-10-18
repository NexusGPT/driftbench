import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeClient } from '../src/client';
import { applyLongStructured, isStructured } from '../src/long-structured';
import { judgePairLedger, type LedgerVerdict, pairLedgerRequest } from '../src/pair-ledger';
import { readerFeatures } from '../src/reader-first-features';

// Distinct letter-only words, so repetition measures stay at zero.
const letters = (i: number): string =>
  (i < 26 ? '' : letters(Math.floor(i / 26) - 1)) + String.fromCharCode(97 + (i % 26));
const para = (n: number, word: string) =>
  Array.from({ length: n }, (_, i) => `${word}${letters(i)}`).join(' ');
const structuredLong = [
  '# Plan',
  para(60, 'alpha'),
  para(60, 'beta'),
  '- one step\n- two steps',
  para(60, 'gamma'),
].join('\n\n');
const wallLong = para(700, 'delta');
const short = `${para(40, 'eps')}.`;
const verdict = (choice: 'first' | 'second' | 'tie', hard: (-1 | 0 | 1)[] = []): LedgerVerdict => ({
  status: choice === 'tie' ? 'tie' : 'decided',
  choice,
  ruleId: 'ledger.orders-agree',
  readings: [
    ...hard.map((sign) => ({ sign, margin: 2, signedSum: 2 * sign, ruleId: 'ledger.hard-gate' })),
    { sign: choice === 'first' ? 1 : -1, margin: 1, signedSum: 1, ruleId: 'ledger.weighted-sum' },
  ],
});

describe('long-structured preference', () => {
  it('reads structure from paragraphs, headings and lists, and rejects a wall of text or heavy repetition', () => {
    expect(isStructured(readerFeatures(structuredLong, 'en'))).toBe(true);
    expect(isStructured(readerFeatures(wallLong, 'en'))).toBe(false);
    const repeated = Array.from({ length: 30 }, () => 'The same sentence again and again here.').join('\n\n');
    expect(isStructured(readerFeatures(repeated, 'en'))).toBe(false);
  });

  it('picks the longer structured reply over the ledger choice', () => {
    expect(applyLongStructured(short, structuredLong, verdict('first'), 'en')).toMatchObject({
      choice: 'second',
      ruleId: 'preference.long-structured',
    });
    expect(applyLongStructured(structuredLong, short, verdict('second'), 'en')).toMatchObject({
      choice: 'first',
    });
  });

  it('keeps the ledger choice when the longer reply is an unstructured wall and the shorter one is not', () => {
    expect(applyLongStructured(wallLong, short, verdict('second'), 'en')).toMatchObject({
      choice: 'second',
      ruleId: 'preference.ledger',
    });
  });

  it('lets an explicit request row decide before the preference', () => {
    expect(applyLongStructured(short, structuredLong, verdict('first', [1, 1]), 'en')).toMatchObject({
      choice: 'first',
      ruleId: 'preference.hard-row',
    });
  });

  it('is off by default and applied only when declared', async () => {
    const answer = (first: number, second: number) =>
      `{"items":[{"name":"q","first":${first},"second":${second},"reasoning":"r","evidence":null}]}`;
    const client = (raws: string[]): JudgeClient => {
      let n = 0;
      return {
        id: 't',
        cls: 'system2',
        family: 't',
        cost: 0,
        judge: async (r) => parseJudgeText(raws[n++] ?? '', r),
      };
    };
    const request = pairLedgerRequest(
      { name: 'w', rubric: 'Better writing.' },
      [{ role: 'user', text: 'Write.' }],
      short,
      structuredLong,
      {
        requirements: [{ name: 'q', rubric: 'Quality.' }],
      },
    );
    // Both orders prefer the short reply.
    const plain = await judgePairLedger(client([answer(4, 2), answer(2, 4)]), request);
    expect(plain.choice).toBe('first');
    expect(plain.preference).toBeUndefined();
    const declared = await judgePairLedger(client([answer(4, 2), answer(2, 4)]), request, {
      preference: 'long-structured',
    });
    expect(declared.choice).toBe('second');
    expect(declared.preference).toMatchObject({
      name: 'long-structured',
      ruleId: 'preference.long-structured',
    });
    expect(declared.verdict?.choice).toBe('first');
    await expect(judgePairLedger(client([]), request, { preference: 'shortest' as never })).rejects.toThrow(
      /preference/,
    );
  });
});
