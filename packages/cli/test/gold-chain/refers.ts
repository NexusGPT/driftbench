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
