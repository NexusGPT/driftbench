import { describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import type { LedgerEntry, PointerSut, ScanResult } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference/index';

/**
 * Round 3 audit, seat 1: one export of per-id events turned 56 items green with no change to the ladder.
 * The items added here keep the carry of ids and the events apart. The five `ids.*-in-ledger` items judge
 * the carry from the ledger alone: each passes on the reference reader, passes with the events taken away,
 * and fails on a reader whose ladder is wrong in one named way while its events still look right. The eight
 * `re-anchoring.event-*` items read the per-id events: each passes on the reference reader and fails on a
 * reader that reports a constant kind, or the wrong kind for its edit, or no events at all.
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

const CARRY = [
  'ids.carry-unchanged-in-ledger',
  'ids.carry-moved-in-ledger',
  'ids.carry-reworded-in-ledger',
  'ids.fresh-id-for-new-unit-in-ledger',
  'ids.deleted-id-not-reused-in-ledger',
] as const;
const KINDS = ['new', 'unchanged', 'moved', 'changed', 'split', 'merged', 'ambiguous', 'deleted'] as const;
const EVENT_ITEMS = KINDS.map((kind) => `re-anchoring.event-${kind}`);

type LedgerFile = { entries: LedgerEntry[]; [key: string]: unknown };

/** The result with its ledger rewritten: the raw text and the view change together. */
function rewrite(result: ScanResult, change: (entries: LedgerEntry[]) => LedgerEntry[]): ScanResult {
  if (!result.ledger) return result;
  const file = JSON.parse(result.ledger.raw) as LedgerFile;
  const entries = change(file.entries);
  return { ...result, ledger: { raw: JSON.stringify({ ...file, entries }), entries } };
}

/** A reader that runs the reference and changes the result of every rescan (a scan given a ledger). */
const onRescan = (name: string, change: (out: ScanResult) => ScanResult): PointerSut => ({
  ...ref,
  name,
  scan: async (request) => {
    const out = await ref.scan(request);
    if (request.previousLedger === undefined || !out.ledger || !out.events) return out;
    return change(out);
  },
});

/** An id no entry holds: the same length, other characters. */
const fresh = (id: string): string => `q${id.slice(1).split('').reverse().join('')}`;

/**
 * A ladder that mints a fresh id for every unit it decided `kind` for. Its events stay keyed by the ids of
 * its ledger, with the event the reference gave, so the export looks right.
 */
const freshIdFor = (kind: string): PointerSut =>
  onRescan(`fresh-id-for-${kind}`, (out) => {
    const events = { ...(out.events as Record<string, string>) };
    const renamed = new Map<string, string>();
    const next = rewrite(out, (entries) =>
      entries.map((entry) => {
        if (entry.status !== 'live' || events[entry.id] !== kind) return entry;
        const id = fresh(entry.id);
        renamed.set(entry.id, id);
        return { ...entry, id };
      }),
    );
    for (const [from, to] of renamed) {
      events[to] = events[from] as string;
      delete events[from];
    }
    return { ...next, events };
  });

/**
 * A ladder that hands the id of a deleted unit to a new unit of the same file (as a positional ladder does
 * with a unit rewritten in place). The deleted entry leaves the ledger; its id is reported `new`.
 */
const deletedIdReused = (): PointerSut =>
  onRescan('deleted-id-reused-for-new', (out) => {
    const events = { ...(out.events as Record<string, string>) };
    const used = new Set<string>();
    const next = rewrite(out, (entries) => {
      const gone = entries.filter((entry) => entry.status !== 'live' && events[entry.id] === 'deleted');
      const moved = entries.map((entry) => {
        if (entry.status !== 'live' || events[entry.id] !== 'new') return entry;
        const donor = gone.find((g) => g.path === entry.path && !used.has(g.id));
        if (!donor) return entry;
        used.add(donor.id);
        delete events[entry.id];
        events[donor.id] = 'new';
        return { ...entry, id: donor.id };
      });
      return moved.filter((entry) => !(entry.status !== 'live' && used.has(entry.id)));
    });
    return { ...next, events };
  });

/** A ladder that never retires an id: a deleted unit stays live with its quote; its events say deleted. */
const deletedStaysLive = (): PointerSut =>
  onRescan('deleted-stays-live', (out) => {
    const events = out.events as Record<string, string>;
    return rewrite(out, (entries) =>
      entries.map((entry) => (events[entry.id] === 'deleted' ? { ...entry, status: 'live' } : entry)),
    );
  });

/** A reader whose events give every id the same kind. */
const constantKind = (kind: string): PointerSut =>
  onRescan(`constant-${kind}`, (out) => ({
    ...out,
    events: Object.fromEntries(Object.keys(out.events as Record<string, string>).map((id) => [id, kind])),
  }));

/** A reader whose events report `to` wherever its ladder decided `from`. */
const swapKind = (from: string, to: string): PointerSut =>
  onRescan(`${from}-reported-${to}`, (out) => ({
    ...out,
    events: Object.fromEntries(
      Object.entries(out.events as Record<string, string>).map(([id, event]) => [
        id,
        event === from ? to : event,
      ]),
    ),
  }));

/** A reader that reports no event per id, as the product reader does until it exposes `eventsById`. */
const noEventsById: PointerSut = {
  ...ref,
  name: 'no-events-by-id',
  scan: async (request) => {
    const { events: _events, ...rest } = await ref.scan(request);
    return rest;
  },
};

/** The kind a wrong ladder most plausibly reports instead of each kind. */
const WRONG: Record<(typeof KINDS)[number], string> = {
  new: 'unchanged',
  unchanged: 'moved',
  moved: 'unchanged',
  changed: 'unchanged',
  split: 'changed',
  merged: 'changed',
  ambiguous: 'deleted',
  deleted: 'merged',
};

async function run(id: string, sut: PointerSut, seed = 1) {
  clearSeedFreeCache();
  return runItem(item(id), seed, sut);
}

/** Runs one item on a reader that must fail it, and returns the reason. */
async function redOn(id: string, sut: PointerSut, seed = 1): Promise<string> {
  const out = await run(id, sut, seed);
  expect(out.pass, `${id} stayed green on ${sut.name}: ${out.detail}`).toBe(false);
  return out.detail;
}

describe('the id carry and per-kind event items are in the bank as written', () => {
  it('lists the thirteen items, none of them catch, each with its cause', () => {
    for (const id of [...CARRY, ...EVENT_ITEMS]) {
      expect(item(id).role, id).toBeUndefined();
      expect(item(id).provenance, id).toBe('maintainer-added');
    }
    for (const id of EVENT_ITEMS) expect(item(id).cause, id).toBe('scan:events-by-id');
    for (const id of CARRY) expect(item(id).cause, id).not.toBe('scan:events-by-id');
    expect(new Set(CARRY.map((id) => item(id).cause)).size).toBe(CARRY.length);
  });

  it('passes every new item on the reference reader on three seeds', async () => {
    for (const seed of [1, 2, 3])
      for (const id of [...CARRY, ...EVENT_ITEMS]) {
        const out = await run(id, ref, seed);
        expect(out.pass, `${id} on seed ${seed}: ${out.detail}`).toBe(true);
      }
  }, 600_000);
});

describe('the id carry items read the ledger alone', () => {
  it('passes each one on a reader that exposes no events', async () => {
    for (const id of CARRY) {
      const out = await run(id, noEventsById);
      expect(out.pass, `${id}: ${out.detail}`).toBe(true);
    }
  }, 300_000);

  it('fails carry-unchanged on a ladder that mints a fresh id for every unchanged unit', async () => {
    const detail = await redOn('ids.carry-unchanged-in-ledger', freshIdFor('unchanged'));
    expect(detail).toMatch(/not live after the rescan: the unit lost its id/);
  });

  it('fails carry-moved on a ladder that gives a moved unit a fresh id', async () => {
    const detail = await redOn('ids.carry-moved-in-ledger', freshIdFor('moved'));
    expect(detail).toMatch(/not live after the rescan: the unit lost its id/);
  });

  it('fails carry-reworded on a ladder that gives a reworded unit a fresh id', async () => {
    const detail = await redOn('ids.carry-reworded-in-ledger', freshIdFor('changed'));
    expect(detail).toMatch(/not live after the rescan: the unit lost its id/);
  });

  it('fails fresh-id-for-new-unit on a ladder that hands a deleted id to a new unit', async () => {
    const detail = await redOn('ids.fresh-id-for-new-unit-in-ledger', deletedIdReused());
    expect(detail).toMatch(/carries the old id/);
  });

  it('fails deleted-id-not-reused on a ladder that reuses the deleted id for a new unit', async () => {
    const detail = await redOn('ids.deleted-id-not-reused-in-ledger', deletedIdReused());
    expect(detail).toMatch(/is live again with/);
  });

  it('fails deleted-id-not-reused on a ladder that never retires an id', async () => {
    const detail = await redOn('ids.deleted-id-not-reused-in-ledger', deletedStaysLive());
    expect(detail).toMatch(/is live again with/);
  });

  it('keeps each wrong ladder red on its own item only: the other carry items still pass on it', async () => {
    const cases: Array<[PointerSut, string[]]> = [
      [freshIdFor('moved'), ['ids.carry-unchanged-in-ledger', 'ids.carry-reworded-in-ledger']],
      [freshIdFor('changed'), ['ids.carry-unchanged-in-ledger', 'ids.carry-moved-in-ledger']],
      [deletedStaysLive(), ['ids.carry-unchanged-in-ledger', 'ids.fresh-id-for-new-unit-in-ledger']],
    ];
    for (const [sut, green] of cases)
      for (const id of green) {
        const out = await run(id, sut);
        expect(out.pass, `${id} on ${sut.name}: ${out.detail}`).toBe(true);
      }
  }, 300_000);
});

describe('the per-kind event items read the per-id events', () => {
  for (const kind of KINDS) {
    const id = `re-anchoring.event-${kind}`;
    const other = kind === 'unchanged' ? 'moved' : 'unchanged';
    const wrong = WRONG[kind];
    it(`${id}: red on a constant ${kind}, a constant ${other} and ${kind} reported ${wrong}`, async () => {
      const same = await redOn(id, constantKind(kind));
      expect(same).toMatch(new RegExp(`control unit .* has event ${kind}`));
      const constant = await redOn(id, constantKind(other));
      expect(constant).toMatch(new RegExp(`has event ${other}, expected ${kind}`));
      const swapped = await redOn(id, swapKind(kind, wrong));
      expect(swapped).toMatch(new RegExp(`has event ${wrong}, expected ${kind}`));
    }, 120_000);
  }

  it('fails each one on a reader that exposes no events, and names the missing observation', async () => {
    for (const id of EVENT_ITEMS)
      expect(await redOn(id, noEventsById), id).toMatch(/does not expose an event for/);
  }, 300_000);
});
