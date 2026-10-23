import { describe, expect, it } from 'vitest';
import { variablesFromSources } from '../../src';
import type { SpanLabel } from '../../src/feed/sources';
import {
  createSubjectReconciler,
  type SubjectCandidate,
  type SubjectChoiceReader,
} from '../../src/feed/subject-choices';

const first = {
  text: 'the refund amount is at most 252 euros',
  label: {
    kind: 'numeric',
    subject: 'refund',
    limit: 252,
    comparison: 'le',
    unit: 'euros',
  } satisfies SpanLabel,
};
const second = {
  text: 'the refund amount is over 252 euros',
  label: {
    kind: 'numeric',
    subject: 'refund amount',
    limit: 252,
    comparison: 'gt',
    unit: 'euros',
  } satisfies SpanLabel,
};

function build(clauses: Array<typeof first | typeof second>) {
  return variablesFromSources({
    estate: {
      files: { 'rules.md': clauses.map((clause) => clause.text).join('\n') },
      rules: clauses.map((clause, i) => ({
        id: `R${i + 1}`,
        source: 'rules.md',
        conditions: [clause],
        tools: [],
      })),
    },
  });
}

describe('subject choices across recording batches', () => {
  it('merges two readings only after the reader chooses an existing label id', async () => {
    const reconcile = createSubjectReconciler();
    const calls: SubjectCandidate[][] = [];
    const choose: SubjectChoiceReader = async (_clause, candidates) => {
      calls.push([...candidates]);
      return candidates[0]?.id ?? 'new';
    };
    const a = await reconcile([first], choose);
    const b = await reconcile([second], choose);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([]);
    expect(calls[1]).toEqual([
      expect.objectContaining({ id: expect.any(String), subject: 'refund', unit: 'euros' }),
    ]);
    expect(b[0]?.label.subject).toBe('refund');
    expect(second.label.subject).toBe('refund amount');
    const built = build([...a, ...b]);
    expect(built.store.variables).toHaveLength(1);
    const variable = built.store.variables[0];
    if (variable === undefined) throw new Error('the merged variable is missing');
    expect(Object.values(built.samples[variable.id] ?? {})).toEqual([251, 252, 253]);
    expect(variable.boundaries?.map((boundary) => boundary.comparison).sort()).toEqual(['gt', 'le']);
    for (const value of variable.values) {
      expect(value.provenance).toHaveLength(2);
    }
  });

  it('keeps the same pair separate when the reader chooses new', async () => {
    const reconcile = createSubjectReconciler();
    const a = await reconcile([first], async () => 'new');
    const b = await reconcile([second], async () => 'new');
    expect(build([...a, ...b]).store.variables).toHaveLength(2);
  });

  it('offers labels loaded from the previous recording to a new batch', async () => {
    const reconcile = createSubjectReconciler([first.label]);
    const b = await reconcile([second], async (_clause, candidates) => candidates[0]?.id);
    expect(build([first, ...b]).store.variables).toHaveLength(1);
  });

  it.each(['unknown-id', null, { subject: 'refund' }])('ignores an invalid choice %j', async (choice) => {
    const reconcile = createSubjectReconciler([first.label]);
    expect(await reconcile([second], async () => choice)).toEqual([second]);
  });

  it('never offers a label of another unit or kind', async () => {
    const reconcile = createSubjectReconciler([
      { ...first.label, unit: 'days' },
      { kind: 'boolean', subject: 'refund' },
    ]);
    await reconcile([second], async (_clause, candidates) => {
      expect(candidates).toEqual([]);
      return 'new';
    });
  });
});
