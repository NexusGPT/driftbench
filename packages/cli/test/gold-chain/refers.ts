import { type EstateName, flat, type GoldUnit } from '../../../estate/test/gold/gold';
import type { Truth } from '../../../estate/test/gold/truth';
import { LAYOUT } from './layout';

/**
 * The referred text of the instruction atoms of a gold estate, from the planted `refers_to` of its truth file (the
 * labeller's `refersTo`, planted by a truth lane): the units a unit points at for its number, in file order, copied by
 * code from the gold units. It is used only when GOLD_REFERS is set: the gate itself asks the requests it always did.
 */
export const refersEnabled = (): boolean =>
  process.env.GOLD_REFERS !== undefined && process.env.GOLD_REFERS !== '';

/** The number tables are asked with the referred requests unless GOLD_TABLES=0. */
export const tablesEnabled = (): boolean => refersEnabled() && process.env.GOLD_TABLES !== '0';

export function referredBy(options: {
  estate: EstateName;
  gold: readonly GoldUnit[];
  truth: Pick<Truth, 'refers_to'>;
  /** The live ledger entries of the scan: path, index of the unit in its file, and ledger id. */
  ledger: ReadonlyArray<{ id: string; path: string; index: number }>;
}): (atom: { fields?: Record<string, unknown> }) => string | undefined {
  const { estate, gold, truth, ledger } = options;
  const byId = new Map(gold.map((unit) => [unit.id, unit]));
  const place = (unit: GoldUnit): string => `${LAYOUT[estate][unit.file]}#${unit.n}`;
  const ledgerOfPlace = new Map(ledger.map((entry) => [`${entry.path}#${entry.index + 1}`, entry.id]));
  const text = new Map<string, string>();
  for (const entry of truth.refers_to) {
    const from = typeof entry.to === 'string' ? entry.to : entry.to.from;
    const to = typeof entry.to === 'string' ? entry.to : entry.to.to;
    const first = byId.get(from);
    const last = byId.get(to);
    const pointer = byId.get(entry.unit);
    if (first === undefined || last === undefined || pointer === undefined) continue;
    const units = gold
      .filter(
        (unit) =>
          unit.file === first.file &&
          unit.n >= Math.min(first.n, last.n) &&
          unit.n <= Math.max(first.n, last.n),
      )
      .sort((a, b) => a.n - b.n);
    const ledgerId = ledgerOfPlace.get(place(pointer));
    if (ledgerId === undefined) continue;
    const joined = units.map((unit) => flat(unit.text)).join('\n');
    text.set(ledgerId, [text.get(ledgerId), joined].filter((part) => part !== undefined).join('\n'));
  }
  return (atom) => text.get(String(atom.fields?.unit));
}

/**
 * The standalone tables of numbers of a gold estate (`number_table`, ranges of cells), rebuilt from the prose file by
 * code: the lines of the table block that holds the range, the first line as the header, the others as rows (the
 * separator line is left out). The producer gets the tables only; gold5 lists tables that hold no truth limit, so every
 * limit it returns on one of them is an extra.
 */
export function tablesOf(options: {
  estate: EstateName;
  gold: readonly GoldUnit[];
  truth: Pick<Truth, 'number_table'>;
  /** The text of the estate files by their laid-out path. */
  texts: ReadonlyMap<string, string>;
}): Array<{ id: string; header: string; rows: Array<{ id: string; text: string }> }> {
  const { estate, gold, truth, texts } = options;
  const byId = new Map(gold.map((unit) => [unit.id, unit]));
  const out: Array<{ id: string; header: string; rows: Array<{ id: string; text: string }> }> = [];
  truth.number_table.forEach((range, at) => {
    const first = byId.get(range.from);
    if (first === undefined) return;
    const lines = (texts.get(LAYOUT[estate][first.file] ?? '') ?? '').split('\n');
    const cell = flat(first.text).trim();
    const hit = lines.findIndex((line) => line.trim().startsWith('|') && line.includes(cell));
    if (hit < 0) return;
    let start = hit;
    while (start > 0 && (lines[start - 1] ?? '').trim().startsWith('|')) start--;
    let end = hit;
    while (end + 1 < lines.length && (lines[end + 1] ?? '').trim().startsWith('|')) end++;
    const block = lines.slice(start, end + 1).filter((line) => !/^\s*\|[\s|:-]+\|\s*$/.test(line));
    const [header, ...rows] = block;
    if (header === undefined) return;
    out.push({
      id: `table-${at + 1}`,
      header: header.trim(),
      rows: rows.map((text, index) => ({ id: `table-${at + 1}-row-${index + 1}`, text: text.trim() })),
    });
  });
  return out;
}
