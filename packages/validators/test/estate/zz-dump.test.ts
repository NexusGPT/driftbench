import { writeFileSync } from 'node:fs';
import { it, vi } from 'vitest';
import { BANK_LEVELS } from '../../src/ladders/estate/bank/index';

// Temporary: dumps every item verdict of the estate bank (scale left out) for seeds 1 to 3.
vi.setConfig({ testTimeout: 3_000_000 });
it('dumps the bank', async () => {
  const out: Record<string, { pass: boolean; detail: string }> = {};
  for (const level of BANK_LEVELS.filter((l) => l.id !== 'scale')) {
    for (const family of level.families()) {
      for (const seed of family.seedFree ? [1] : [1, 2, 3]) {
        let results: Awaited<ReturnType<typeof family.evaluate>>;
        try {
          results = await family.evaluate(seed);
        } catch (cause) {
          out[`${family.id}|${seed}|THREW`] = { pass: false, detail: String(cause).slice(0, 300) };
          continue;
        }
        for (const [id, r] of results) out[`${id}|${family.seedFree ? '*' : seed}`] = { pass: r.pass, detail: r.detail.slice(0, 300) };
      }
    }
  }
  writeFileSync('bank-dump.json', JSON.stringify(out, null, 1));
  console.log(`[DUMP] ${Object.keys(out).length} items`);
});
