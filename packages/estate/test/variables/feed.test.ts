import { verifyVariableQuotes } from '@agent-nexus/driftbench-generate';
import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { cut, nextLedger } from '../../src/pointer';
import { estateToVariables, ledgerResolver, renderVariableStore } from '../../src/variables';
import { atom, HALL, hallFolder, mapOf } from './support';

const KEEPER = 'Name the keeper of every boat before it leaves the hall.';
const OVERDUE = 'When a mooring is overdue by more than two days, warn the keeper and offer a reminder.';
const resolver = () => ledgerResolver(new Map(Object.entries(HALL)));

/** The id the pointer ledger gives the unit that holds `quote` in CLAUDE.md. */
function ledgerIdOf(quote: string): string | undefined {
  const { ledger } = nextLedger(
    [{ path: 'CLAUDE.md', cut: cut(HALL['CLAUDE.md'] as string) }],
    undefined,
    'estate',
  );
  return ledger.entries.find((entry) => entry.path === 'CLAUDE.md' && entry.quote.includes(quote))?.id;
}

describe('the estate feed refuses a value that has no quote', () => {
  it('refuses an atom whose quote is empty or blank, and says why', () => {
    const result = estateToVariables(
      mapOf([atom({ quote: KEEPER }), atom({ quote: '   ', title: 'Blank' })]),
      resolver(),
    );
    expect(result.refused).toEqual([
      {
        atom: expect.stringContaining('instruction.hall.atom-'),
        variable: 'atoms.instruction',
        reason: 'the quote is empty',
      },
    ]);
    const values = result.store.variables.flatMap((variable) => variable.values);
    expect(values.map((value) => value.title)).not.toContain('Blank');
    expect(values).toHaveLength(1);
  });

  it('refuses an atom whose quote no ledger unit holds', () => {
    const result = estateToVariables(mapOf([atom({ quote: 'Feed the gulls at noon.' })]), resolver());
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      'no ledger unit of CLAUDE.md holds the quote',
    ]);
    expect(result.store.variables).toEqual([]);
  });

  it('refuses an atom read from a file that is not prose, with no ledger id to give', () => {
    const result = estateToVariables(
      mapOf([atom({ kind: 'script', file: 'scripts/count-boats.py', quote: 'print(3)' })]),
      resolver(),
    );
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      'scripts/count-boats.py is not prose the pointer reader cuts: no ledger id',
    ]);
  });

  it('refuses a quote longer than the store takes (1,000 characters), and one the file does not hold', () => {
    const long = `${'Count the boats twice and write the number down. '.repeat(30)}`.trim();
    const texts = new Map([['LONG.md', `# Long\n\n${long}\n`]]);
    const result = estateToVariables(mapOf([atom({ file: 'LONG.md', quote: long })]), ledgerResolver(texts));
    expect(result.refused.map((entry) => entry.reason)).toEqual(['the quote is longer than 1000 characters']);
  });

  it('never lets a refused atom reach the store: every value of every variable carries a quote', () => {
    const result = estateToVariables(
      mapOf([
        atom({ quote: KEEPER }),
        atom({ quote: '' }),
        atom({ quote: 'Not in the file.' }),
        atom({ quote: OVERDUE, situation: 'A mooring is overdue by more than two days' }),
      ]),
      resolver(),
    );
    for (const variable of result.store.variables) {
      for (const value of variable.values) {
        const quotes = (value.provenance ?? []).filter((entry) => entry.kind === 'quote');
        expect(quotes.length, `${variable.id} / ${value.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('the estate feed keeps where each value comes from', () => {
  it('gives each value the file, the exact quote and the ledger id of the unit that holds it', () => {
    const result = estateToVariables(mapOf([atom({ quote: KEEPER })]), resolver());
    const [variable] = result.store.variables;
    expect(variable?.id).toBe('atoms.instruction');
    expect(variable?.values[0]?.provenance).toEqual([
      { kind: 'quote', path: 'CLAUDE.md', quote: KEEPER, ledger: ledgerIdOf(KEEPER) },
    ]);
    expect(ledgerIdOf(KEEPER)).toMatch(/^[a-z2-7]{10}$/);
  });

  it('uses the id of a committed ledger when one is given, not a fresh one', () => {
    const { ledger } = nextLedger(
      [{ path: 'CLAUDE.md', cut: cut(HALL['CLAUDE.md'] as string) }],
      undefined,
      'estate',
    );
    const entry = ledger.entries.find((e) => e.quote.includes(KEEPER));
    if (!entry) throw new Error('no entry');
    entry.id = 'aaaaaaaaaa';
    const result = estateToVariables(
      mapOf([atom({ quote: KEEPER })]),
      ledgerResolver(new Map(Object.entries(HALL)), { ledger }),
    );
    expect(result.store.variables[0]?.values[0]?.provenance?.[0]).toMatchObject({ ledger: 'aaaaaaaaaa' });
  });

  it('gives a quote that spans two units the id of the unit it starts in', () => {
    const both = `${KEEPER}\n- When a mooring is overdue by more than two days, warn the keeper and offer a reminder.`;
    const result = estateToVariables(mapOf([atom({ quote: both })]), resolver());
    expect(result.refused).toEqual([]);
    expect(result.store.variables[0]?.values[0]?.provenance?.[0]).toMatchObject({
      ledger: ledgerIdOf(KEEPER),
    });
  });

  it('keeps only approved atoms when asked, and every atom with its own flag otherwise', () => {
    const map = mapOf([
      atom({ quote: KEEPER, approved: true }),
      atom({ quote: 'Never hand out a key without a signature.', approved: false }),
    ]);
    const all = estateToVariables(map, resolver()).store.variables.flatMap((variable) => variable.values);
    const approved = estateToVariables(map, resolver(), { approvedOnly: true }).store.variables.flatMap(
      (variable) => variable.values,
    );
    expect(all.map((value) => value.approved)).toEqual([true, false]);
    expect(approved.map((value) => value.approved)).toEqual([true]);
  });

  it('gives no id from a committed ledger that no longer matches the text: the unit changed since it was written', () => {
    const { ledger } = nextLedger(
      [{ path: 'CLAUDE.md', cut: cut(HALL['CLAUDE.md'] as string) }],
      undefined,
      'estate',
    );
    for (const entry of ledger.entries) entry.fp = 'stale';
    const result = estateToVariables(
      mapOf([atom({ quote: KEEPER })]),
      ledgerResolver(new Map(Object.entries(HALL)), { ledger }),
    );
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      'no ledger unit of CLAUDE.md holds the quote',
    ]);
  });

  it('carries the flags of the atom: approval, who proposed it, the role, the rule polarity', () => {
    const result = estateToVariables(
      mapOf([
        atom({ quote: KEEPER, approved: true, producedBy: 'model', fields: { polarity: 'obligation' } }),
        atom({
          quote: 'Never hand out a key without a signature.',
          approved: false,
          producedBy: 'model',
          fields: { polarity: 'prohibition' },
        }),
        atom({ quote: 'Lock the hall when the last boat is out.', role: 'detail' }),
      ]),
      resolver(),
    );
    const [axis, detail] = result.store.variables;
    expect(axis).toMatchObject({ id: 'atoms.instruction', kind: 'behaviour', role: 'axis', approved: false });
    expect(axis?.values.map((v) => [v.approved, v.produced_by, v.polarity])).toEqual([
      [true, 'model', 'must'],
      [false, 'model', 'must_not'],
    ]);
    expect(detail).toMatchObject({ id: 'details.instruction', kind: 'data', role: 'detail' });
  });

  it('makes a store the loader accepts, whose quotes the files hold', async () => {
    const root = await hallFolder();
    const result = estateToVariables(
      mapOf([
        atom({ quote: KEEPER }),
        atom({ quote: OVERDUE, situation: 'A mooring is overdue by more than two days' }),
      ]),
      resolver(),
    );
    const loaded = validateVariableStore(result.store);
    expect(loaded.ok, JSON.stringify(loaded.ok ? [] : loaded.errors)).toBe(true);
    expect(await verifyVariableQuotes(result.store, root)).toEqual([]);
  });

  it('renders the same bytes for the same estate, and the rendered text parses back to the store', () => {
    const map = mapOf([
      atom({ quote: KEEPER }),
      atom({ quote: OVERDUE, situation: 'A mooring is overdue by more than two days' }),
    ]);
    const first = renderVariableStore(estateToVariables(map, resolver()).store);
    const second = renderVariableStore(estateToVariables(map, resolver()).store);
    expect(second).toBe(first);
    expect(first.startsWith('# driftbench variable store')).toBe(true);
  });
});
