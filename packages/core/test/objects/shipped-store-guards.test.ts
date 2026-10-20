import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ObjectRegistry, ObjectStore, shippedObjectContext } from '../../src/objects';

// Guards beside shipped-store-cache.test.ts. That file proves the shipped objects are read once; these prove what
// the kept store must not do: leak a resolution between contexts, serve one registry's objects to another, or serve
// a stale entry once the kind it was read under has changed. Every check is a count or an identity, never a time.

const ANY = { safeParse: (value: unknown) => ({ success: true, data: value }) } as never;
const ITEM = { id: 'a', title: 'A', impl: 'builtin:keep' };

function registry(...shipped: Array<[raw: object, path: string]>): ObjectRegistry {
  const made = new ObjectRegistry();
  made.registerKind(KIND);
  made.registerImpl('builtin:keep', { params: ANY });
  for (const [raw, path] of shipped) made.registerShipped(raw, path);
  return made;
}
const KIND = { kind: 'check-set', summary: 'Checks.', agentFacing: false } as const;
const DEFAULT = { kind: 'check-set', id: 'default', items: [ITEM] };

describe('resolutions of the kept shipped store', () => {
  it('gives two contexts the very same resolution of a shipped object', () => {
    const shipped = registry([DEFAULT, 'default.yaml']);
    const first = shippedObjectContext(shipped).store.resolve('check-set', 'default');
    expect(shippedObjectContext(shipped).store.resolve('check-set', 'default')).toBe(first);
  });

  it('keeps a child added in one context out of what every other context resolves', () => {
    const shipped = registry([DEFAULT, 'default.yaml']);
    const before = shippedObjectContext(shipped).store.resolve('check-set', 'default');
    const mine = shippedObjectContext(shipped).store;
    mine.add(
      { kind: 'check-set', id: 'child', extends: 'default', items: [{ id: 'a', enabled: false }] },
      'project',
      { path: 'child.yaml' },
    );
    expect(mine.resolve('check-set', 'child').items[0]?.enabled).toBe(false);
    const other = shippedObjectContext(shipped).store;
    expect(other.has('check-set', 'child')).toBe(false);
    expect(other.resolve('check-set', 'default')).toBe(before);
    expect(other.resolve('check-set', 'default').items[0]?.enabled).toBe(true);
  });

  it('lets two contexts add the same id, because neither holds what the other added', () => {
    const shipped = registry([DEFAULT, 'default.yaml']);
    const add = (store: ObjectStore) =>
      store.add({ kind: 'check-set', id: 'known', items: [] }, 'project', { path: 'known.yaml' });
    expect(() => add(shippedObjectContext(shipped).store)).not.toThrow();
    expect(() => add(shippedObjectContext(shipped).store)).not.toThrow();
  });
});

describe('a store built from another store', () => {
  it('ignores a base that belongs to another registry, and holds its own shipped objects', () => {
    const one = registry(
      [DEFAULT, 'default.yaml'],
      [{ kind: 'check-set', id: 'only-one', items: [] }, 'one.yaml'],
    );
    const two = registry([DEFAULT, 'default.yaml']);
    const fromOne = shippedObjectContext(one).store;
    const built = new ObjectStore(two, fromOne);
    expect(built.registry).toBe(two);
    expect(built.has('check-set', 'default')).toBe(true);
    expect(built.has('check-set', 'only-one')).toBe(false);
  });
});

describe('the entry of a shipped object is read under its own kind and path', () => {
  it('reports the path of the registry that holds the object, when two registries share the raw object', () => {
    const raw = { kind: 'check-set', id: 'shared', items: [ITEM] };
    const one = registry([raw, 'one/shared.yaml']);
    const two = registry([raw, 'two/shared.yaml']);
    const path = (shipped: ObjectRegistry) =>
      shippedObjectContext(shipped)
        .store.list('check-set')
        .find((row) => row.id === 'shared')?.path;
    // Both registries hold the same kind definition object, so only the path tells the entries apart.
    expect(path(one)).toBe('one/shared.yaml');
    expect(path(two)).toBe('two/shared.yaml');
  });

  it('reads an object again under a kind that changed, and refuses what the new kind refuses', () => {
    const raw = { kind: 'check-set', id: 'tagged', note: 'free text', items: [ITEM] };
    const shipped = new ObjectRegistry();
    shipped.registerImpl('builtin:keep', { params: ANY });
    const empty = shipped.snapshot();
    shipped.registerKind({
      kind: 'check-set',
      summary: 'Checks.',
      agentFacing: false,
      fields: { note: z.string() },
    } as never);
    shipped.registerShipped(raw, 'tagged.yaml');
    expect(shippedObjectContext(shipped).store.has('check-set', 'tagged')).toBe(true);

    // The kind is registered again without the `note` field: the same raw object must now be refused, not served
    // from the entry read under the old kind.
    shipped.restore(empty);
    shipped.registerKind({ kind: 'check-set', summary: 'Checks.', agentFacing: false } as never);
    shipped.registerShipped(raw, 'tagged.yaml');
    expect(() => shippedObjectContext(shipped)).toThrow(/note|OBJECT_INVALID|accepts no such key/);
  });
});

