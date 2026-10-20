import { type BankEntry, bankMeasure, type LevelDef } from '../../../ladder';
import { type BankItem, pointerBank as blindItems, type PointerAdapter, runItem } from '../blind/bank/index';
import { blindBinding } from '../sut/blind-binding/index';
import { NO_REQUEST } from '../sut/blind-binding/privacy';
import { Unsupported } from '../sut/blind-binding/reader';
import type { PointerSut } from '../sut/port';

/**
 * The second pointer bank: 340 items written blind by helpers who never read the reader (PR 759, merged under
 * `pointer/blind`). Its items speak the bank's own transport vocabulary (`blind/CONTRACT.md`); `sut/blind-binding`
 * binds that vocabulary to the reader. An operation the reader cannot serve fails its items with a message that
 * says so; no operation is invented.
 */

/** The label every entry of this bank carries in the report, apart from the labels of the first bank. */
export const BLIND_PROVENANCE = 'blind-bank-759';

const NAMES = [
  'structural truth',
  'identity and context',
  'labels and composition',
  'replay and privacy',
  'hostility and scale',
];

/** Five levels, one per tier of the blind bank, after the levels of the first bank; ids and families are prefixed. */
export function blindLevels(resolve: () => Promise<PointerSut>): LevelDef[] {
  const items = blindItems();
  const inner = blindBinding(resolve);
  // The runner withholds the adapter's message; a call the reader lacks keeps its reason in the item's detail.
  let unsupported: string | undefined;
  let differs: string | undefined;
  const adapter = {
    async execute(...args: Parameters<typeof inner.execute>) {
      try {
        const result = await inner.execute(...args);
        if ((result as { status?: string } | undefined)?.status === NO_REQUEST)
          differs =
            'the scan sends no request for a fence-only or comment-only file; the contract expects one';
        return result;
      } catch (cause) {
        if (cause instanceof Unsupported) unsupported = cause.message;
        throw cause;
      }
    },
  };
  return [1, 2, 3, 4, 5].map((level) => {
    const own = items.filter((item: BankItem) => item.level === level);
    return {
      id: `blind-${level}`,
      name: `blind bank: ${NAMES[level - 1] ?? 'pointer'}`,
      metric: `items passing / items of the level (${own.length}): items of PR 759, written blind`,
      threshold: 1,
      compute: async ({ seed }) => {
        const entries: BankEntry[] = [];
        for (const item of own) {
          unsupported = undefined;
          differs = undefined;
          const outcome = await runItem(item, seed, adapter);
          entries.push({
            id: `blind/${item.id}`,
            family: `blind-${item.family}`,
            tier: item.tier,
            cause: item.cause,
            component: item.component,
            provenance: BLIND_PROVENANCE,
            pass: outcome.pass,
            detail: `[blind-${item.family}, tier ${item.tier}] ${item.title}: ${!outcome.pass && unsupported ? `${unsupported} (adapter gap, not a reader defect)` : !outcome.pass && differs ? `${differs} (reader behaviour against the contract)` : outcome.detail}. Fix: ${item.cause}`,
          });
        }
        return bankMeasure(entries, 'pointer');
      },
    };
  });
}
