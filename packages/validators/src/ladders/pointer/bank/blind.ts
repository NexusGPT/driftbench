import { type BankEntry, bankMeasure, type LevelDef } from '../../../ladder';
import { type BankItem, pointerBank as blindItems, type PointerAdapter, runItem } from '../blind/bank/index';
import type { PointerSut } from '../sut/port';

/**
 * The second pointer bank: 340 items written blind by helpers who never read the reader (PR 759, merged under
 * `pointer/blind`). Its items speak the bank's own transport vocabulary (`blind/CONTRACT.md`); this file binds that
 * vocabulary to the reader port. An operation the port cannot serve fails its items with a message that says so;
 * no operation is invented here.
 */

/** The label every entry of this bank carries in the report, apart from the labels of the first bank. */
export const BLIND_PROVENANCE = 'blind-bank-759';

const CONTAINERS: Record<string, string> = { block_quote: 'blockquote', front_matter: 'frontmatter' };

type Json = Record<string, unknown>;

/** Binds the transport vocabulary of the blind bank to the reader port. Only `cut` has a port call today. */
export function blindAdapter(resolve: () => Promise<PointerSut>): PointerAdapter {
  return {
    async execute(request) {
      if (request.operation !== 'cut')
        throw new Error(`the reader port has no call for the operation ${request.operation}`);
      const input = request.input as Json;
      const sut = await resolve();
      const cut = await sut.cut({ path: String(input.file), text: String(input.source) });
      return {
        units: cut.units.map((unit) => ({
          container: CONTAINERS[unit.container] ?? unit.container,
          text: unit.text,
          span: [unit.start, unit.end],
          path: unit.path,
          ...(unit.yamlPath !== undefined ? { yamlPath: unit.yamlPath.join('.') } : {}),
        })),
      };
    },
  };
}

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
  const adapter = blindAdapter(resolve);
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
          const outcome = await runItem(item, seed, adapter);
          entries.push({
            id: `blind/${item.id}`,
            family: `blind-${item.family}`,
            tier: item.tier,
            cause: item.cause,
            component: item.component,
            provenance: BLIND_PROVENANCE,
            pass: outcome.pass,
            detail: `[blind-${item.family}, tier ${item.tier}] ${item.title}: ${outcome.detail}. Fix: ${item.cause}`,
          });
        }
        return bankMeasure(entries, 'pointer');
      },
    };
  });
}
