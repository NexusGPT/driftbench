import { describe, expect, it } from 'vitest';
import { type SpanLabel, variablesFromSources } from '../../src/feed/sources';
import { SUBJECT_CHOICE_SYSTEM, spanLabelSystem } from '../../src/feed/span-label-request';
import {
  readSubjectChoice,
  requestSubjectChoice,
  subjectChoiceMaxTokens,
} from '../../src/feed/subject-choice-answer';
import { createSubjectReconciler } from '../../src/feed/subject-choices';

const build = (clauses: Array<{ text: string; label: SpanLabel }>) =>
  variablesFromSources({
    estate: {
      files: { 'policy.md': clauses.map((clause) => clause.text).join('\n') },
      rules: clauses.map((clause, i) => ({
        id: `r${i}`,
        source: 'policy.md',
        conditions: [clause],
        tools: [],
      })),
    },
  });

describe('subject answer failures are not identity choices', () => {
  const candidates = [{ id: 'label-1', subject: 'a quantity', kind: 'numeric' as const }];
  it('rejects truncation even if the text happens to parse as new', () => {
    expect(readSubjectChoice({ text: '"new"', stopReason: 'max_tokens' }, candidates)).toEqual({
      ok: false,
      code: 'truncated',
    });
  });
  it('rejects malformed JSON rather than declaring a new quantity', () => {
    expect(readSubjectChoice({ text: '"label-', stopReason: 'end_turn' }, candidates)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });
  it.each(['"unoffered"', '{"choice":"label-1"}', 'null'])(
    'rejects an answer outside the schema: %s',
    (text) => {
      expect(readSubjectChoice({ text }, candidates)).toEqual({ ok: false, code: 'invalid-choice' });
    },
  );
  it.each(['new', 'label-1'])('accepts the explicit choice %s', (choice) => {
    expect(readSubjectChoice({ text: JSON.stringify(choice), stopReason: 'end_turn' }, candidates)).toEqual({
      ok: true,
      choice,
    });
  });
  it('sizes transport room from the longest JSON string in the schema', () => {
    const long = [
      ...candidates,
      { id: 'label-123456789', subject: 'another quantity', kind: 'numeric' as const },
    ];
    expect(subjectChoiceMaxTokens(long)).toBe(Buffer.byteLength(JSON.stringify('label-123456789')) + 1024);
  });
  it('retries once and retains a recovered truncation in the result', async () => {
    const failures: Array<string | undefined> = [];
    const result = await requestSubjectChoice(candidates, async (failure) => {
      failures.push(failure);
      return failure === undefined
        ? { text: '"new"', stopReason: 'max_tokens' }
        : { text: '"label-1"', stopReason: 'end_turn' };
    });
    expect(result).toEqual({ ok: true, choice: 'label-1', errors: ['truncated'] });
    expect(failures).toEqual([undefined, 'truncated']);
  });
  it.each([
    { text: '"label-', stopReason: 'end_turn', code: 'malformed' },
    { text: '"new"', stopReason: 'max_tokens', code: 'truncated' },
  ])('reports persistent $code after exactly two attempts', async ({ text, stopReason, code }) => {
    let calls = 0;
    const result = await requestSubjectChoice(candidates, async () => {
      calls += 1;
      return { text, stopReason };
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ ok: false, code: 'subject-choice-failed', errors: [code, code] });
  });
});

describe('span labeller request contract', () => {
  it('asks for excluded alternatives as members, with the variable outside the predicate', () => {
    const request = spanLabelSystem('The caller supplies the definition.');
    expect(request).toContain('The caller supplies the definition.');
    expect(request).toContain('members lists the excluded values');
    expect(request).toContain('neither X nor Y');
    expect(request).toContain('subject names the variable, not the whole predicate');
  });

  it('asks both passes to preserve identity across different comparison wordings', () => {
    expect(spanLabelSystem('definition')).toContain(
      'Comparison wording and thresholds do not change the subject',
    );
    expect(SUBJECT_CHOICE_SYSTEM).toContain('A different spelling is not a reason to choose new');
    expect(SUBJECT_CHOICE_SYSTEM).toContain('Different owners or units still mean different quantities');
  });
});

describe('structured answers reach the variable store', () => {
  it('turns excluded membership values into string samples without reading the clause', () => {
    // Deliberately no membership wording: only the structured answer decides the samples.
    const built = build([
      { text: 'Opaque clause A.', label: { kind: 'member', subject: 'plan', members: ['bronze', 'gold'] } },
    ]);
    expect(built.store.variables).toHaveLength(1);
    const variable = built.store.variables[0];
    if (variable === undefined) throw new Error('expected a variable');
    expect(variable.title).toBe('plan');
    expect(Object.values(built.samples[variable.id] ?? {})).toEqual(
      expect.arrayContaining(['bronze', 'gold']),
    );
    expect(Object.values(built.samples[variable.id] ?? {})).toHaveLength(3);
    expect(Object.values(built.samples[variable.id] ?? {}).every((value) => typeof value === 'string')).toBe(
      true,
    );
    expect(variable.boundaries ?? []).toHaveLength(0);
    expect(built.refused).toEqual([]);
  });

  it('merges aliased quantities only after an explicit compatible subject choice', async () => {
    const clauses: Array<{ text: string; label: SpanLabel }> = [
      {
        text: 'Opaque clause A.',
        label: { kind: 'numeric', subject: 'order value', limit: 100, comparison: 'gt', unit: 'euros' },
      },
      {
        text: 'Unrelated wording B.',
        label: { kind: 'numeric', subject: 'order amount', limit: 200, comparison: 'le', unit: 'euros' },
      },
      {
        text: 'Third wording C.',
        label: { kind: 'numeric', subject: 'order amount', limit: 300, comparison: 'ge', unit: 'euros' },
      },
    ];
    expect(build(clauses).store.variables).toHaveLength(2);
    const reconcile = createSubjectReconciler();
    const labelled = await reconcile(clauses, async (_clause, candidates) => candidates[0]?.id ?? 'new');
    const built = build(labelled);
    expect(built.store.variables).toHaveLength(1);
    const variable = built.store.variables[0];
    if (variable === undefined) throw new Error('expected a variable');
    expect(variable.boundaries?.map((boundary) => boundary.limit).sort()).toEqual([100, 200, 300]);
    expect(Object.values(built.samples[variable.id] ?? {})).toHaveLength(9);
    expect(
      built.rules.every((rule) => rule.variables.length === 1 && rule.variables[0] === variable.id),
    ).toBe(true);
    expect(clauses[1]?.label).toMatchObject({ subject: 'order amount', comparison: 'le', limit: 200 });
  });
});
