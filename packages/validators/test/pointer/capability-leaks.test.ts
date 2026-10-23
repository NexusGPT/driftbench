import { rngFor } from '@agent-nexus/driftbench-generate';
import { expect, it } from 'vitest';
import { ItemFailure, leakReport } from '../../src/failure';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { realReader } from '../../src/ladders/pointer/sut/reader';

// The capability items of 2026-10-23 fail on the shared ItemFailure: every failure they raise must be structured and
// must not repeat the planted value (docs/validators.md section 12, "What a failure message says"). Cut items run
// on the real reader with its last cut unit dropped, so each fails whatever the reader has learned; re-anchoring
// items run on the real reader itself (its scan checks the cut it is given).
const CAPABILITY =
  /^cutting\.(footnote|alert|front-matter|sentence-terminal|thai|directive|math)|^re-anchoring\.(cross-file|renamed-file|table-)/;

it('the capability items raise structured failures that do not leak the planted value', async () => {
  const base = realReader();
  const sut = {
    ...base,
    cut: async (file: Parameters<typeof base.cut>[0]) => {
      const cut = await base.cut(file);
      return { ...cut, units: cut.units.slice(0, -1) };
    },
  };
  const items = pointerBank().filter((item) => CAPABILITY.test(item.id));
  expect(items).toHaveLength(25);
  const failures: Array<{ item: string; error: unknown }> = [];
  for (const item of items) {
    try {
      const reader = item.family === 'cutting' ? sut : base;
      await item.run({ seed: 1, id: item.id, sut: reader, rng: rngFor(1, item.id) });
    } catch (error) {
      failures.push({ item: item.id, error });
    }
  }
  expect(failures.length).toBeGreaterThanOrEqual(12);
  expect(failures.every((f) => f.error instanceof ItemFailure)).toBe(true);
  const report = leakReport(failures);
  expect(report.unstructured).toBe(0);
  expect(report.leaking).toEqual([]);
}, 300_000);
