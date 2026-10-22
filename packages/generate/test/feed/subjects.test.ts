import { describe, expect, it } from 'vitest';
import {
  applySubjects,
  canonicalSubjects,
  prefixOf,
  type SpanLabel,
  shareSubjects,
  soundMap,
  variablesFromSources,
} from '../../src';

const A = 'the order value is at least 279 euros';
const B = 'the order value is at least 57 euros';
const FILE = `Escalate when ${A}.\nEscalate when ${B}.`;
const num = (subject: string, limit: number): SpanLabel => ({
  kind: 'numeric',
  subject,
  limit,
  comparison: 'ge',
  unit: 'euros',
});

/** How many variables the store reader builds from labelled clauses read out of one file. */
function variablesOf(clauses: Array<{ text: string; label?: SpanLabel }>, share = false): number {
  const built = variablesFromSources({
    estate: {
      files: { 'rules.md': FILE },
      rules: clauses.map((clause, i) => ({
        id: `r${i}`,
        source: 'rules.md',
        conditions: [{ text: clause.text, ...(clause.label ? { label: clause.label } : {}) }],
        tools: [],
      })),
    },
    ...(share ? {} : {}),
  });
  return built.store.variables.length;
}

describe('one quantity, one subject', () => {
  const split = [
    { text: A, label: num('order amount', 279) },
    { text: B, label: num('order value', 57) },
  ];

  it('the store reader merges two clauses of one prefix that carry two subjects into one variable', () => {
    expect(variablesOf(split)).toBe(1);
  });

  it('shares the subject of the first clause in text order, whatever the order of the clauses', () => {
    expect(prefixOf(A)).toBe('the order value is at least');
    expect(prefixOf(A)).toBe(prefixOf(B));
    const forward = shareSubjects(split);
    const backward = shareSubjects([...split].reverse());
    const subjects = (list: typeof split) =>
      new Set(list.map((c) => (c.label.kind === 'numeric' ? c.label.subject : '')));
    expect(subjects(forward)).toEqual(new Set(['order amount']));
    expect(subjects(backward)).toEqual(new Set(['order amount']));
  });

  it('keeps clauses with different prefixes apart, and leaves members and booleans alone', () => {
    const clauses = [
      { text: 'the delay is at least 2 days', label: num('delay', 2) },
      { text: 'the refund is at least 2 euros', label: num('refund', 2) },
      {
        text: 'the country is one of FR, BE',
        label: { kind: 'member', subject: 'country', members: ['FR', 'BE'] } as SpanLabel,
      },
      {
        text: 'the country is one of NL, DE',
        label: { kind: 'member', subject: 'nation', members: ['NL', 'DE'] } as SpanLabel,
      },
    ];
    expect(shareSubjects(clauses)).toEqual(clauses);
  });

  it('does not change its input', () => {
    const before = JSON.stringify(split);
    shareSubjects(split);
    expect(JSON.stringify(split)).toBe(before);
  });
});

describe('the sibling pass', () => {
  const three = [
    { text: 'the order value is above 5 euros', label: num('order value', 5) },
    { text: 'the basket amount is above 9 euros', label: num('order amount', 9) },
    { text: 'the delay is above 2 days', label: num('delay', 2) },
  ];

  it('merges two subjects of one quantity when the reader says so', async () => {
    const map = await canonicalSubjects(three, async () => ({ 'order amount': 'order value' }));
    expect(map).toEqual({ 'order amount': 'order value' });
    const subjects = new Set(
      applySubjects(three, map).map((c) => (c.label.kind === 'numeric' ? c.label.subject : '')),
    );
    expect(subjects).toEqual(new Set(['order value', 'delay']));
  });

  it('records only sound answers', () => {
    const subjects = ['a', 'b', 'c'];
    expect(soundMap({ a: 'b', b: 'c' }, subjects)).toEqual({ a: 'c', b: 'c' });
    expect(soundMap({ a: 'b', b: 'a' }, subjects)).toEqual({});
    expect(soundMap({ a: 'a', x: 'b', c: 'zzz' }, subjects)).toEqual({});
    expect(soundMap(null, subjects)).toEqual({});
  });

  it('asks in chunks and returns one map', async () => {
    const clauses = ['a', 'b', 'c', 'd'].map((s, i) => ({ text: `t${s} ${i}`, label: num(s, i) }));
    const calls: string[][] = [];
    const map = await canonicalSubjects(
      clauses,
      async (chunk) => {
        calls.push(chunk);
        return chunk.length === 2 ? { [chunk[1] as string]: chunk[0] } : {};
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

describe('never merge on words alone: the unit decides', () => {
  const lab = (subject: string, unit: string, limit = 5): SpanLabel => ({
    kind: 'numeric',
    subject,
    limit,
    comparison: 'le',
    unit,
  });

  it('keeps two subjects when the same words come before numbers of other units', () => {
    const pair = shareSubjects([
      { text: 'The limit is 5 retries', label: lab('retry limit', 'retries') },
      { text: 'The limit is 40 items', label: lab('item limit', 'items', 40) },
    ]);
    expect(pair.map((c) => (c.label?.kind === 'numeric' ? c.label.subject : ''))).toEqual(['retry limit', 'item limit']);
    const cap = shareSubjects([
      { text: 'The cap is at most 5 euros', label: lab('price cap', 'euros') },
      { text: 'The cap is at most 5 percent', label: lab('discount cap', 'percent') },
    ]);
    expect(cap.map((c) => (c.label?.kind === 'numeric' ? c.label.subject : ''))).toEqual(['price cap', 'discount cap']);
  });

  it('still shares a subject when the units agree, or both are absent', () => {
    const same = shareSubjects([
      { text: 'The cap is at most 5 euros', label: lab('price cap', 'euros') },
      { text: 'The cap is at most 9 euros', label: lab('cap price', 'euros', 9) },
    ]);
    expect(new Set(same.map((c) => (c.label?.kind === 'numeric' ? c.label.subject : ''))).size).toBe(1);
  });

  it('refuses a model map across units and accepts one within a unit', async () => {
    const clauses = [
      { text: 'a 5 retries', label: lab('retry limit', 'retries') },
      { text: 'b 5 euros', label: lab('order value', 'euros') },
      { text: 'c 5 euros', label: lab('order amount', 'euros') },
    ];
    const map = await canonicalSubjects(clauses, async () => ({
      'retry limit': 'order value',
      'order amount': 'order value',
    }));
    expect(map).toEqual({ 'order amount': 'order value' });
  });

  it('refuses a merge when one subject carries two units', () => {
    const units = new Map([
      ['a', new Set(['euros', 'percent'])],
      ['b', new Set(['euros'])],
    ]);
    expect(soundMap({ a: 'b' }, ['a', 'b'], units)).toEqual({});
  });
});
