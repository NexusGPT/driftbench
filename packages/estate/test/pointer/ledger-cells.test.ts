import { describe, expect, it } from 'vitest';
import { checkLedger, cut, type Ledger, nextLedger, parseLedger, renderLedger } from '../../src/pointer';

// Invented files: a harbour office with a duty table.
const scan = (text: string, previous?: Ledger) =>
  nextLedger([{ path: 'duties.md', cut: cut(text), text }], previous, 'harbour');

const LONG_A = 'Count the ropes on the north quay before the first boat leaves the harbour';
const LONG_B = 'Check the lamps on the south pier after the last boat is tied up for the night';
const table = (rows: string[][], header = ['Duty', 'Done']) =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');

const idOf = (ledger: Ledger, quote: string, nth = 0) =>
  ledger.entries.filter((entry) => entry.status === 'live' && entry.quote === quote)[nth]?.id as string;

describe('a table cell in the cutter and the ledger', () => {
  it('gives each cell its row key, column header and table', () => {
    const cells = cut(
      `${table([
        [LONG_A, 'Yes'],
        [LONG_B, 'No'],
      ])}\n`,
    ).units.filter((unit) => unit.container === 'table_cell');
    expect(cells.map((unit) => unit.cell)).toEqual([
      { row: '', column: 'Duty', table: 1 },
      { row: '', column: 'Done', table: 1 },
      { row: LONG_A, column: 'Duty', table: 1 },
      { row: LONG_A, column: 'Done', table: 1 },
      { row: LONG_B, column: 'Duty', table: 1 },
      { row: LONG_B, column: 'Done', table: 1 },
    ]);
  });

  it('keeps a short cell through a move of its row and a new column, by its row key and column header', () => {
    const before = scan(
      `${table([
        [LONG_A, 'Yes'],
        [LONG_B, 'Yes'],
      ])}\n`,
    );
    const [a, b] = [idOf(before.ledger, 'Yes', 0), idOf(before.ledger, 'Yes', 1)];
    const after = scan(
      `${table(
        [
          [LONG_B, 'Ben', 'Yes'],
          [LONG_A, 'Ana', 'Yes'],
        ],
        ['Duty', 'Owner', 'Done'],
      )}\n`,
      before.ledger,
    );
    const cellOf = (id: string) => after.ledger.entries.find((entry) => entry.id === id);
    expect(cellOf(a)).toMatchObject({ status: 'live', cell: { row: LONG_A, column: 'Done' } });
    expect(cellOf(b)).toMatchObject({ status: 'live', cell: { row: LONG_B, column: 'Done' } });
  });

  it('gives a short cell a new id when its row key is rewritten, and deletes the old one', () => {
    const before = scan(
      `${table([
        [LONG_A, 'Yes'],
        [LONG_B, 'Yes'],
      ])}\n`,
    );
    const [a, b] = [idOf(before.ledger, 'Yes', 0), idOf(before.ledger, 'Yes', 1)];
    const after = scan(
      `${table([
        ['Walk the full length of the new breakwater at dusk and log it', 'Yes'],
        ['Wash the decks of the ferry before the morning crossing starts', 'Yes'],
      ])}\n`,
      before.ledger,
    );
    expect(after.eventsById[a]).toBe('deleted');
    expect(after.eventsById[b]).toBe('deleted');
    const live = after.ledger.entries.filter((entry) => entry.status === 'live' && entry.quote === 'Yes');
    expect(live).toHaveLength(2);
    expect(live.map((entry) => entry.id)).not.toContain(a);
  });

  it('keeps every cell of an unchanged table on a rescan', () => {
    const text = `${table([
      [LONG_A, 'Yes'],
      [LONG_B, 'Yes'],
    ])}\n`;
    const first = scan(text);
    const second = scan(text, first.ledger);
    expect(second.ledger.entries.map((entry) => entry.id)).toEqual(
      first.ledger.entries.map((entry) => entry.id),
    );
    expect(second.events.new).toBe(0);
    expect(second.events.deleted).toBe(0);
  });

  it('reads and checks a ledger written before cells were kept, and follows its cells', () => {
    const text = `${table([
      [LONG_A, 'Yes'],
      [LONG_B, 'No'],
    ])}\n`;
    const current = scan(text);
    const old: Ledger = JSON.parse(renderLedger(current.ledger));
    for (const entry of old.entries) delete entry.cell;
    const raw = renderLedger(old);
    // It parses with no cell on any entry, and the check against today's scan names no file.
    expect(parseLedger(raw)?.entries.every((entry) => entry.cell === undefined)).toBe(true);
    expect(checkLedger(raw, current.ledger)).toEqual({ ok: true });
    // Rescanning with it follows every unit as before: no new id, no deletion.
    const again = scan(text, parseLedger(raw));
    expect(again.events.new).toBe(0);
    expect(again.events.deleted).toBe(0);
    expect(again.ledger.entries.map((entry) => entry.id).sort()).toEqual(
      current.ledger.entries.map((entry) => entry.id).sort(),
    );
  });
});
