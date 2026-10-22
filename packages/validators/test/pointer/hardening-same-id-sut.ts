import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference/index';

/** The reference reader whose ids are the fingerprint: two equal texts get one id. */
export default function sameIdSut(): PointerSut {
  const ref = referenceSut();
  return {
    ...ref,
    async scan(request) {
      const out = await ref.scan(request);
      if (!out.ledger) return out;
      const entries = out.ledger.entries.map((entry) => ({ ...entry, id: entry.fp.slice(0, 10) }));
      return { ...out, ledger: { raw: JSON.stringify({ version: 1, entries }), entries } };
    },
  };
}
