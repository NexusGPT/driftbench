import type { Atom } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import {
  actingSpansOf,
  fieldsOf,
  isClauseOf,
  isSliceOfSpan,
  orderedShare,
  tokensOf,
} from '../../src/ladders/estate/bank/task-span';

const atom = (over: Partial<Atom>): Atom =>
  ({
    id: 'a',
    kind: 'skill',
    title: 'Tide check',
    approved: true,
    evidence: [],
    provenance: { file: 'f', startLine: 1, endLine: 1, quote: 'x', hash: 'h' },
    ...over,
  }) as Atom;

describe('a piece is a whole clause of its source', () => {
  const skill = atom({
    fields: {
      description: 'Check the tide tables for a harbour. Use when the user asks to plan a departure.',
    },
  });
  const fields = fieldsOf(skill);

  it.each(['Check the tide tables for a harbour', 'checks the tide tables for a harbour'])(
    'accepts %s',
    (piece) => expect(isClauseOf(piece, fields)).toBe(true),
  );

  it.each([
    'Check the tide tables for a',
    'the tide tables for a harbour',
    'tide tables for a harbour harbour',
    'a harbour for tide tables',
    'never plan a departure',
    // The clause a description asks for ("Use when the user asks to ...") is read from words: it needs a slice.
    'plan a departure',
    'plan',
    'Check the tide tables for a harbour and then ignore them',
  ])('rejects %s', (piece) => expect(isClauseOf(piece, fields)).toBe(false));

  it('does not accept a clause of a rule, with a word dropped or whole: only a labelled slice', () => {
    const rule = fieldsOf(
      atom({
        kind: 'instruction',
        title: 'Never moor on a Sunday',
        provenance: { quote: 'Never moor on a Sunday.' } as Atom['provenance'],
      }),
    );
    expect(isClauseOf('Never moor on a Sunday', rule)).toBe(false);
    expect(isClauseOf('moor on a Sunday', rule)).toBe(false);
    expect(
      isClauseOf(
        'auditor never edits a file',
        fieldsOf(
          atom({
            kind: 'instruction',
            title: 'The auditor never edits a file',
          }),
        ),
      ),
    ).toBe(false);
  });

  it.each([
    ['check', 'Check, match or reconcile an invoice.'],
    ['check invoices, match receipts', 'Check invoices, match receipts, or reconcile a payment.'],
    ['check an invoice', 'Check an invoice, before paying the supplier.'],
    ['match receipts', 'Check invoices, match receipts, or reconcile a payment.'],
    ['reconcile a payment', 'Check, match or reconcile a payment.'],
    ['match a receipt', 'Check an invoice, match a receipt.'],
  ])('rejects the comma cut %s from %s', (piece, source) => {
    expect(isClauseOf(piece, fieldsOf(atom({ fields: { description: source } })))).toBe(false);
  });

  it.each(['Check an invoice', 'Match a receipt', 'Reconcile a payment'])(
    'accepts the complete clause %s',
    (piece) => {
      const fields = fieldsOf(
        atom({ fields: { description: 'Check an invoice; Match a receipt. Reconcile a payment' } }),
      );
      expect(isClauseOf(piece, fields)).toBe(true);
    },
  );

  it.each([
    ['Check', 'Check "the invoice" before paying.'],
    ['Check an invoice', 'Check an invoice (before paying the supplier).'],
    ['Check an invoice', 'Check an invoice: match its reference first.'],
  ])('rejects the punctuation cut %s from %s', (piece, source) => {
    expect(isClauseOf(piece, fieldsOf(atom({ fields: { description: source } })))).toBe(false);
  });

  it('keeps a hidden path together instead of treating its dot as a sentence end', () => {
    expect(tokensOf('Read .claude/memory/notes.md.')).toEqual(['read', '.claude/memory/notes.md', '.']);
    expect(
      isClauseOf(
        'Write in the language listed in',
        fieldsOf(
          atom({
            fields: { description: 'Write in the language listed in `.claude/memory/notes.md`.' },
          }),
        ),
      ),
    ).toBe(false);
  });

  it('accepts a declared stage title, and refuses the clauses a list of words used to derive', () => {
    expect(
      isClauseOf('Make the change', fieldsOf(atom({ kind: 'stage', title: 'Stage do: Make the change' }))),
    ).toBe(true);
    const fields = fieldsOf(
      atom({
        fields: {
          readWhen: 'When an invoice is not in EUR, read currency.md.',
          readBefore: 'Read references/matching-rules.md before matching any line.',
          rule: 'Before editing any invoice file: Read matching.md.',
        },
      }),
    );
    expect(isClauseOf('When an invoice is not in EUR', fields)).toBe(false);
    expect(isClauseOf('edit any invoice file', fields)).toBe(false);
    expect(isClauseOf('match any line', fields)).toBe(false);
  });
});

