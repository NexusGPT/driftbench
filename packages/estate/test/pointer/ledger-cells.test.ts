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

  it('keeps the id of a short cell whose text became a long unique one, at the same row key and column header', () => {
    const before = scan(
      `${table([
        [LONG_A, 'Yes'],
        [LONG_B, 'No'],
      ])}\n`,
    );
    const id = idOf(before.ledger, 'Yes');
    const longer = 'Calibration completed successfully and signed off by the harbour master';
    const after = scan(
      `${table([
        [LONG_A, longer],
        [LONG_B, 'No'],
      ])}\n`,
      before.ledger,
    );
    expect(after.ledger.entries.find((entry) => entry.id === id)).toMatchObject({
      status: 'live',
      quote: longer,
      cell: { row: LONG_A, column: 'Done' },
    });
    expect(after.eventsById[id]).toBe('changed');
  });

  it('keeps the id of the surviving cell when two rows shared a long status and one row is removed', () => {
    const status = 'Calibration completed successfully and signed off by the harbour master';
    const before = scan(
      `${table([
        [LONG_A, status],
        [LONG_B, status],
      ])}\n`,
    );
    const survivor = before.ledger.entries.find(
      (entry) => entry.status === 'live' && entry.quote === status && entry.cell?.row === LONG_B,
    )?.id as string;
    const gone = before.ledger.entries.find(
      (entry) => entry.status === 'live' && entry.quote === status && entry.cell?.row === LONG_A,
    )?.id as string;
    const after = scan(`${table([[LONG_B, status]])}\n`, before.ledger);
    expect(after.ledger.entries.find((entry) => entry.id === survivor)).toMatchObject({
      status: 'live',
      cell: { row: LONG_B, column: 'Done' },
    });
    expect(after.eventsById[gone]).toBe('deleted');
  });

  it('keeps both ids when one row takes the long status another row already has, and that row is untouched', () => {
    const status = 'Calibration completed successfully and signed off by the harbour master';
    const before = scan(
      `${table([
        [LONG_A, 'Yes'],
        [LONG_B, status],
      ])}\n`,
    );
    const [a, b] = [idOf(before.ledger, 'Yes'), idOf(before.ledger, status)];
    const after = scan(
      `${table([
        [LONG_A, status],
        [LONG_B, status],
      ])}\n`,
      before.ledger,
    );
    const at = (id: string) => after.ledger.entries.find((entry) => entry.id === id);
    expect(at(a)).toMatchObject({ status: 'live', quote: status, cell: { row: LONG_A, column: 'Done' } });
    expect(at(b)).toMatchObject({ status: 'live', quote: status, cell: { row: LONG_B, column: 'Done' } });
  });

  // Tables of 2 or 3 rows with distinct row keys and a status column, edited: a row's status changed to a short, a long
  // or a repeated text, a row removed, the rows in another order. Whatever happens to the text, a status cell whose row
  // key and column header survive keeps its id. Every table of 2 rows and every edit is tried, then random tables of 3.
  const KEYS = [LONG_A, LONG_B, 'Inspect the fenders along the whole length of the east wall each week'];
  const STATUSES = [
    'Yes',
    'No',
    'Calibration completed successfully and signed off by the harbour master',
    'Waiting for the supplier to deliver the replacement valve for the pump',
  ];
  const check = (label: string, before: string[][], after: string[][]) => {
    const first = scan(`${table(before)}\n`);
    const ids = new Map(
      before.map(([key]) => [
        key as string,
        first.ledger.entries.find(
          (entry) => entry.status === 'live' && entry.cell?.row === key && entry.cell?.column === 'Done',
        )?.id as string,
      ]),
    );
    const second = scan(`${table(after)}\n`, first.ledger);
    for (const [key, status] of after) {
      // A long text that is unique in its table follows by its text, with the key only while the text is kin: one
      // rewritten into an unrelated text (here, any other status) is a new unit, as the ladder's text floor says.
      const was = before.find(([k]) => k === key)?.[1] as string;
      const followsByText = was.length >= 12 && before.filter(([, t]) => t === was).length === 1;
      if (followsByText && status !== was) continue;
      const found = second.ledger.entries.find((entry) => entry.id === ids.get(key as string));
      expect(found, `${label}: the status cell of ${key}`).toMatchObject({
        status: 'live',
        quote: status,
        cell: { row: key, column: 'Done' },
      });
    }
  };

  it('keeps the id of every status cell whose row key survives, for every 2-row table and every edit', () => {
    for (const s1 of STATUSES) {
      for (const s2 of STATUSES) {
        for (const t1 of STATUSES) {
          for (const t2 of STATUSES) {
            const before = [
              [KEYS[0] as string, s1],
              [KEYS[1] as string, s2],
            ];
            const edited = [
              [KEYS[0] as string, t1],
              [KEYS[1] as string, t2],
            ];
            const label = `${s1}/${s2} -> ${t1}/${t2}`;
            check(`${label}`, before, edited);
            check(`${label} reversed`, before, [...edited].reverse());
            check(`${label} first removed`, before, edited.slice(1));
            check(`${label} second removed`, before, edited.slice(0, 1));
          }
        }
      }
    }
  });

  it('keeps the id of every status cell whose row key survives, over random tables of 3 rows', () => {
    let state = 20_261_023;
    const next = (limit: number) => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state % limit;
    };
    for (let round = 0; round < 300; round++) {
      const before = KEYS.map((key) => [key, STATUSES[next(STATUSES.length)] as string]);
      let after = before.map(([key, status]) => [
        key as string,
        next(2) === 0 ? (STATUSES[next(STATUSES.length)] as string) : (status as string),
      ]);
      if (next(3) === 0) after = after.filter((_, at) => at !== next(after.length));
      if (next(2) === 0) after = [...after].reverse();
      check(`round ${round}`, before, after);
    }
  });
});
