import { rngFor } from '@agent-nexus/driftbench-generate';
import { expect, it } from 'vitest';
import { ItemFailure, leakReport } from '../../src/failure';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { realReader } from '../../src/ladders/pointer/sut/reader';

// The capability items of 2026-10-23 fail on the shared ItemFailure. Against the real reader, which lacks most of
// them, every failure they raise must be structured and must not repeat the planted value (docs/validators.md
// section 12, "What a failure message says").
const CAPABILITY =
  /^cutting\.(footnote|alert|front-matter|sentence-terminal|thai|directive|math)|^re-anchoring\.(cross-file|renamed-file|table-)/;

it('the capability items raise structured failures that do not leak the planted value', async () => {
  const sut = realReader();
  const items = pointerBank().filter((item) => CAPABILITY.test(item.id));
  expect(items).toHaveLength(18);
  const failures: Array<{ item: string; error: unknown }> = [];
  for (const item of items) {
    try {
      await item.run({ seed: 1, id: item.id, sut, rng: rngFor(1, item.id) });
    } catch (error) {
      failures.push({ item: item.id, error });
    }
  }
  expect(failures.length).toBeGreaterThan(0);
  expect(failures.every((f) => f.error instanceof ItemFailure)).toBe(true);
  const report = leakReport(failures);
  expect(report.unstructured).toBe(0);
  expect(report.leaking).toEqual([]);
}, 300_000);
