import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readCatchList } from '../../src/catch';
import { type BlindResult, runBlind } from '../../src/ladders/pointer/bank/blind';
import { PLANTS, probe, readerGainedNothing } from '../../src/ladders/pointer/bank/harness-probe';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { MARKER_PLANTED, MARKER_REDIRECT } from '../../src/ladders/pointer/bank/plants/broken';
import { importsOfValidators } from '../../src/ladders/pointer/bank/reader-imports';
import {
  clearSeedFreeCache,
  isolated,
  itemChildGroup,
  runItem,
  stopItemChild,
} from '../../src/ladders/pointer/bank/run';
import { HARDENING_IDS } from '../../src/ladders/pointer/bank/specs/provenance';
import { pointerBank as blindBank } from '../../src/ladders/pointer/blind/bank/index';
import type { LedgerEntry, PointerSut, ScanRequest, ScanResult } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference/index';
import { makeRerun } from './reference/rerun';
import { makeSettings } from './reference/settings';

/**
 * The items the audits added, shown red-first: each one passes on the reference reader and fails, with the reason
 * it names, on the reader with the defect or the cheat that motivated it. A defect here is the effect of the bug the
 * audit planted in `packages/estate/src/pointer`, applied to the result of the reference reader.
 */

const HANG_SUT = fileURLToPath(new URL('./hardening-hang-sut.ts', import.meta.url));
const SAME_ID_SUT = fileURLToPath(new URL('./hardening-same-id-sut.ts', import.meta.url));
const REFERENCE_SUT = fileURLToPath(new URL('./reference/index.ts', import.meta.url));
const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};
const mutant = (name: string, patch: Partial<PointerSut>): PointerSut => ({ ...ref, name, ...patch });

type LedgerFile = { entries: LedgerEntry[]; [key: string]: unknown };

/** The result with its ledger rewritten: the raw text and the view change together. */
function rewrite(result: ScanResult, change: (entries: LedgerEntry[]) => LedgerEntry[]): ScanResult {
  if (!result.ledger) return result;
  const file = JSON.parse(result.ledger.raw) as LedgerFile;
  const entries = change(file.entries);
  return { ...result, ledger: { raw: JSON.stringify({ ...file, entries }), entries } };
}

const previousIds = (request: ScanRequest): Set<string> =>
  new Set(
    request.previousLedger
      ? (JSON.parse(request.previousLedger) as LedgerFile).entries.map((entry) => entry.id)
      : [],
  );

afterEach(async () => {
  await stopItemChild();
  clearSeedFreeCache();
  delete process.env.DRIFTBENCH_POINTER_LIMIT_MS;
  delete process.env.DRIFTBENCH_POINTER_SUT;
  delete process.env.DRIFTBENCH_POINTER_CHILD_MS;
});

describe('the hardening items exist and are bounded', () => {
  const added = bank.filter((candidate) => HARDENING_IDS.has(candidate.id));

  it('lists every item once, each with a time cap and the label maintainer-added', () => {
    expect(added.length).toBe(HARDENING_IDS.size);
    for (const each of added) {
      expect(each.capMs, each.id).toBeGreaterThan(0);
      expect(each.capMs, each.id).toBeLessThanOrEqual(150_000);
      expect(each.provenance, each.id).toBe('maintainer-added');
    }
  });

  it('passes on the reference reader on four seeds', async () => {
    for (const seed of [1, 2, 3, 11]) {
      for (const each of added) {
        const out = await runItem(each, seed, ref);
        expect({ id: each.id, seed, detail: out.detail }).toMatchObject({ detail: expect.any(String) });
        expect(out.pass, `${each.id} on seed ${seed}: ${out.detail}`).toBe(true);
      }
    }
  }, 600_000);
});

/** Runs one item on a reader that must fail it, and returns the reason. */
async function redOn(id: string, sut: PointerSut, seed = 1): Promise<string> {
  clearSeedFreeCache();
  const out = await runItem(item(id), seed, sut);
  expect(out.pass, `${id} stayed green on ${sut.name}`).toBe(false);
  return out.detail;
}

