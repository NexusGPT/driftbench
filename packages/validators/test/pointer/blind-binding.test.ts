import { beforeAll, describe, expect, it } from 'vitest';
import { blindLevels } from '../../src/ladders/pointer/bank/blind';
import { withReplacedExports } from '../../src/ladders/pointer/sut/blind-binding/reader';
import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { assertReaderAvailable, loadReaderWithRetry, realReader } from '../../src/ladders/pointer/sut/reader';

/**
 * The blind bank against the real reader. The counts below are what the binding reaches today: items that pass,
 * items whose observation differs from the planted truth (behaviour of the reader against the design), and items
 * the reader has no call for (the detail says so). A change of the reader or the binding moves them.
 */
async function realExports(): Promise<Record<string, any>> {
  return (await import('@agent-nexus/driftbench-estate')).pointer as Record<string, any>;
}

describe('the blind bank bound to the reader', () => {
  // The reader loads once, with a long bound, before any item runs: a slow import on a loaded host cannot move a count.
  beforeAll(async () => {
    await assertReaderAvailable(120_000);
  }, 130_000);

  it('passes, differs or is unsupported with the reason written in the detail', async () => {
    const counts = { pass: 0, unsupported: 0, differs: 0, error: 0 };
    const reasons = new Set<string>();
    for (const level of blindLevels(async () => realReader())) {
      const measure = await level.compute({ seed: 1, hidden: false, root: process.cwd() });
      for (const entry of measure.bank ?? []) {
        if (entry.pass) counts.pass += 1;
        else if (/adapter, projection, or fixture failed/.test(entry.detail ?? '')) counts.error += 1;
        else if (/adapter gap, not a reader defect/.test(entry.detail ?? '')) {
          counts.unsupported += 1;
          reasons.add((entry.detail ?? '').replace(/^.*?: (unsupported: [a-z]+(?::[a-z]+)?).*$/s, '$1'));
        } else counts.differs += 1;
      }
    }
    expect(counts).toEqual({ pass: 264, differs: 0, unsupported: 79, error: 0 });
    expect([...reasons].sort()).toEqual([
      'unsupported: group:carry',
      'unsupported: labels:rerecord',
      'unsupported: links',
      'unsupported: radius',
      'unsupported: reanchor',
      'unsupported: replay',
    ]);
  }, 300_000);

  it('gives the same verdict for every item on three runs in one process', async () => {
    const run = async () => {
      const verdicts: string[] = [];
      for (const level of blindLevels(async () => realReader())) {
        const measure = await level.compute({ seed: 1, hidden: false, root: process.cwd() });
        for (const entry of measure.bank ?? []) verdicts.push(`${entry.id} ${entry.pass} ${entry.detail}`);
      }
      return verdicts;
    };
    const first = await run();
    expect(await run()).toEqual(first);
    expect(await run()).toEqual(first);
  }, 600_000);

  // Planted-bug readers, run through the binding itself: each must move the bank.
  const MATERIALIZING = [
    'obligation',
    'prohibition',
    'custom-label',
    'gate-forward',
    'gate-backward',
    'unicode-quote',
  ].map((name) => `blind/labels.materialize.${name}`);

  async function labelsLevel(resolve: () => Promise<PointerSut> = async () => realReader()) {
    const level = blindLevels(resolve)[2];
    const measure = await level?.compute({ seed: 1, hidden: false, root: process.cwd() });
    return new Map((measure?.bank ?? []).map((entry) => [entry.id, entry.pass]));
  }

  it('keeps the seven materialization items green on the real reader, the no-mapping control included', async () => {
    const passes = await labelsLevel();
    for (const id of [...MATERIALIZING, 'blind/labels.materialize.no-mapping'])
      expect(passes.get(id), id).toBe(true);
  }, 120_000);

  it('loses the six atom-building materialization items when the reader drops every atom predicate', async () => {
    const real = await realExports();
    const passes = await withReplacedExports(
      {
        pointerAtoms: (...args: unknown[]) => {
          const out = real.pointerAtoms(...args);
          return {
            ...out,
            accepted: out.accepted.map((atom: Record<string, unknown>) => ({ ...atom, evidence: [] })),
          };
        },
      },
      () => labelsLevel(),
    );
    for (const id of MATERIALIZING) expect(passes.get(id), id).toBe(false);
    expect(passes.get('blind/labels.materialize.no-mapping')).toBe(true);
  }, 120_000);

  it('loses the six atom-building materialization items when the reader sets reviewRequired to false', async () => {
    const real = await realExports();
    const passes = await withReplacedExports(
      {
        pointerAtoms: (...args: unknown[]) => {
          const out = real.pointerAtoms(...args);
          return {
            ...out,
            accepted: out.accepted.map((atom: { evidence: Array<{ options?: object }> }) => ({
              ...atom,
              evidence: atom.evidence.map((p) => ({
                ...p,
                options: { ...p.options, reviewRequired: false },
              })),
            })),
          };
        },
      },
      () => labelsLevel(),
    );
    for (const id of MATERIALIZING) expect(passes.get(id), id).toBe(false);
    expect(passes.get('blind/labels.materialize.no-mapping')).toBe(true);
  }, 120_000);

  // The six spec-changed fence and comment items plant: no key read, no fetch, no cache lookup, nothing stored.
  const OPAQUE_ONLY = ['fence', 'comment'].flatMap((placement) =>
    ['record', 'ci-hit', 'ci-miss'].map((mode) => `blind/privacy.${placement}.${mode}`),
  );

  async function privacyLevel() {
    const level = blindLevels(async () => realReader())[3];
    const measure = await level?.compute({ seed: 1, hidden: false, root: process.cwd() });
    return new Map((measure?.bank ?? []).map((entry) => [entry.id, entry.pass]));
  }

  it('passes the six opaque-only privacy items on the real reader, which sends nothing for them', async () => {
    const passes = await privacyLevel();
    for (const id of OPAQUE_ONLY) expect(passes.get(id), id).toBe(true);
  }, 120_000);

  it('loses those six items when the reader scan reads the key and sends for a source with nothing to label', async () => {
    const real = await realExports();
    const passes = await withReplacedExports(
      {
        // A planted scan: the same reader, but it labels a public paragraph it adds to every source, so it sends.
        pointerScan: (input: { files: Array<{ path: string; text: string }> }) =>
          real.pointerScan({
            ...input,
            files: input.files.map((file) => ({ ...file, text: `${file.text}\n\nA public paragraph.` })),
          }),
      },
      () => privacyLevel(),
    );
    for (const id of OPAQUE_ONLY) expect(passes.get(id), id).toBe(false);
    for (const [id, pass] of passes)
      if (id.startsWith('blind/privacy.') && !OPAQUE_ONLY.includes(id)) expect(pass, id).toBe(true);
  }, 120_000);

  it('counts a cutter that throws on an opaque unit as adapter errors, so the zero-error assertion goes red', async () => {
    const real = realReader();
    const throwing: PointerSut = {
      ...real,
      cut: async (file) => {
        const cut = await real.cut(file);
        if (cut.units.some((unit) => unit.opaque)) throw new Error('the cutter met an opaque unit');
        return cut;
      },
    };
    let errors = 0;
    for (const level of blindLevels(async () => throwing)) {
      const measure = await level.compute({ seed: 1, hidden: false, root: process.cwd() });
      for (const entry of measure.bank ?? [])
        if (!entry.pass && /adapter, projection, or fixture failed/.test(entry.detail ?? '')) errors += 1;
    }
    expect(errors).toBeGreaterThan(0);
  }, 300_000);
});

describe('loading the reader', () => {
  const fake = { pointer: {}, AtomBuilder: class {} } as Record<string, unknown>;

  it('tries again after a slow import and does not keep the failure', async () => {
    // One import that takes longer than one bound: the first attempt times out, a later one finds it settled.
    const importing = new Promise<Record<string, unknown>>((resolve) => setTimeout(() => resolve(fake), 60));
    let calls = 0;
    await expect(
      loadReaderWithRetry(
        () => {
          calls += 1;
          return importing;
        },
        20,
        10,
      ),
    ).rejects.toThrow(/does not export/);
    expect(calls).toBeGreaterThan(1);
  });

  it('does not retry an import that fails', async () => {
    let calls = 0;
    await expect(
      loadReaderWithRetry(
        async () => {
          calls += 1;
          throw new Error('no such module');
        },
        20,
        10,
      ),
    ).rejects.toThrow(/cannot be loaded/);
    expect(calls).toBe(1);
  });
});
