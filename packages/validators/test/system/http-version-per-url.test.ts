import { fileURLToPath } from 'node:url';
import * as adapters from '@agent-nexus/driftbench-adapters';
import { contentHash } from '@agent-nexus/driftbench-core';
import { expect, it, vi } from 'vitest';
import { adaptersItems } from '../../src/ladders/system/bank/claims/adapters';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const item = adaptersItems().find((entry) => entry.id === 'claim/adapters/http/version-per-url');
if (!item) throw new Error('missing http/version-per-url bank item');
const check = () => item.check({ seed: 5, root, scratch: root });

it('accepts the exported adapter version plus the URL content hash', async () => {
  await expect(check()).resolves.toEqual({ pass: true });
});

for (const mutation of ['no URL hash', 'shared version', 'unrelated hashes'] as const) {
  it(`rejects ${mutation}, then passes after restoration`, async () => {
    const original = adapters.httpAdapter;
    const assigned = new Map<string, string>();
    const spy = vi.spyOn(adapters, 'httpAdapter').mockImplementation((options) => {
      const adapter = original(options);
      if (!assigned.has(options.url)) assigned.set(options.url, contentHash(assigned.size));
      const suffix = mutation === 'shared version' ? contentHash('constant') : assigned.get(options.url);
      return {
        ...adapter,
        version:
          mutation === 'no URL hash'
            ? adapters.HTTP_ADAPTER_VERSION
            : `${adapters.HTTP_ADAPTER_VERSION}+${suffix}`,
      };
    });
    try {
      const result = await check();
      expect(spy).toHaveBeenCalledTimes(3);
      expect(result.pass).toBe(false);
      if (!result.pass) expect(result.detail).toContain('expected version');
    } finally {
      spy.mockRestore();
    }
    await expect(check()).resolves.toEqual({ pass: true });
  });
}