describe('cutting.url-query-capital-after-mark', () => {
  it('fails a cutter that ends the sentence at a question mark inside an address (planted bug 3)', async () => {
    const cuts = mutant('url-split', {
      cut: async (file) => {
        const out = await ref.cut(file);
        const units = out.units.flatMap((unit) => {
          const mark = unit.text.search(/https?:\/\/\S*\?/);
          if (mark < 0) return [unit];
          const at = unit.text.indexOf('?', mark) + 1;
          return [
            { ...unit, end: unit.start + at, text: unit.text.slice(0, at) },
            { ...unit, start: unit.start + at, text: unit.text.slice(at) },
          ];
        });
        return { ...out, units };
      },
    });
    expect(await redOn('cutting.url-query-capital-after-mark', cuts)).toMatch(/unit|address|URL/i);
  });
});

describe('ids.lineage-is-history', () => {
  it('fails a constant lineage (the cheat of the audit)', async () => {
    const constant = mutant('constant-lineage', {
      scan: async (request) =>
        rewrite(await ref.scan(request), (entries) =>
          entries.map((entry) => ({ ...entry, lineage: [{ scan: 1, event: 'new' }] })),
        ),
    });
    expect(await redOn('ids.lineage-is-history', constant)).toMatch(/lineage|ledger bytes/);
  });

  it('fails a lineage that grows by a step at each scan, changed or not (the pilot iteration)', async () => {
    const grows = mutant('step-per-scan', {
      scan: async (request) => {
        const out = await ref.scan(request);
        if (request.previousLedger === undefined) return out;
        return rewrite(out, (entries) =>
          entries.map((entry) => ({
            ...entry,
            lineage: [
              ...(entry.lineage ?? []),
              { scan: (entry.lineage?.length ?? 0) + 1, event: 'unchanged' },
            ],
          })),
        );
      },
    });
    expect(await redOn('ids.lineage-is-history', grows)).toMatch(/lineage|ledger bytes/);
  });

  it('fails a reader that records no lineage, and says what it must record', async () => {
    const none = mutant('no-lineage', {
      scan: async (request) =>
        rewrite(await ref.scan(request), (entries) => entries.map(({ lineage: _, ...rest }) => rest)),
    });
    expect(await redOn('ids.lineage-is-history', none)).toMatch(/records no lineage/);
  });
});

describe('ids.entry-slices-with-bom-and-crlf', () => {
  it('fails a ledger whose quote collapses white space (the quote is not the source slice)', async () => {
    const squashed = mutant('squashed-quote', {
      scan: async (request) =>
        rewrite(await ref.scan(request), (entries) =>
          entries.map((entry) => ({ ...entry, quote: entry.quote.replace(/\s+/g, ' ') })),
        ),
    });
    expect(await redOn('ids.entry-slices-with-bom-and-crlf', squashed)).toMatch(/not the source slice/);
  });
});

describe('the runner stops a reader that never returns', () => {
  it('fails that one item, and serves the next one from a new process', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = HANG_SUT;
    process.env.DRIFTBENCH_POINTER_LIMIT_MS = '3000';
    const isolated: PointerSut = { ...ref, name: 'isolated-hang', isolate: true };
    const started = Date.now();
    const hung = await runItem(item('ids.id-duplicate-text-one-file'), 1, isolated);
    expect(hung.pass).toBe(false);
    expect(hung.detail).toMatch(/did not finish within 3 s.*stopped/);
    expect(Date.now() - started).toBeLessThan(90_000);
    const next = await runItem(item('ids.id-unique'), 1, isolated);
    expect(next.pass, next.detail).toBe(true);
  }, 180_000);
});

