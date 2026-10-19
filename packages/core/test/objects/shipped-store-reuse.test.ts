import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeShippedObjects,
  ObjectRegistry,
  type ObjectStore,
  objectRegistry,
  shippedObjectContext,
} from '../../src/objects';
import { Envelope } from '../../src/schema/object';

// Every run asks for the shipped objects. They are read and checked once per registry state, not once per run, and
// the result is counted, not timed: how many times an object file is parsed, and whether two runs share a resolution.

const ANY = { safeParse: (value: unknown) => ({ success: true, data: value }) } as never;
const ITEM = { id: 'a', title: 'A', impl: 'builtin:any' };

function registry(): ObjectRegistry {
  return new ObjectRegistry()
    .registerKind({ kind: 'check-set', summary: 'Checks.', agentFacing: false })
    .registerImpl('builtin:any', { params: ANY })
    .registerShipped({ kind: 'check-set', id: 'default', items: [ITEM] }, 'default.yaml');
}

const parses = () => vi.spyOn(Envelope, 'safeParse');

afterEach(() => vi.restoreAllMocks());

describe('the shipped objects of a registry are read once per registry state', () => {
  it('reads no object file again for the second and every later context', () => {
    const shipped = registry();
    shippedObjectContext(shipped);
    const spy = parses();
    for (let run = 0; run < 20; run += 1) shippedObjectContext(shipped);
    expect(spy).not.toHaveBeenCalled();
  });

  it('gives two contexts the same resolution of a shipped object', () => {
    const shipped = registry();
    const first = shippedObjectContext(shipped).store.resolve('check-set', 'default');
    const second = shippedObjectContext(shipped).store.resolve('check-set', 'default');
    expect(second).toBe(first);
  });

  it('does not read again when initialisation runs again and registers nothing', () => {
    initializeShippedObjects();
    const snapshot = objectRegistry.snapshot();
    try {
      objectRegistry.registerImpl('builtin:any-for-reuse', { params: ANY });
      objectRegistry.registerShipped(
        { kind: 'check-set', id: 'reuse', items: [{ ...ITEM, impl: 'builtin:any-for-reuse' }] },
        'reuse.yaml',
      );
      shippedObjectContext();
      const spy = parses();
      initializeShippedObjects();
      shippedObjectContext();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      objectRegistry.restore(snapshot);
    }
  });
});

describe('a context is the caller’s own', () => {
  it('keeps an object added to one context out of every other', () => {
    const shipped = registry();
    const mine = shippedObjectContext(shipped);
    mine.store.add({ kind: 'check-set', id: 'extra', items: [ITEM] }, 'project', { path: 'extra.yaml' });
    expect(mine.store.has('check-set', 'extra')).toBe(true);
    const other = shippedObjectContext(shipped);
    expect(other.store.has('check-set', 'extra')).toBe(false);
    // The same id can be added again in another context: nothing was left behind.
    other.store.add({ kind: 'check-set', id: 'extra', items: [ITEM] }, 'project', { path: 'extra.yaml' });
    expect(other.store.has('check-set', 'extra')).toBe(true);
  });

  it('resolves a shipped object the same after another context added a layer over a sibling', () => {
    const shipped = registry();
    const before = shippedObjectContext(shipped).store.resolve('check-set', 'default').hash;
    const mine = shippedObjectContext(shipped);
    mine.store.add(
      { kind: 'check-set', id: 'child', extends: 'default', items: [{ id: 'a', enabled: false }] },
      'project',
      { path: 'child.yaml' },
    );
    expect(mine.store.resolve('check-set', 'child').items[0]?.enabled).toBe(false);
    expect(shippedObjectContext(shipped).store.resolve('check-set', 'default').hash).toBe(before);
    expect(shippedObjectContext(shipped).store.resolve('check-set', 'default').items[0]?.enabled).toBe(true);
  });
});

describe('a registration is seen by the next context', () => {
  const has = (store: ObjectStore, id: string) => store.has('check-set', id);

  it('sees a shipped object registered after a context was built, and not the earlier one', () => {
    const shipped = registry();
    const early = shippedObjectContext(shipped);
    shipped.registerShipped({ kind: 'check-set', id: 'late', items: [ITEM] }, 'late.yaml');
    expect(has(shippedObjectContext(shipped).store, 'late')).toBe(true);
    expect(has(early.store, 'late')).toBe(false);
  });

  it('sees a kind and an implementation registered after a context was built', () => {
    const shipped = registry();
    shippedObjectContext(shipped);
    shipped.registerKind({ kind: 'policy/routing', summary: 'Routing.', agentFacing: false });
    shipped.registerImpl('plugin:route', { params: ANY });
    shipped.registerShipped(
      { kind: 'policy/routing', id: 'route', items: [{ id: 'r', title: 'R', impl: 'plugin:route' }] },
      'route.yaml',
    );
    expect(shippedObjectContext(shipped).store.resolve('policy/routing', 'route').items).toHaveLength(1);
  });

  it('forgets what a restore forgets', () => {
    const shipped = registry();
    const snapshot = shipped.snapshot();
    shipped.registerShipped({ kind: 'check-set', id: 'late', items: [ITEM] }, 'late.yaml');
    expect(has(shippedObjectContext(shipped).store, 'late')).toBe(true);
    shipped.restore(snapshot);
    expect(has(shippedObjectContext(shipped).store, 'late')).toBe(false);
    expect(has(shippedObjectContext(shipped).store, 'default')).toBe(true);
  });
});