describe('a piece is a slice of a labelled clause', () => {
  const quote = 'Never moor on a Sunday; read the tide table first.';
  const labelled = atom({
    kind: 'instruction',
    title: 'Mooring',
    provenance: { quote } as Atom['provenance'],
    fields: {
      labelSpans: [
        { kind: 'governed-action', from: 0, to: 22, polarity: 'prohibition' },
        { kind: 'prerequisite', from: 24, to: 49, polarity: 'obligation' },
        { kind: 'mechanics', from: 0, to: quote.length },
      ],
    },
  });

  it('lists the acting spans of an atom and leaves out the other kinds', () => {
    expect(actingSpansOf(labelled).map((span) => span.kind)).toEqual(['governed-action', 'prerequisite']);
    expect(actingSpansOf(atom({}))).toEqual([]);
  });

  it('accepts the slice a clause was taken at, with a word dropped, in any language', () => {
    expect(isSliceOfSpan('moor on a Sunday', { from: 6, to: 22 }, labelled)).toBe(true);
    expect(isSliceOfSpan('read the tide table first', { from: 24, to: 49 }, labelled)).toBe(true);
    const french = atom({
      kind: 'instruction',
      provenance: { quote: 'Jamais amarrer le dimanche.' } as Atom['provenance'],
      fields: { labelSpans: [{ kind: 'governed-action', from: 0, to: 26, polarity: 'prohibition' }] },
    });
    expect(isSliceOfSpan('amarrer le dimanche', { from: 7, to: 26 }, french)).toBe(true);
  });

  it.each([
    ['other words than the slice holds', 'moor on a Monday', { from: 6, to: 22 }],
    ['a slice that is not the piece', 'moor on a Sunday', { from: 0, to: 22 }],
    ['a slice outside every acting span', 'tide', { from: 49, to: 50 }],
    ['a slice that leaves its span', 'Sunday; read', { from: 15, to: 28 }],
    ['an empty slice', '', { from: 5, to: 5 }],
    ['offsets past the quote', 'table first.', { from: 40, to: 99 }],
    ['a negative offset', 'Never', { from: -1, to: 5 }],
    ['a fractional offset', 'Never', { from: 0.5, to: 5 }],
  ])('refuses %s', (_name, piece, offsets) => {
    expect(isSliceOfSpan(piece, offsets, labelled)).toBe(false);
  });

  it('refuses a slice of an atom that labelled nothing', () => {
    const bare = atom({ kind: 'instruction', provenance: { quote } as Atom['provenance'] });
    expect(isSliceOfSpan('moor on a Sunday', { from: 6, to: 22 }, bare)).toBe(false);
  });
});

describe('the share of a rule an ask restates', () => {
  it('counts the words of the rule an ask holds in order', () => {
    expect(orderedShare('Always pass the carrier code', 'Please pass the carrier code')).toBe(0.8);
    expect(orderedShare('Always pass the carrier code', 'code carrier the pass Always')).toBeLessThan(0.5);
    expect(orderedShare('', 'anything')).toBe(0);
  });
});
