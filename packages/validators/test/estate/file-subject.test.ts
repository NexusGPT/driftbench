import type { Atom } from '@agent-nexus/driftbench-estate';
import {
  fileSubjectDerivation,
  renderAsk,
  SLOT,
  SUBJECT_SHAPE,
  SUBJECT_TAIL,
} from '@agent-nexus/driftbench-generate';
import { expect, it } from 'vitest';
import { fieldsOf, isClauseOf } from '../../src/ladders/estate/bank/task-span';

it('derives complete subject clauses from path structure without a filename word list', () => {
  expect(fileSubjectDerivation('references/glaze-recipes.md')).toBe('glaze recipes');
  expect(fileSubjectDerivation('data-3.json')).toBe('data 3');
  expect(fileSubjectDerivation('references/README.md')).toBe('readme');
  expect(fileSubjectDerivation('references/berthify-ledger.md')).toBe('berthify ledger');
  expect(fileSubjectDerivation('This sentence has spaces.')).toBeUndefined();
  expect(fileSubjectDerivation(null)).toBeUndefined();
  const atom = {
    kind: 'reference',
    title: 'Reference file',
    provenance: { quote: '' },
    fields: { path: 'references/glaze-recipes.md' },
  } as unknown as Atom;
  expect(isClauseOf('glaze recipes', fieldsOf(atom))).toBe(true);
  expect(isClauseOf('glaze', fieldsOf(atom))).toBe(false);
  expect(isClauseOf('unrelated subject', fieldsOf(atom))).toBe(false);
});

it('re-renders both declared subject shapes exactly from their pieces', () => {
  expect(
    renderAsk({ frame: 'trigger', shape: SUBJECT_SHAPE, pieces: ['reconcile an invoice', 'glaze recipes'] }),
  ).toBe('Please reconcile an invoice, including the glaze recipes.');
  expect(
    renderAsk({
      frame: 'trigger',
      shape: `help me with ${SLOT}${SUBJECT_TAIL}`,
      pieces: ['an invoice', 'glaze recipes'],
    }),
  ).toBe('Please help me with an invoice, including the glaze recipes.');
});