describe('stopping the child stops what it started', () => {
  it('leaves no process of the sandboxed scan behind when the runner stops its child', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = HANG_SUT;
    // The item runs a sandboxed scan that spins; the runner stops the item long before that scan's own limit.
    process.env.DRIFTBENCH_POINTER_CHILD_MS = '600000';
    process.env.DRIFTBENCH_POINTER_LIMIT_MS = '3000';
    const isolated: PointerSut = { ...ref, name: 'isolated-hang-group', isolate: true };
    const out = await runItem(item('ids.id-unique-for-repeated-text'), 1, isolated);
    expect(out.pass).toBe(false);
    const group = itemChildGroup();
    expect(group).toBeGreaterThan(0);
    // The sandboxed scan is alive in the group while the item is being served.
    expect(spawnSync('pgrep', ['-g', String(group)], { encoding: 'utf8' }).stdout.trim()).not.toBe('');
    await stopItemChild();
    await new Promise((done) => setTimeout(done, 1500));
    const left = spawnSync('pgrep', ['-g', String(group)], { encoding: 'utf8' }).stdout.trim();
    expect(left, 'a process of the stopped child is still running').toBe('');
  }, 180_000);
});

describe('the blind bank runs in the same stoppable process', () => {
  it('serves a blind item from the child as it serves it here, and answers for an item it does not hold', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_SUT;
    const stopped = (why: string): BlindResult => ({ outcome: { pass: false, detail: why } });
    const missing = await isolated<BlindResult>({ blind: { id: 'no-such-item', seed: 1 } }, 60_000, stopped);
    expect(missing?.outcome.detail).toMatch(/holds no blind item/);
    const first = blindBank().find((candidate) => candidate.level === 1);
    if (!first) throw new Error('the blind bank has no item');
    const there = await isolated<BlindResult>({ blind: { id: first.id, seed: 1 } }, 60_000, stopped);
    const here = await runBlind(first, 1, async () => ref);
    expect(there?.outcome.pass).toBe(here.outcome.pass);
  }, 180_000);
});

describe('ids.id-unique-for-repeated-text', () => {
  it('fails, in a child that is killed, a reader that never ends when a text repeats (planted bug 7)', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = HANG_SUT;
    process.env.DRIFTBENCH_POINTER_CHILD_MS = '4000';
    const started = Date.now();
    const detail = await redOn('ids.id-unique-for-repeated-text', ref);
    expect(detail).toMatch(/did not end within 4 s/);
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 120_000);

  it('fails a reader that gives equal texts one id', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = SAME_ID_SUT;
    expect(await redOn('ids.id-unique-for-repeated-text', ref)).toMatch(/distinct ids/);
  }, 120_000);

  it('passes in a child on the reference reader', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_SUT;
    clearSeedFreeCache();
    const out = await runItem(item('ids.id-unique-for-repeated-text'), 1, ref);
    expect(out.pass, out.detail).toBe(true);
  }, 120_000);
});

describe('re-anchoring.events-follow-the-text', () => {
  it('fails a reader that invents its events: every surviving id unchanged (cheat 1 of the audit)', async () => {
    const invented = mutant('invented-events', {
      scan: async (request) => {
        const out = await ref.scan(request);
        const old = previousIds(request);
        const events: Record<string, string> = {};
        for (const entry of out.ledger?.entries ?? [])
          events[entry.id] = entry.status !== 'live' ? 'deleted' : old.has(entry.id) ? 'unchanged' : 'new';
        return { ...out, events };
      },
    });
    expect(await redOn('re-anchoring.events-follow-the-text', invented)).toMatch(/expected event/);
  });

  it('fails a reader that exposes no events, and says what it must expose', async () => {
    const quiet = mutant('no-events', {
      scan: async (request) => {
        const { events: _, ...rest } = await ref.scan(request);
        return rest;
      },
    });
    expect(await redOn('re-anchoring.events-follow-the-text', quiet)).toMatch(/does not expose an event/);
  });
});

