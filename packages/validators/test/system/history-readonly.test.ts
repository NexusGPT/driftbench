import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { adaptersItems } from '../../src/ladders/system/bank/claims/adapters';
import { scratchFolder } from '../../src/ladders/system/bank/index';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch = scratchFolder();
afterAll(() => scratch.remove());
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const hidden = 1_000_000 + (Number.parseInt(head.slice(0, 8), 16) % 1_000_000_000);
const seeds = process.env.HISTORY_MUTANT ? [1] : [...Array.from({ length: 20 }, (_, i) => i + 1), hidden];
const ids = [
  'claim/adapters/function/open-history-copy',
  'claim/adapters/function/args-are-copies',
  'claim/adapters/process/history-is-a-copy',
];
for (const id of ids) {
  it(id, async () => {
    const item = adaptersItems().find((entry) => entry.id === id);
    expect(item).toBeDefined();
    if (!item) throw new Error(`missing bank item ${id}`);
    for (const seed of seeds) {
      const result = await item.check({ seed, root, scratch: scratch.path });
      console.log(JSON.stringify({ id, seed, mutant: process.env.HISTORY_MUTANT ?? null, ...result }));
      expect(result).toEqual({ pass: true });
    }
  }, 120_000);
}
