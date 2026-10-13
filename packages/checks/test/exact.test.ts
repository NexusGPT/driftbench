import { describe, expect, it } from 'vitest';
import { exact, normaliseExact } from '../src/checks/exact';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run } from './support/context';

const coverage = acme('acme-new-customer-coverage');

async function judge(reply: string, reference: string): Promise<string | undefined> {
  const ctx = context(coverage, 1, observed(reply), { expect: { exact: reference } });
  const [only] = await run(exact, ctx);
  if (!only) throw new Error('no verdict');
  return only.outcome;
}

describe('exact: the reply equals the reference after normalising', () => {
  it('ignores case, surrounding space and punctuation', async () => {
    expect(await judge('  HELLO, there!  ', 'hello there')).toBe('pass');
    expect(await judge('Acme Air 5G: $35 a month.', 'acme air 5g 35 a month')).toBe('pass');
  });

  it('reads a line break and a space as the same gap', async () => {
    expect(await judge('Thanks.\nYes', 'thanks yes')).toBe('pass');
    expect(normaliseExact('a \t\n  b')).toBe('a b');
  });

  it('fails a reply that differs in a word', async () => {
    expect(await judge('hello there', 'hello')).toBe('fail');
  });

  it('compares two numbers as numbers', async () => {
    expect(await judge('42.0', '42')).toBe('pass');
    expect(await judge('3.50', '350')).toBe('fail');
  });

  it.each([
    // All probe pairs from the three independent reviews, plus requested edge cases.
    ['1,000', '1000', 'pass'],
    ['12,345,678', '12345678', 'pass'],
    ['1,00', '100', 'fail'],
    ['3,5', '3.5', 'fail'],
    ['3,5', '35', 'fail'],
    ['1,000,5', '10005', 'fail'],
    ['€1,000', '1000', 'pass'],
    ['£1,000', '1000', 'pass'],
    ['1,000 items', '1000 items', 'pass'],
    ['$1,000.50', '1000.50', 'pass'],
    ['v1.2', 'v12', 'fail'],
    ['3.', '3', 'pass'],
    ['-5', '5', 'fail'],
    ['5-6', '56', 'pass'],
    ['The value is 5.', 'The value is 5', 'pass'],
    ['3.50', '3.5', 'pass'],
    ['1e3', '1000', 'pass'],
    ['1.2.3', '123', 'fail'],
    ['2026-10-13', '20261013', 'pass'],
    ['2026-10-13', '13 October 2026', 'fail'],
    ['2026-10-13', '2026/10/13', 'pass'],
    ['v1.2.3', 'v123', 'fail'],
    ['v1.2.3', 'v1-2-3', 'fail'],
    ['+1-202-555-0100', '+12025550100', 'pass'],
    ['+1 202 555 0100', '+12025550100', 'fail'],
    ['202-555-0100', '2025550100', 'pass'],
    ['192.168.1.1', '19216811', 'fail'],
    ['192.168.1.1', '192-168-1-1', 'fail'],
    ['10:30', '1030', 'pass'],
    ['10:30', '10-30', 'pass'],
    ['5-6', '5/6', 'pass'],
    ['5-6', '5\u20136', 'pass'],
    ['5%', '5', 'pass'],
    ['3.5%', '35%', 'fail'],
    ['1st', '1', 'fail'],
    ['1st.', '1st', 'pass'],
    ['5kg', '5 kg', 'fail'],
    ['5-kg', '5kg', 'pass'],
    ['007', '7', 'pass'],
    ['agent-007', 'agent007', 'pass'],
    ['COVID-19', 'COVID19', 'pass'],
    ['item-5', 'item5', 'pass'],
    ['item+5', 'item5', 'pass'],
    ['value -5', 'value 5', 'pass'],
    ['value \u22125', 'value -5', 'pass'],
    ['value +5', 'value 5', 'pass'],
    ['value - 5', 'value 5', 'pass'],
    ['1,2', '2,1', 'fail'],
    ['12,3', '1,23', 'fail'],
    ['1,000e3', '1000e3', 'pass'],
    ['1,000e-3', '1000e-3', 'pass'],
    ['2026-10-13', '2026.10.13', 'fail'],
    ['v1.02', 'v1.2', 'fail'],
    ['number 007', 'number 7', 'fail'],
    ['5+6', '56', 'pass'],
    ['\u22125', '-5', 'pass'],
    ['-$1,000.50', '-1000.50', 'pass'],
    ['+€1,000.50', '1000.50', 'pass'],
    ['1,0000', '10000', 'fail'],
    ['1234,567', '1234567', 'fail'],
    ['1,5', '15', 'fail'],
    ['value 3,5', 'value 3.5', 'fail'],
    ['value 3.5', 'value 35', 'fail'],
    ['value .5', 'value 5', 'pass'],
    ['value -.5', 'value .5', 'pass'],
    ['value -3,5', 'value 3,5', 'pass'],
    ['value 1e-3', 'value 1e3', 'pass'],
    ['3,5', '3,5', 'pass'],
    ['3,50', '3,5', 'fail'],
    ['$1,000.50 total', '1000.50 total', 'pass'],
    ['12,345,678.50 total', '12345678.50 total', 'pass'],
    ['-$1,000 items', '$1,000 items', 'pass'],
    ['1,000.50', '1000.5', 'fail'],
  ])('preserves main except digit separators: %s versus %s', async (reply, reference, outcome) => {
    expect(await judge(reply, reference)).toBe(outcome);
    expect(await judge(reference, reply)).toBe(outcome);
  });

  it('matches main for every pair without a dot or comma between digits', async () => {
    const texts = [
      '',
      ' ',
      'hello',
      'HELLO!',
      'hello there',
      'hello, there!',
      'Thanks.\nYes',
      'thanks yes',
      '0',
      '1',
      'true',
      'false',
      '5',
      '-5',
      '+5',
      '\u22125',
      '007',
      '7',
      '42',
      '42.',
      '1e3',
      '1000',
      '1e-3',
      '1e+3',
      '2026-10-13',
      '2026/10/13',
      '20261013',
      'COVID-19',
      'COVID19',
      'agent-007',
      'agent007',
      'item-5',
      'item5',
      'item+5',
      'value -5',
      'value \u22125',
      'value 5',
      'value +5',
      'value - 5',
      '10:30',
      '1030',
      '10-30',
      '5-6',
      '56',
      '5/6',
      '5\u20136',
      '5+6',
      '5%',
      '5kg',
      '5 kg',
      '5-kg',
      '1st',
      '1st.',
      '+1-202-555-0100',
      '+12025550100',
      '+1 202 555 0100',
      'value .5',
      'value 5.',
      'value 1e-3',
      'value 1e3',
      'Hé, Wörld 42!',
      'hé wörld 42',
    ];
    expect(texts.length).toBeGreaterThanOrEqual(40);
    for (const text of texts) expect(text).not.toMatch(/\d[.,]\d/);
    for (const reply of texts) {
      for (const reference of texts) {
        expect(await judge(reply, reference), JSON.stringify([reply, reference])).toBe(
          mainOutcome(reply, reference),
        );
      }
    }
  });

  it('retains the original letter-digit-space normalisation for prose', () => {
    expect(normaliseExact('  V1.2: -$1,000.50, 3,5!  ')).toBe('v12 100050 35');
  });

  it('reads true and false as 1 and 0 when the other side is a number', async () => {
    expect(await judge('true', '1')).toBe('pass');
    expect(await judge('false', '1')).toBe('fail');
  });

  it('fails an empty reply against a non-empty reference', async () => {
    expect(await judge('', 'hello')).toBe('fail');
  });

  it('applies only when the block names a reference', async () => {
    const ctx = context(coverage, 1, observed('hello'));
    expect(outcomes(await run(exact, ctx))).toEqual({});
  });

  it('names the normalised form on both sides in its evidence', async () => {
    const ctx = context(coverage, 1, observed('Hello!'), { expect: { exact: 'hello world' } });
    const [only] = await run(exact, ctx);
    expect(only?.evidence).toBe('"hello" != "hello world" after normalising');
    expect(failing(await run(exact, ctx))).toEqual(['exact.0']);
  });

  it('normalises a string on its own', () => {
    expect(normaliseExact('  Hé, Wörld 42!  ')).toBe('hé wörld 42');
  });
});

// Main's exact comparison at 0531bb75852c4089d0261b58ebd46457bf863d16.
function mainOutcome(reply: string, reference: string): 'pass' | 'fail' {
  const number = (text: string): number | undefined => {
    const trimmed = text.trim();
    if (trimmed === 'true') return 1;
    if (trimmed === 'false') return 0;
    if (trimmed === '') return undefined;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  };
  const replyNumber = number(reply);
  const referenceNumber = number(reference);
  if (replyNumber !== undefined && referenceNumber !== undefined) {
    return replyNumber === referenceNumber ? 'pass' : 'fail';
  }
  const normalise = (text: string) =>
    [...text.trim()]
      .filter((char) => /[\p{L}\p{N}\s]/u.test(char))
      .join('')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  const left = normalise(reply);
  return left !== '' && left === normalise(reference) ? 'pass' : 'fail';
}