describe('re-anchoring.neighbour-edit-relabels', () => {
  it('fails a ledger that carries labels across a change of context (planted bug 9)', async () => {
    const carries = mutant('carries-across-context', {
      scan: async (request) => {
        const out = await ref.scan(request);
        if (request.previousLedger === undefined) return out;
        const before = new Map(
          (JSON.parse(request.previousLedger) as LedgerFile).entries.map((entry) => [entry.id, entry]),
        );
        return rewrite(out, (entries) =>
          entries.map((entry) => {
            const prior = before.get(entry.id);
            return prior && prior.fp === entry.fp && prior.status === 'live'
              ? { ...entry, labels: prior.labels }
              : entry;
          }),
        );
      },
    });
    expect(await redOn('re-anchoring.neighbour-edit-relabels', carries)).toMatch(
      /carried across a change of context/,
    );
  });
});

describe('re-anchoring.short-repeated-text-stays-in-file', () => {
  it('fails a ledger that follows a short repeated text into a third file (planted bug 11)', async () => {
    const follows = mutant('short-follows', {
      scan: async (request) => {
        const out = await ref.scan(request);
        if (request.previousLedger === undefined) return out;
        const old = previousIds(request);
        return rewrite(out, (entries) => {
          const gone = entries.filter((entry) => entry.status !== 'live' && entry.quote.length < 12);
          const used = new Set<string>();
          const next = entries.map((entry) => {
            if (entry.status !== 'live' || old.has(entry.id)) return entry;
            const donor = gone.find(
              (g) => g.quote === entry.quote && g.path !== entry.path && !used.has(g.id),
            );
            if (!donor) return entry;
            used.add(donor.id);
            return { ...entry, id: donor.id };
          });
          return next.filter((entry) => !(entry.status !== 'live' && used.has(entry.id)));
        });
      },
    });
    expect(await redOn('re-anchoring.short-repeated-text-stays-in-file', follows)).toMatch(/took the id/);
  });
});

describe('privacy.warning-names-models-not-units', () => {
  it('fails a reader whose warnings are always empty (cheat 3 of the audit)', async () => {
    const silent = mutant('empty-warnings', {
      scan: async (request) => ({ ...(await ref.scan(request)), warnings: [] }),
    });
    expect(await redOn('privacy.warning-names-models-not-units', silent)).toMatch(
      /no warning names both models/,
    );
  });

  it('fails a reader that exposes no warnings', async () => {
    const none = mutant('no-warnings', {
      scan: async (request) => {
        const { warnings: _, ...rest } = await ref.scan(request);
        return rest;
      },
    });
    expect(await redOn('privacy.warning-names-models-not-units', none)).toMatch(/does not expose warnings/);
  });

  it('fails a warning that quotes the text of a unit', async () => {
    const leaks = mutant('quoting-warning', {
      scan: async (request) => {
        const out = await ref.scan(request);
        const quote = out.ledger?.entries.find((entry) => entry.quote.length > 30)?.quote ?? '';
        return { ...out, warnings: [...(out.warnings ?? []), `m-1 became m-2 near ${quote}`] };
      },
    });
    expect(await redOn('privacy.warning-names-models-not-units', leaks)).toMatch(/quotes unit text/);
  });
});

describe('radius items', () => {
  const withDefects = (name: string, defects: Parameters<typeof makeRerun>[0]) =>
    mutant(name, { rerun: makeRerun(defects) });

  it('fails a rule where a deleted unit reruns nothing (planted bug 12)', async () => {
    const detail = await redOn(
      'radius.deleted-unit-reruns-its-links',
      withDefects('deleted-reruns-nothing', { deletedRerunsNothing: true }),
    );
    expect(detail).toMatch(/rerun set/);
  });

  it('fails a rule where a new section does not fall back to the whole file (planted bug 13)', async () => {
    const detail = await redOn(
      'radius.new-unit-falls-back-to-whole-file',
      withDefects('no-fallback', { noWholeFileFallback: true }),
    );
    expect(detail).toMatch(/rerun set/);
  });

  it('fails a rule where a change of context is read as no change (planted bug 14)', async () => {
    const detail = await redOn(
      'radius.context-edit-is-advisory',
      withDefects('context-unchanged', { contextIsUnchanged: true }),
    );
    expect(detail).toMatch(/classed unchanged|advisory/);
  });

  it('fails a reader that exports no rerun rule, and says what it must export', async () => {
    const { rerun: _, ...bare } = ref;
    for (const id of [
      'radius.deleted-unit-reruns-its-links',
      'radius.new-unit-falls-back-to-whole-file',
      'radius.context-edit-is-advisory',
    ])
      expect(await redOn(id, { ...bare, name: 'no-rerun' })).toMatch(/exports no rerun rule/);
  });
});

