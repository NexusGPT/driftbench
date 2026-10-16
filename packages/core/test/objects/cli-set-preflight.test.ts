import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  BUILTIN_KINDS,
  checkSpecObjects,
  ObjectRegistry,
  ObjectStore,
  parseCliOverrides,
  resolveBlockObjects,
  shippedObjectContext,
} from '../../src/objects';
import { parseSpecText } from '../../src/spec/load';

it('refuses --set diagnostic/missing#rule.limit=2 before the diagnostic branch can skip it', () => {
  const context = {
    ...shippedObjectContext(),
    cli: parseCliOverrides([], ['diagnostic/missing#rule.limit=2']),
  };
  expect(() => resolveBlockObjects({ blocks: [{ when: { user: 'hello' } }] }, 0, context)).toThrow(
    /unknown object diagnostic:missing; searched layers shipped, project, suite, spec, block, cli/,
  );
});

it('validates an item on a known but unselected --set object', () => {
  const context = shippedObjectContext();
  context.store.add({ kind: 'diagnostic', id: 'known', steps: [] }, 'project', { path: 'fixture' });
  context.cli = parseCliOverrides([], ['diagnostic/known#rule.limit=2']);
  expect(() => resolveBlockObjects({ blocks: [{ when: { user: 'hello' } }] }, 0, context)).toThrow(
    /no item of diagnostic:known/,
  );
});

function defaultContext(flag: string) {
  const registry = new ObjectRegistry();
  for (const kind of BUILTIN_KINDS) registry.registerKind(kind);
  registry.registerImpl('builtin:test/rule', { params: z.strictObject({ limit: z.number() }) });
  registry.registerShipped(
    {
      kind: 'check-set',
      id: 'default',
      items: [{ id: 'rule', title: 'Rule', impl: 'builtin:test/rule', params: { limit: 1 } }],
    },
    'fixture',
  );
  return { ...shippedObjectContext(registry), cli: parseCliOverrides([], [flag], registry) };
}

it('accepts --set check-set#rule.limit=2 against a shipped default without uses', () => {
  const context = defaultContext('check-set#rule.limit=2');
  const loaded = parseSpecText('id: default-set\nblocks:\n  - when: {user: hello}', 'yaml');
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const spec = loaded.spec;
  expect(
    resolveBlockObjects(spec, 0, context).find(({ object }) => object.kind === 'check-set')?.object.items[0]
      ?.params,
  ).toEqual({ limit: 2 });
  expect(checkSpecObjects(spec, context)).toEqual([]);
});

it('still validates an implicit default item during the explicit preflight', () => {
  const context = defaultContext('check-set#missing.limit=2');
  const loaded = parseSpecText('id: default-set\nblocks:\n  - when: {user: hello}', 'yaml');
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const spec = loaded.spec;
  expect(checkSpecObjects(spec, context)).toEqual([expect.objectContaining({ code: 'OBJECT_ITEM_UNKNOWN' })]);
});

it('accepts a kind-only diagnostic override on a shipped default before loading', () => {
  const registry = new ObjectRegistry();
  for (const kind of BUILTIN_KINDS) registry.registerKind(kind);
  registry.registerImpl('builtin:test/diagnostic', {
    kinds: ['diagnostic'],
    params: z.strictObject({ limit: z.number() }),
  });
  registry.registerShipped(
    {
      kind: 'diagnostic',
      id: 'default',
      default: true,
      steps: [{ id: 'rule', title: 'Rule', impl: 'builtin:test/diagnostic', params: { limit: 1 } }],
    },
    'fixture',
  );
  const context = {
    ...shippedObjectContext(registry),
    cli: parseCliOverrides([], ['diagnostic#rule.limit=2'], registry),
  };
  const spec = {
    id: 'diagnostic-default',
    kind: 'conversation' as const,
    blocks: [{ when: { user: 'hello' } }],
  };
  expect(resolveBlockObjects(spec, 0, context)[0]?.object.items[0]?.params).toEqual({ limit: 2 });
  expect(checkSpecObjects(spec, context)).toEqual([]);
});

function rangeContext(flags: string[]) {
  const registry = new ObjectRegistry();
  for (const kind of BUILTIN_KINDS) registry.registerKind(kind);
  registry.registerImpl('builtin:test/range', {
    params: z.strictObject({ lo: z.number(), hi: z.number() }).refine((p) => p.lo <= p.hi, {
      message: 'lo must not exceed hi',
    }),
  });
  registry.registerShipped(
    {
      kind: 'check-set',
      id: 'default',
      items: [{ id: 'range', title: 'Range', impl: 'builtin:test/range', params: { lo: 1, hi: 3 } }],
    },
    'range',
  );
  return {
    store: new ObjectStore(registry),
    uses: [],
    problems: [],
    cli: parseCliOverrides([], flags, registry),
  };
}
const oneBlock = { blocks: [{ when: { user: 'hello' } }] };

it.each([
  ['kind-only', ['check-set#range.lo=5', 'check-set#range.hi=8']],
  ['named', ['check-set/default#range.lo=5', 'check-set/default#range.hi=8']],
  ['named, in the other order', ['check-set/default#range.hi=8', 'check-set/default#range.lo=5']],
])('combines every --set flag of an object before validating its params (%s)', (_, flags) => {
  const params = resolveBlockObjects(oneBlock, 0, rangeContext(flags))[0]?.object.items[0]?.params;
  expect(params).toEqual({ lo: 5, hi: 8 });
});

it.each([
  ['kind-only', ['check-set#range.lo=9', 'check-set#range.hi=8']],
  ['named', ['check-set/default#range.lo=9', 'check-set/default#range.hi=8']],
])('still refuses a final combination that breaks the schema (%s)', (_, flags) => {
  expect(() => resolveBlockObjects(oneBlock, 0, rangeContext(flags))).toThrow(/lo must not exceed hi/);
});
