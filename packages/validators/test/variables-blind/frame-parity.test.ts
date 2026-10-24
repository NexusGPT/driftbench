import { afterAll, describe, expect, it, vi } from 'vitest';
import { variablesImpl } from '../../src/ladders/variables/adapter';
import { runInProcess, variablesBank } from '../../src/ladders/variables/bank/index';
import { runIsolated } from '../../src/ladders/variables/bank/isolate';
import { IMPL_ENV, implModulePath } from '../../src/ladders/variables/impl';
import { findRoot } from '../../src/root';

/**
 * The frame runs the implementation apart (docs/validators.md section 12.9): the honest adapter must give the same
 * verdict through the runner as in this process. A sample of every family, seed 1, both ways; a difference names
 * the item and both outcomes. The whole bank on seeds 1 to 3 is compared by tools/variables-frame-parity.ts.
 */

vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

const ROOT = findRoot(process.cwd());
const named = process.env[IMPL_ENV];
afterAll(() => {
  if (named === undefined) delete process.env[IMPL_ENV];
  else process.env[IMPL_ENV] = named;
});

describe('the honest adapter through the frame', () => {
  it('gives the same verdict as in this process on a sample of every family', async () => {
    delete process.env[IMPL_ENV];
    const byFamily = new Map<string, number>();
    const sample = variablesBank().filter((item) => {
      if (item.budgetMs !== undefined) return false;
      const seen = byFamily.get(item.family) ?? 0;
      byFamily.set(item.family, seen + 1);
      return seen < 3;
    });
    expect(sample.length).toBeGreaterThan(10);
    const direct = await runInProcess(sample, 1, ROOT, variablesImpl, implModulePath());
    const framed = await runIsolated(sample, 1, ROOT);
    const differ = sample
      .filter((item) => direct.get(item.id)?.pass !== framed.get(item.id)?.pass)
      .map((item) => {
        const [d, f] = [direct.get(item.id), framed.get(item.id)];
        return `${item.id}: in this process ${d?.pass} (${d?.detail?.slice(0, 160)}), framed ${f?.pass} (${f?.detail?.slice(0, 300)})`;
      });
    expect(differ).toEqual([]);
  });
});
