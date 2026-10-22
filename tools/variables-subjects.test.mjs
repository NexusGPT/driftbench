import { describe, expect, it } from 'vitest';
import { variablesFromSources } from '../packages/generate/src/feed/sources';
import {
  applySubjects,
  canonicalSubjects,
  prefixOf,
  shareSubjects,
  soundMap,
} from './variables-subjects.mjs';

const FILE =
  'Escalate when the order value is at least 279 euros.\nEscalate when the order value is at least 57 euros.';
const A = 'the order value is at least 279 euros';
const B = 'the order value is at least 57 euros';
const num = (subject, limit) => ({ kind: 'numeric', subject, limit, comparison: 'ge', unit: 'euros' });
const rowsOf = (...pairs) => pairs.map(([text, label]) => ({ text, label }));

/** How many variables the store reader builds from rows read out of one file. */
function variablesOf(rows) {
  const built = variablesFromSources({
    estate: {
      files: { 'rules.md': FILE },
      rules: rows.map((row, i) => ({
        id: `r${i}`,
        source: 'rules.md',
        conditions: [{ text: row.text, label: row.label }],
        tools: [],
      })),
    },
  });
  return built.store.variables.length;
}

describe('the labels of one quantity', () => {
  const split = rowsOf([A, num('order amount', 279)], [B, num('order value', 57)]);

  it('goes red first: two spans of one quantity with two subjects are two variables', () => {
    expect(variablesOf(split)).toBe(2);
  });

  it('shares one subject between spans with the same text before the first digit', () => {
    expect(prefixOf(A)).toBe('the order value is at least');
    expect(prefixOf(A)).toBe(prefixOf(B));
    expect(variablesOf(shareSubjects(split))).toBe(1);
  });

  it('keeps spans with different prefixes apart, and members and booleans alone', () => {
    const rows = rowsOf(
      ['the delay is at least 2 days', num('delay', 2)],
      ['the refund is at least 2 euros', num('refund', 2)],
      ['the country is one of FR, BE', { kind: 'member', subject: 'country', members: ['FR', 'BE'] }],
      ['the country is one of NL, DE', { kind: 'member', subject: 'nation', members: ['NL', 'DE'] }],
    );
    expect(shareSubjects(rows)).toEqual(rows);
  });

  it('is stable: the subject taken is that of the first span in text order, whatever the row order', () => {
    const a = shareSubjects(split);
    const b = shareSubjects([...split].reverse());
    expect(new Set(a.map((r) => r.label.subject))).toEqual(new Set(b.map((r) => r.label.subject)));
    expect(a[0].label.subject).toBe('order amount');
  });
});

describe('the sibling pass', () => {
  const two = rowsOf(
    ['the order value is above 5 euros', num('order value', 5)],
    ['the basket amount is above 9 euros', num('order amount', 9)],
    ['the delay is above 2 days', num('delay', 2)],
  );

  it('merges two subjects of one quantity when the model says so', async () => {
    const map = await canonicalSubjects(two, async () => ({ 'order amount': 'order value' }));
    expect(map).toEqual({ 'order amount': 'order value' });
    expect(new Set(applySubjects(two, map).map((r) => r.label.subject))).toEqual(
      new Set(['order value', 'delay']),
    );
  });

  it('records only sound answers: unknown subjects, chains, cycles and self maps are dropped or resolved', () => {
    const subjects = ['a', 'b', 'c'];
    expect(soundMap({ a: 'b', b: 'c' }, subjects)).toEqual({ a: 'c', b: 'c' });
    expect(soundMap({ a: 'b', b: 'a' }, subjects)).toEqual({});
    expect(soundMap({ a: 'a', x: 'b', c: 'zzz' }, subjects)).toEqual({});
    expect(soundMap(null, subjects)).toEqual({});
  });

  it('asks in chunks and still returns one map', async () => {
    const rows = ['a', 'b', 'c', 'd'].map((s, i) => ({ text: `t${s} ${i}`, label: num(s, i) }));
    const calls = [];
    const map = await canonicalSubjects(
      rows,
      async (chunk) => {
        calls.push(chunk);
        return chunk.length === 2 ? { [chunk[1]]: chunk[0] } : {};
      },
      2,
    );
    expect(calls).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(map).toEqual({ b: 'a', d: 'c' });
  });
});
