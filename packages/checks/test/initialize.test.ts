import { objectRegistry, shippedObjectContext } from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';

const initial = objectRegistry.snapshot();
afterEach(() => objectRegistry.restore(initial));

describe('explicit shipped-object initialization', () => {
  it('importing checks leaves the object registry unchanged', async () => {
    await import('../src/index');
    expect(objectRegistry.snapshot()).toEqual(initial);
  });

  it('initializes the default policy idempotently, including after registry restore', async () => {
    const { initializeShippedObjects } = await import('../src/index');
    for (let attempt = 0; attempt < 2; attempt++) {
      initializeShippedObjects();
      initializeShippedObjects();
      const policy = shippedObjectContext().store.resolve('policy/value-check', 'default');
      expect(policy.items.some((item) => item.id === 'rung1_outcome')).toBe(true);
      const shipped = objectRegistry.shipped().map((one) => {
        const raw = one.raw as { kind: string; id: string };
        return `${raw.kind}:${raw.id}`;
      });
      expect(shipped.sort()).toEqual([
        'policy/blame:default',
        'policy/placement:default',
        'policy/value-check:default',
      ]);
      objectRegistry.restore(initial);
    }
  });

  it('defaultChecks initializes before the caller loads a spec', async () => {
    const { defaultChecks } = await import('../src/index');
    defaultChecks();
    expect(shippedObjectContext().store.resolve('policy/value-check', 'default').id).toBe('default');
  });
});
