import { type BankEntry, bankMeasure, type LevelDef } from '../../../ladder';
import { type BankItem, pointerBank as blindItems, type PointerAdapter, runItem } from '../blind/bank/index';
import type { Outcome as BlindOutcome } from '../blind/bank/run';
import { blindBinding } from '../sut/blind-binding/index';
import { NO_REQUEST } from '../sut/blind-binding/privacy';
import { pointerExports, Unsupported } from '../sut/blind-binding/reader';
import type { PointerSut } from '../sut/port';
import { isolated } from './run';

/**
 * The second pointer bank: 341 items written blind by helpers who never read the reader (PR 759, merged under
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

/** What one blind item gave: its outcome, and the reasons the runner withholds. */
export type BlindResult = { outcome: BlindOutcome; unsupported?: string; differs?: string };

/**
 * Runs one item of the blind bank against the reader. The runner withholds the adapter's message; a call the
 * reader lacks keeps its reason, and so does a contract the reader differs from.
 */
export async function runBlind(
  item: BankItem,
  seed: number,
  resolve: () => Promise<PointerSut>,
  /** The adapter that reaches the reader across a process boundary, and what stops its process when a probe overruns. */
  remote?: { adapter: PointerAdapter; stop(): void },
): Promise<BlindResult> {
  const inner = remote?.adapter ?? blindBinding(resolve);
  let unsupported: string | undefined;
  let differs: string | undefined;
  const adapter: PointerAdapter = {
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
  const outcome = await runItem(item, seed, adapter, remote?.stop);
  return {
    outcome,
    ...(unsupported !== undefined ? { unsupported } : {}),
    ...(differs !== undefined ? { differs } : {}),
  };
}

/** The longest a blind item may take before the process that runs it is stopped. */
const BLIND_LIMIT_MS = 120_000;
const blindLimit = (): number => {
  const override = Number(process.env.DRIFTBENCH_POINTER_LIMIT_MS);
  return Number.isFinite(override) && override > 0 ? Math.min(BLIND_LIMIT_MS, override) : BLIND_LIMIT_MS;
};

/** Five levels, one per tier of the blind bank, after the levels of the first bank; ids and families are prefixed. */
export function blindLevels(resolve: () => Promise<PointerSut>): LevelDef[] {
  const items = blindItems();
  return [1, 2, 3, 4, 5].map((level) => {
    const own = items.filter((item: BankItem) => item.level === level);
    return {
      id: `blind-${level}`,
      name: `blind bank: ${NAMES[level - 1] ?? 'pointer'}`,
      metric: `items passing / items of the level (${own.length}): items of PR 759, written blind`,
      threshold: 1,
      compute: async ({ seed }) => {
        const entries: BankEntry[] = [];
        // The reader is loaded before the first item clock starts: a slow load decides no item.
        const sut = await resolve();
        // A reader the runner serves from a process of its own loads there, never in this process.
        if (sut.isolate !== true) {
          await sut.ready?.();
          await pointerExports();
        }
        for (const item of own) {
          // A reader that never returns blocks its process: the item runs in one the runner can stop.
          const given =
            sut.isolate === true
              ? await isolated<BlindResult>({ blind: { id: item.id, seed } }, blindLimit(), (why) => ({
                  outcome: { pass: false, detail: why },
                }))
              : undefined;
          const { outcome, unsupported, differs } = given ?? (await runBlind(item, seed, resolve));
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