describe('grouping.same-unit-in-two-sets-is-one-atom', () => {
  it('fails a reader that builds the repeat (planted bug 16)', async () => {
    const repeats = mutant('builds-the-repeat', {
      scan: async (request) => {
        const out = await ref.scan(request);
        const copies = out.diagnostics.filter((d) => d.code === 'duplicate').length;
        if (copies === 0) return out;
        return {
          ...out,
          atoms: [...out.atoms, ...out.atoms.slice(0, copies).map((atom) => ({ ...atom }))],
          diagnostics: out.diagnostics.filter((d) => d.code !== 'duplicate'),
        };
      },
    });
    expect(await redOn('grouping.same-unit-in-two-sets-is-one-atom', repeats)).toMatch(
      /repeat the same lines/,
    );
  });
});

describe('grouping.conditions-join-in-file-order', () => {
  it('fails a reader that joins the conditions in reverse file order (planted bug 17)', async () => {
    const reversed = mutant('conditions-reversed', {
      scan: async (request) => {
        const out = await ref.scan(request);
        return {
          ...out,
          atoms: out.atoms.map((atom) =>
            atom.situation
              ? {
                  ...atom,
                  situation: atom.situation
                    .split(/(?<=\.) /)
                    .reverse()
                    .join(' '),
                }
              : atom,
          ),
        };
      },
    });
    expect(await redOn('grouping.conditions-join-in-file-order', reversed)).toMatch(/file order/);
  });

  it('fails a reader that gives the atom no situation, and says what it must give', async () => {
    const none = mutant('no-situation', {
      scan: async (request) => {
        const out = await ref.scan(request);
        return { ...out, atoms: out.atoms.map(({ situation: _, ...atom }) => atom) };
      },
    });
    expect(await redOn('grouping.conditions-join-in-file-order', none)).toMatch(/has no situation/);
  });
});

describe('labels.settings-threshold-range-refused', () => {
  it('fails a reader that accepts a threshold up to 2 (planted bug 20)', async () => {
    const wide = mutant('threshold-to-two', { settings: makeSettings(2) });
    expect(await redOn('labels.settings-threshold-range-refused', wide)).toMatch(/was accepted/);
  });

  it('fails a reader that exports no settings reader, and says what it must do', async () => {
    const { settings: _, ...bare } = ref;
    expect(await redOn('labels.settings-threshold-range-refused', { ...bare, name: 'no-settings' })).toMatch(
      /exports no settings reader/,
    );
  });
});

describe('the catch items are pinned', () => {
  it('lists in validators/pointer/catch.json exactly the items whose row says catch, each with what it guards', () => {
    const pinned = readCatchList(fileURLToPath(new URL('../../../../', import.meta.url)), 'pointer');
    const rows = pointerBank().filter((candidate) => candidate.role === 'catch');
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(pinned?.keys())).toEqual(new Set(rows.map((row) => row.id)));
    for (const guards of pinned?.values() ?? []) expect(guards).toMatch(/^bug:B\d\d$/);
    expect(rows.length).toBeLessThanOrEqual(pointerBank().length * 0.15);
  });
});

/* ----- the reader and the verdict (audit of PR 1019, cheater seat 2) ----- */

const CONTROL_SENTENCE = 'The ledger is closed on the last day of the month.';
const REDIRECT = fileURLToPath(
  new URL('../../src/ladders/pointer/bank/plants/redirect-target.ts', import.meta.url),
);