describe('the kept store follows the registry', () => {
  it('shows a shipped object registered after a context was built, to the next context and not the earlier', () => {
    const shipped = registry([DEFAULT, 'default.yaml']);
    const early = shippedObjectContext(shipped).store;
    shipped.registerShipped({ kind: 'check-set', id: 'late', items: [ITEM] }, 'late.yaml');
    expect(shippedObjectContext(shipped).store.has('check-set', 'late')).toBe(true);
    expect(early.has('check-set', 'late')).toBe(false);
  });

  it('forgets a registration a restore undoes, with nothing registered after it', () => {
    const shipped = registry([DEFAULT, 'default.yaml']);
    const before = shipped.snapshot();
    shipped.registerShipped({ kind: 'check-set', id: 'late', items: [ITEM] }, 'late.yaml');
    expect(shippedObjectContext(shipped).store.has('check-set', 'late')).toBe(true);
    shipped.restore(before);
    expect(shippedObjectContext(shipped).store.has('check-set', 'late')).toBe(false);
    expect(shippedObjectContext(shipped).store.has('check-set', 'default')).toBe(true);
  });

  it('forgets a restored registration, and does not serve a resolution checked under the forgotten one', () => {
    const shipped = new ObjectRegistry();
    shipped.registerKind({ kind: 'check-set', summary: 'Checks.', agentFacing: false });
    const empty = shipped.snapshot();
    const tuned = {
      kind: 'check-set',
      id: 'tuned',
      items: [{ ...ITEM, impl: 'plugin:tune', params: { level: 1 } }],
    };

    // The implementation takes any level.
    shipped.registerImpl('plugin:tune', { params: z.object({ level: z.number() }) });
    shipped.registerShipped(tuned, 'tuned.yaml');
    expect(shippedObjectContext(shipped).store.resolve('check-set', 'tuned').items).toHaveLength(1);

    // After a restore it comes back accepting no level at all: the same object must now be refused.
    shipped.restore(empty);
    shipped.registerImpl('plugin:tune', { params: z.object({}).strict() });
    shipped.registerShipped(tuned, 'tuned.yaml');
    expect(() => shippedObjectContext(shipped).store.resolve('check-set', 'tuned')).toThrow(/params/);
  });
});

describe('a failure is never kept', () => {
  it('builds the shipped store again once the kind a refused object needs is registered', () => {
    const shipped = new ObjectRegistry();
    shipped.registerShipped({ kind: 'check-set', id: 'early', items: [] }, 'early.yaml');
    expect(() => shippedObjectContext(shipped)).toThrow(/unknown object kind|OBJECT_KIND_UNKNOWN/);
    shipped.registerKind(KIND);
    expect(shippedObjectContext(shipped).store.has('check-set', 'early')).toBe(true);
  });

  it('resolves an object whose implementation is registered after the first refused resolve', () => {
    const shipped = new ObjectRegistry();
    shipped.registerKind(KIND);
    shipped.registerShipped(
      { kind: 'check-set', id: 'waiting', items: [{ ...ITEM, impl: 'plugin:later' }] },
      'waiting.yaml',
    );
    expect(() => shippedObjectContext(shipped).store.resolve('check-set', 'waiting')).toThrow(/plugin:later/);
    shipped.registerImpl('plugin:later', { params: ANY });
    expect(shippedObjectContext(shipped).store.resolve('check-set', 'waiting').items).toHaveLength(1);
  });
});
