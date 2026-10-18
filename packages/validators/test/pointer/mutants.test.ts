import { describe, expect, it } from 'vitest';
import type {
  CutResult,
  Labeler,
  PointerSut,
  ScanRequest,
  StackRequest,
} from '../../src/ladders/pointer/sut/port';
import { tally } from './helpers';
import { referenceSut } from './reference/index';
import { referenceStack } from './reference/stack';

/** A reader with one planted bug: the bank must lose items for it. */
const ref = referenceSut();
const mutant = (name: string, patch: Partial<PointerSut>): PointerSut => ({ ...ref, name, ...patch });
const cutWith = (f: (r: CutResult) => CutResult) => async (file: { path: string; text: string }) =>
  f(await ref.cut(file));

const DEONTIC = /\b(must|never|always|shall|should|required|forbidden|do not)\b/i;
const cheater: Labeler = (request) => ({
  labels: request.window.units
    .filter((u) => u.mode === 'label')
    .map((u) => ({ units: u.n, label: DEONTIC.test(u.text) ? 'rule' : 'none' })),
});

describe('planted readers lose items', { timeout: 600_000 }, () => {
  it('a cut that drops the last unit of a file loses cutting items', async () => {
    const out = await tally(
      mutant('drops-last', { cut: cutWith((r) => ({ ...r, units: r.units.slice(0, -1) })) }),
      (i) => i.family === 'cutting',
    );
    expect(out.failed.length).toBeGreaterThan(out.total * 0.8);
  });

  it('a cut whose spans are off by one loses cutting items', async () => {
    const out = await tally(
      mutant('shifted', {
        cut: cutWith((r) => ({ ...r, units: r.units.map((u) => ({ ...u, start: u.start + 1 })) })),
      }),
      (i) => i.family === 'cutting',
    );
    expect(out.failed.length).toBeGreaterThan(out.total * 0.8);
  });

  it('a cut that keeps no heading path loses cutting items', async () => {
    const out = await tally(
      mutant('flat', { cut: cutWith((r) => ({ ...r, units: r.units.map((u) => ({ ...u, path: [] })) })) }),
      (i) => i.family === 'cutting',
    );
    expect(out.failed.length).toBeGreaterThan(5);
  });

  it('a scan that forgets the previous ledger loses re-anchoring and id items', async () => {
    const forgets = mutant('forgets-previous', {
      scan: (request: ScanRequest) => ref.scan({ ...request, previousLedger: undefined }),
    });
    const out = await tally(forgets, (i) => i.family === 're-anchoring' || i.family === 'ids');
    expect(out.failed.length).toBeGreaterThan(out.total * 0.4);
  });

  it('a scan that reports no events loses re-anchoring items', async () => {
    const quiet = mutant('quiet', {
      scan: async (request: ScanRequest) => {
        const out = await ref.scan(request);
        return { ...out, events: {}, eventCounts: {} };
      },
    });
    const out = await tally(quiet, (i) => i.family === 're-anchoring');
    expect(out.failed.length).toBeGreaterThan(out.total * 0.3);
  });

  it('a scan that labels by deontic words loses the decoy items', async () => {
    const surface = mutant('surface-labeller', {
      scan: (request: ScanRequest) =>
        request.labeler ? ref.scan({ ...request, labeler: cheater }) : ref.scan(request),
    });
    const out = await tally(
      surface,
      (i) => i.family === 'adversarial' && /decoy|deontic|without|example|fences/.test(i.id),
    );
    expect(out.failed.length).toBeGreaterThanOrEqual(5);
  });

  it('a scan that keeps no labels loses label items', async () => {
    const blind = mutant('blind', {
      scan: (request: ScanRequest) =>
        request.labeler ? ref.scan({ ...request, labeler: () => ({ labels: [] }) }) : ref.scan(request),
    });
    const out = await tally(blind, (i) => i.family === 'labels' || i.family === 'grouping');
    expect(out.failed.length).toBeGreaterThan(out.total * 0.3);
  });
  const stackMutant = (name: string, patch: (request: StackRequest) => StackRequest): PointerSut =>
    mutant(name, { stack: { run: (request: StackRequest) => referenceStack.run(patch(request)) } });

  it('a stack that sends everything to system 2 loses stack items', async () => {
    const out = await tally(
      stackMutant('send-all', (r) => ({ ...r, marginCut: 2 })),
      (i) => i.family === 'stack',
    );
    expect(out.failed.length).toBeGreaterThan(5);
  });

  it('a stack that never sends to system 2 loses stack items', async () => {
    const out = await tally(
      stackMutant('send-none', (r) => ({ ...r, marginCut: 0, shareToSystem2: undefined })),
      (i) => i.family === 'stack',
    );
    expect(out.failed.length).toBeGreaterThan(8);
  });

  it('a stack that runs system 2 once loses stack items', async () => {
    const out = await tally(
      stackMutant('one-run', (r) => ({ ...r, runs: 1 })),
      (i) => i.family === 'stack',
    );
    expect(out.failed.length).toBeGreaterThan(5);
  });

  it('a stack with no stack at all loses every stack item', async () => {
    const out = await tally(mutant('no-stack', { stack: undefined }), (i) => i.family === 'stack');
    expect(out.failed.length).toBe(out.total);
  });
});