describe('adversarial.verdict-channel-is-not-the-readers', () => {
  it('serves a correct reader and gives its pass, so the control can pass', async () => {
    const out = await probe(REFERENCE_SUT, { name: 'verdict' });
    expect(out.pass, out.detail).toBe(true);
  }, 180_000);

  it('fails a broken reader that wraps the send of its process and rewrites the verdict (variant 1)', async () => {
    const out = await probe(PLANTS.send, { name: 'verdict' });
    expect(out.pass, out.detail).toBe(false);
    expect(readerGainedNothing(out), out.detail).toBe(true);
  }, 180_000);

  it('fails a broken reader that writes a pass to the descriptor of the channel (variant 2)', async () => {
    const out = await probe(PLANTS.fd, { name: 'verdict' });
    expect(out.pass, out.detail).toBe(false);
    expect(readerGainedNothing(out), out.detail).toBe(true);
  }, 180_000);

  it('passes the item', async () => {
    const out = await runItem(item('adversarial.verdict-channel-is-not-the-readers'), 1, ref);
    expect(out.pass, out.detail).toBe(true);
  }, 300_000);
});

describe('adversarial.sut-env-not-trusted-in-reader-process', () => {
  it('serves a correct reader in this process and in a sandboxed one', async () => {
    const out = await probe(REFERENCE_SUT, { name: 'sandbox-cut', expect: CONTROL_SENTENCE });
    expect(out.pass, out.detail).toBe(true);
  }, 180_000);

  it('runs the planted reader in both processes although it points the environment at another (variant 4)', async () => {
    const out = await probe(PLANTS.env, { name: 'sandbox-cut', expect: MARKER_PLANTED });
    expect(out.pass, out.detail).toBe(true);
  }, 180_000);

  it('does not run the reader the cheat points at', async () => {
    const out = await probe(PLANTS.env, { name: 'sandbox-cut', expect: MARKER_REDIRECT });
    expect(out.pass, out.detail).toBe(false);
  }, 180_000);

  it('can tell the two readers apart when the harness names the second one', async () => {
    const out = await probe(REDIRECT, { name: 'sandbox-cut', expect: MARKER_REDIRECT });
    expect(out.pass, out.detail).toBe(true);
  }, 180_000);

  it('passes the item', async () => {
    const out = await runItem(item('adversarial.sut-env-not-trusted-in-reader-process'), 1, ref);
    expect(out.pass, out.detail).toBe(true);
  }, 300_000);
});

describe('adversarial.reader-imports-no-bank', () => {
  const READER = fileURLToPath(new URL('../../../estate/src/pointer', import.meta.url));

  /** A copy of the reader folder with one more file, which holds `line`. */
  function readerWith(line: string): string {
    const copy = join(mkdtempSync(join(tmpdir(), 'pointer-reader-')), 'pointer');
    cpSync(READER, copy, { recursive: true });
    mkdirSync(join(copy, 'extra'), { recursive: true });
    writeFileSync(join(copy, 'extra', 'cheat.ts'), `${line}\nexport {};\n`);
    return copy;
  }

  it('finds nothing in the reader as it is', () => {
    expect(importsOfValidators(READER)).toEqual([]);
  });

  it('finds an import of the reference reader of the validators', () => {
    const found = importsOfValidators(
      readerWith("import reference from '../../../../validators/test/pointer/reference/index';"),
    );
    expect(found).toEqual(['extra/cheat.ts: ../../../../validators/test/pointer/reference/index']);
  });

  it('finds a dynamic import, a re-export, a require and an address built with new URL', () => {
    for (const line of [
      "const mod = await import('../../../validators/src/ladders/pointer/bank/index');",
      "export * from '@agent-nexus/driftbench-validators';",
      "const mod = require('../../../validators/src/index');",
      "const where = new URL('../../../validators/test/pointer/reference/index.ts', import.meta.url);",
    ])
      expect(importsOfValidators(readerWith(line)), line).toHaveLength(1);
  });

  it('passes the item', async () => {
    const out = await runItem(item('adversarial.reader-imports-no-bank'), 1, ref);
    expect(out.pass, out.detail).toBe(true);
  });
});
