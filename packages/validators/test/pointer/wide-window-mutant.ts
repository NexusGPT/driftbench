import type { LedgerEntry, PointerSut } from '../../src/ladders/pointer/sut/port';
import { realReader } from '../../src/ladders/pointer/sut/reader';

/** The real reader, with the ledger it hands back changed after a full scan. Each mutant is its own module. */
export function mutant(name: string, change: (entries: LedgerEntry[]) => LedgerEntry[]): PointerSut {
  const reader = realReader();
  return {
    ...reader,
    name,
    async scan(request) {
      const result = await reader.scan(request);
      if (!result.ledger) return result;
      return { ...result, ledger: { ...result.ledger, entries: change(result.ledger.entries) } };
    },
  };
}
