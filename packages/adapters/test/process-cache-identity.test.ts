import { blockCacheKey, resolveGiven } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { expect, it } from 'vitest';
import { processAdapter } from '../src/process';

function key(command: string, args?: string[]) {
  const adapter = processAdapter({
    command,
    ...(args === undefined ? {} : { args }),
    provider: localProvider(),
  });
  expect(adapter.version).toBe('0.1.0');
  const target = { adapter: 'process', agent: 'fictional-echo' };
  return blockCacheKey({
    specHash: 'spec',
    repeat: 0,
    position: 0,
    given: resolveGiven({ ledger: {}, world: {}, vars: {} }, [], target),
    stimulus: { user: 'hello' },
    target,
    adapter: adapter.id,
    adapterVersion: adapter.version,
    adapterCacheIdentity: adapter.cacheIdentity,
  });
}

it('uses a different cache key for a different process binary or argument list', () => {
  expect(key('echo', ['hello'])).not.toBe(key('printf', ['hello']));
  expect(key('echo', ['hello'])).not.toBe(key('echo', ['goodbye']));
  expect(key('echo', ['a b'])).not.toBe(key('echo', ['a', 'b']));
  expect(key('echo')).toBe(key('echo', []));
  expect(key('echo', ['hello'])).toBe(key('echo', ['hello']));
});
