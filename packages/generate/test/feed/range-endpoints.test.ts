import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { type SpanLabel, variablesFromSources } from '../../src/feed/sources';
import { spanLabelSystem } from '../../src/feed/span-label-request';

function build(lowInclusive: boolean, highInclusive: boolean) {
  const label = {
    kind: 'range',
    subject: 'history length',
    low: 18,
    high: 24,
    unit: 'turns',
    lowInclusive,
    highInclusive,
  };
  return variablesFromSources({
    estate: {
      files: { 'policy.md': 'Opaque condition.' },
      rules: [
        {
          id: 'R1',
          source: 'policy.md',
          tools: [],
          conditions: [{ text: 'Opaque condition.', label: label as SpanLabel }],
        },
      ],
    },
  });
}

describe('range endpoints remain the written endpoints', () => {
  it('keeps shared range boundaries deterministic when their interior witnesses differ', () => {
    const clauses = [24, 40].map((high, i) => ({
      text: `${i === 0 ? 'Alpha' : 'Omega'} condition.`,
      label: {
        kind: 'range' as const,
        subject: 'quantity',
        low: 18,
        high,
        lowInclusive: false,
        highInclusive: false,
      },
    }));
    const make = (reverse: boolean) =>
      variablesFromSources({
        estate: {
          files: { 'policy.md': clauses.map((clause) => clause.text).join('\n') },
          rules: [
            {
              id: 'R1',
              source: 'policy.md',
              tools: [],
              conditions: reverse ? [...clauses].reverse() : clauses,
            },
          ],
        },
      });
    expect(make(false)).toEqual(make(true));
    expect(make(false).store.variables[0]?.boundaries).toHaveLength(3);
  });
  it('requests exact endpoints and separate inclusivity flags', () => {
    const prompt = spanLabelSystem('definition');
    expect(prompt).toContain('"lowInclusive":<boolean>');
    expect(prompt).toContain('"highInclusive":<boolean>');
    expect(prompt).toContain('Never shift an endpoint');
  });
  it.each([
    [false, false, 'gt', 'lt'],
    [true, true, 'ge', 'le'],
    [false, true, 'gt', 'le'],
    [true, false, 'ge', 'lt'],
  ] as const)(
    'applies flags %s/%s without moving the numbers',
    (lowInclusive, highInclusive, lowComparison, highComparison) => {
      const built = build(lowInclusive, highInclusive);
      expect(built.refused).toEqual([]);
      expect(validateVariableStore(built.store).ok).toBe(true);
      expect(built.store.variables).toHaveLength(1);
      const variable = built.store.variables[0];
      if (!variable) throw new Error('missing range variable');
      expect(Object.values(built.samples[variable.id] ?? {}).sort((a, b) => Number(a) - Number(b))).toEqual([
        17, 18, 21, 24, 25,
      ]);
      expect(variable.boundaries).toHaveLength(2);
      const boundaries = [...(variable.boundaries ?? [])].sort((a, b) => Number(a.limit) - Number(b.limit));
      expect(boundaries.map(({ limit, comparison }) => ({ limit, comparison }))).toEqual([
        { limit: 18, comparison: lowComparison },
        { limit: 24, comparison: highComparison },
      ]);
      for (const boundary of boundaries) {
        expect(built.samples[variable.id]?.[boundary.edge]).toBe(boundary.limit);
        expect(built.samples[variable.id]?.[boundary.holds]).toBe(21);
        expect(built.samples[variable.id]?.[boundary.fails]).toBe(boundary.limit === 18 ? 17 : 25);
      }
    },
  );
});
