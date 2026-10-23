import { describe, expect, it, vi } from 'vitest';
import { lintDefectFamily } from '../../src/ladders/estate/bank/index';
import { REPORT_CASES } from '../../src/ladders/estate/bank/lint-report';

// Each test scans or builds an estate: on a loaded runner that takes longer than the default 5 seconds.
vi.setConfig({ testTimeout: 120_000 });

describe('the report items of lint.defect', () => {
  it('are items of the family, each with its own id', () => {
    const ids = new Set(lintDefectFamily().items.map((item) => item.id));
    for (const item of REPORT_CASES) expect(ids.has(`lint.defect.${item.key}`), item.key).toBe(true);
  });

  for (const item of REPORT_CASES) {
    it(`pass on the product: ${item.key}`, async () => {
      const result = await item.judge();
      expect(result.detail).toBe('holds');
      expect(result.pass).toBe(true);
    });
  }
});
