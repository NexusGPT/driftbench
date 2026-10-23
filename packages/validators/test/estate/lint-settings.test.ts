import { describe, expect, it } from 'vitest';
import { lintDefectFamily } from '../../src/ladders/estate/bank/index';
import { SETTINGS_CASES } from '../../src/ladders/estate/bank/lint-settings';

describe('the settings items of lint.defect', () => {
  it('are items of the family, each with its own id', () => {
    const ids = new Set(lintDefectFamily().items.map((item) => item.id));
    for (const item of SETTINGS_CASES) expect(ids.has(`lint.defect.${item.key}`), item.key).toBe(true);
  });

  for (const item of SETTINGS_CASES) {
    it(`pass on the product: ${item.key}`, async () => {
      const result = await item.judge();
      expect(result.detail).toBe('holds');
      expect(result.pass).toBe(true);
    });
  }
});
