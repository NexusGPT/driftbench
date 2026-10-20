import { describe, expect, it } from 'vitest';
import { ObjectRegistry, shippedObjectContext } from '../../src/objects';

const ANY = { safeParse: (value: unknown) => ({ success: true, data: value }) } as never;

/** A registry with one kind, one implementation and one shipped object whose reads are counted. */
function counted() {
  const registry = new ObjectRegistry();
  registry.registerKind({ kind: 'check-set', summary: 'Checks.', agentFacing: false });
  registry.registerImpl('builtin:keep', { params: ANY });
  let reads = 0;
  const raw = new Proxy(
    { kind: 'check-set', id: 'default', items: [{ id: 'a', title: 'A', impl: 'builtin:keep' }] },
    {
      ownKeys(target) {
        reads++;
        return Reflect.ownKeys(target);
      },
    },
  );
  registry.registerShipped(raw, 'shipped.yaml');
  return { registry, reads: () => reads };
}

describe('the shipped objects of a registry are read once, not once per run', () => {
  it('reads a shipped object once over 200 runs that each ask for the shipped context', () => {
    const { registry, reads } = counted();
    for (let run = 0; run < 200; run++) {
      expect(shippedObjectContext(registry).store.resolve('check-set', 'default').items).toHaveLength(1);
    }
    // Reading the object walks its keys once (the envelope and its other keys); 200 runs read it as often as one.
    const once = reads();
    expect(once).toBeGreaterThan(0);
    const fresh = counted();
    shippedObjectContext(fresh.registry).store.resolve('check-set', 'default');
    expect(once).toBe(fresh.reads());
  });

  it('sees a registration and a restore, and gives each call a store of its own', () => {
    const { registry, reads } = counted();
    const before = registry.snapshot();
    shippedObjectContext(registry).store.resolve('check-set', 'default');
    const once = reads();

    // A caller that adds an object changes its own store only.
    const own = shippedObjectContext(registry).store;
    own.add({ kind: 'check-set', id: 'mine', items: [] }, 'project', { path: 'mine.yaml' });
    expect(own.has('check-set', 'mine')).toBe(true);
    expect(shippedObjectContext(registry).store.has('check-set', 'mine')).toBe(false);

    registry.registerShipped(
      { kind: 'check-set', id: 'plugin', items: [{ id: 'b', title: 'B', impl: 'builtin:keep' }] },
      'plugin.yaml',
    );
    expect(shippedObjectContext(registry).store.has('check-set', 'plugin')).toBe(true);

    registry.restore(before);
    expect(shippedObjectContext(registry).store.has('check-set', 'plugin')).toBe(false);

    registry.registerImpl('plugin:late', { params: ANY });
    expect(shippedObjectContext(registry).store.resolve('check-set', 'default').items).toHaveLength(1);
    // The kind definition did not change, so the shipped object is still read only once.
    expect(reads()).toBe(once);
  });

  it('costs 200 runs less than 20 times one run (main read and resolved everything again on each run)', () => {
    const registry = new ObjectRegistry();
    registry.registerKind({ kind: 'check-set', summary: 'Checks.', agentFacing: false });
    registry.registerImpl('builtin:keep', { params: ANY });
    for (let set = 0; set < 10; set++) {
      registry.registerShipped(
        {
          kind: 'check-set',
          id: `set-${set}`,
          items: Array.from({ length: 30 }, (_, item) => ({
            id: `i${item}`,
            title: `Item ${item}`,
            impl: 'builtin:keep',
          })),
        },
        `set-${set}.yaml`,
      );
    }
    const run = () => {
      const { store } = shippedObjectContext(registry);
      for (let set = 0; set < 10; set++) store.resolve('check-set', `set-${set}`);
    };
    let start = performance.now();
    run();
    const one = performance.now() - start;
    start = performance.now();
    for (let each = 0; each < 200; each++) run();
    const many = performance.now() - start;
    expect(many, `one run ${one.toFixed(1)} ms, 200 runs ${many.toFixed(1)} ms`).toBeLessThan(20 * one);
  });

  it('gives each registry its own shipped objects', () => {
    const one = counted();
    const two = counted();
    one.registry.registerShipped({ kind: 'check-set', id: 'only-one', items: [] }, 'one.yaml');
    expect(shippedObjectContext(one.registry).store.has('check-set', 'only-one')).toBe(true);
    expect(shippedObjectContext(two.registry).store.has('check-set', 'only-one')).toBe(false);
  });
});
