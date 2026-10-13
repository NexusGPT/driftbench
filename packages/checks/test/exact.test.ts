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
    ['1,000', '1000'],
    ['$1,000.50', '1000.50'],
    ['12,345,678', '12345678'],
    ['-$1,000.50', '-1000.50'],
    ['+€1,000.50', '1000.50'],
  ])('compares strictly grouped numbers numerically: %s versus %s', async (reply, reference) => {
    expect(await judge(reply, reference)).toBe('pass');
    expect(await judge(reference, reply)).toBe('pass');
  });

  it('keeps a trailing decimal point numeric, preserving the existing Number parsing rule', async () => {
    expect(await judge('3.', '3')).toBe('pass');
    expect(await judge('3', '3.')).toBe('pass');
  });

  it.each([
    ['3,5', '3.5'],
    ['3,5', '35'],
    ['1,00', '100'],
    ['1,0000', '10000'],
    ['1234,567', '1234567'],
    ['-5', '5'],
    ['1,5', '15'],
    ['value 3,5', 'value 3.5'],
    ['value 3.5', 'value 35'],
    ['value .5', 'value 5'],
    ['value -.5', 'value .5'],
    ['value -3,5', 'value 3,5'],
    ['value 1e-3', 'value 1e3'],
  ])('keeps numeric punctuation distinct: %s versus %s', async (reply, reference) => {
    expect(await judge(reply, reference)).toBe('fail');
    expect(await judge(reference, reply)).toBe('fail');
  });

  it('keeps a decimal comma literal without inferring a locale', async () => {
    expect(await judge('3,5', '3,5')).toBe('pass');
    expect(await judge('3,50', '3,5')).toBe('fail');
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
