import { describe, expect, it } from 'vitest';
import { variablesFromSources } from '../../src';
import type { SpanLabel } from '../../src/feed/sources';
import { createSubjectReconciler, type SubjectChoiceReader } from '../../src/feed/subject-choices';

const known = {
  kind: 'numeric',
  subject: 'refund',
  limit: 20,
  comparison: 'le',
  unit: 'euros',
} satisfies SpanLabel;
const refund = 'A refund is limited to 20 euros.';
const shipping = 'A shipping budget is limited to 20 euros.';
const clause = (text: string) => ({ text, label: { ...known, subject: 'refund amount' } });

function build(clauses: ReturnType<typeof clause>[]) {
  return variablesFromSources({
    estate: {
      files: { 'rules.md': clauses.map((entry) => entry.text).join('\n') },
      rules: clauses.map((entry, i) => ({
        id: `R${i}`,
        source: 'rules.md',
        conditions: [entry],
        tools: [],
      })),
    },
  });
}

describe('independent subject choices (review run 39879833091)', () => {
  it('asks again for a different clause even when the first label spelling matches', async () => {
    const reconcile = createSubjectReconciler([known]);
    let calls = 0;
    const choose: SubjectChoiceReader = async (entry, candidates) => {
      calls += 1;
      return entry.text === refund ? candidates[0]?.id : 'new';
    };
    const a = await reconcile([clause(refund)], choose);
    const b = await reconcile([clause(shipping)], choose);
    expect(build([...a, ...b]).store.variables).toHaveLength(2);
    expect(calls).toBe(2);
    expect(b[0]?.label.subject).toBe('refund amount');
  });

  it('new never chooses the old cached id for another clause in the same batch', async () => {
    const reconcile = createSubjectReconciler([known]);
    let calls = 0;
    const rows = await reconcile([clause(refund), clause(shipping)], async (entry, candidates) => {
      calls += 1;
      return entry.text === refund ? candidates[0]?.id : 'new';
    });
    expect(build(rows).store.variables).toHaveLength(2);
    expect(calls).toBe(2);
    expect(rows.map((entry) => entry.label.subject)).toEqual(['refund', 'refund amount']);
  });
});
