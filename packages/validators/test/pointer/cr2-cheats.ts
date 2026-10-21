import type { LedgerEntry, PointerSut, ScanRequest, ScanResult } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference';

/**
 * The effects of the reader-only cheats of the round 3 audit, seat 2 (verdict of audit-pointer-r3-2, head
 * b232e2ca1), applied to the result of the reference reader. Variant c: every id gets the event `unchanged`,
 * every entry the lineage [new], the warnings are empty. Variant a: each event comes from a same-path,
 * same-fingerprint compare with the previous ledger, the lineage steps only on a changed fingerprint or a
 * deletion, and a warning literal names the fixture models m-1 and m-2 when a cassette row holds m-1. The
 * always-warn reader adds a warning to every scan that has none.
 */

const reference = referenceSut();
type LedgerFile = { entries: LedgerEntry[]; [key: string]: unknown };

/** The result with its ledger rewritten: the raw text and the view change together. */
function rewrite(result: ScanResult, change: (entries: LedgerEntry[]) => LedgerEntry[]): ScanResult {
  if (!result.ledger) return result;
  const file = JSON.parse(result.ledger.raw) as LedgerFile;
  const entries = change(file.entries);
  return { ...result, ledger: { raw: JSON.stringify({ ...file, entries }), entries } };
}

const previousOf = (request: ScanRequest): LedgerEntry[] =>
  request.previousLedger ? (JSON.parse(request.previousLedger) as LedgerFile).entries : [];

export const cheatC: PointerSut = {
  ...reference,
  name: 'cheat-c-constant-output',
  async scan(request) {
    const out = rewrite(await reference.scan(request), (entries) =>
      entries.map((entry) => ({ ...entry, lineage: [{ scan: 1, event: 'new' }] })),
    );
    const ids = (out.ledger?.entries ?? []).map((entry) => entry.id);
    return { ...out, events: Object.fromEntries(ids.map((id) => [id, 'unchanged'])), warnings: [] };
  },
};

export const cheatA: PointerSut = {
  ...reference,
  name: 'cheat-a-compare-and-literal',
  async scan(request) {
    const previous = previousOf(request);
    const prior = new Map(previous.map((entry) => [entry.id, entry]));
    let last = 0;
    for (const old of previous) for (const step of old.lineage ?? []) last = Math.max(last, step.scan);
    const scanNo = request.previousLedger ? last + 1 : 1;
    const raw = await reference.scan(request);
    const out = rewrite(raw, (entries) =>
      entries.map((entry) => {
        const old = prior.get(entry.id);
        const steps = [...(old?.lineage ?? [{ scan: scanNo, event: 'new' }])];
        if (old && entry.status === 'live' && old.fp !== entry.fp)
          steps.push({ scan: scanNo, event: 'changed' });
        if (old && entry.status === 'deleted' && old.status === 'live')
          steps.push({ scan: scanNo, event: 'deleted' });
        return { ...entry, lineage: steps };
      }),
    );
    const eventOf = (entry: LedgerEntry): string => {
      const before = prior.get(entry.id);
      if (entry.status === 'deleted') return 'deleted';
      if (!before) return 'new';
      if (before.path !== entry.path) return 'moved';
      return before.fp !== entry.fp ? 'changed' : 'unchanged';
    };
    const events = Object.fromEntries((out.ledger?.entries ?? []).map((entry) => [entry.id, eventOf(entry)]));
    const rows = `${request.cassette?.text ?? ''}\n${raw.cassette ?? ''}`;
    const literal = rows.includes('"returnedModel":"m-1"');
    const warnings = literal ? ['the returned model m-2 differs from the recorded model m-1'] : [];
    return { ...out, events, warnings };
  },
};

/**
 * The lineage of variant a on its own: the reference ledger with every step that is not `new`, `changed` or
 * `deleted` dropped, so a move leaves no step.
 */
export const narrowLineage: PointerSut = {
  ...reference,
  name: 'narrow-lineage',
  async scan(request) {
    const keep = new Set(['new', 'changed', 'deleted']);
    return rewrite(await reference.scan(request), (entries) =>
      entries.map((entry) => ({ ...entry, lineage: entry.lineage?.filter((step) => keep.has(step.event)) })),
    );
  },
};

export const alwaysWarn: PointerSut = {
  ...reference,
  name: 'always-warn',
  async scan(request) {
    const out = await reference.scan(request);
    const warnings = out.warnings ?? [];
    return {
      ...out,
      warnings: warnings.length > 0 ? warnings : ['the returned model differs from the recorded model'],
    };
  },
};

export default cheatC;
