import { it, vi } from 'vitest';
import { maintainFixtureFamily } from '../../src/ladders/estate/bank/maintain-fixture';

vi.setConfig({ testTimeout: 900_000 });
it('git-versions', async () => {
  const out = await maintainFixtureFamily().evaluate(1);
  for (const [k, v] of out) console.log(`[GV] ${k} ${v.pass} ${v.detail.slice(0, 200)}`);
});
