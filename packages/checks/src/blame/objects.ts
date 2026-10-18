import {
  initializeShippedObjects,
  type ObjectRegistry,
  ObjectStore,
  objectRegistry,
  type ResolvedObject,
} from '@agent-nexus/driftbench-core';
import { PLACEMENT_IMPLS } from '../placement/apply';
import { BLAME_IMPLS } from './impls';
import { SHIPPED_OBJECTS } from './shipped';

export { SHIPPED_OBJECTS } from './shipped';

/**
 * Registers the blame and placement implementations and shipped objects in a registry, skipping each one it
 * already holds, so a second call, or a call after a registry restore, puts back only what is missing. The shared
 * kind vocabulary is initialised first, so a caller that never goes through the CLI's `main()` still finds its kinds.
 */
export function registerBlameObjects(registry: ObjectRegistry = objectRegistry): ObjectRegistry {
  initializeShippedObjects();
  for (const [name, impl] of Object.entries(BLAME_IMPLS)) {
    if (!registry.impl(name)) registry.registerImpl(name, { params: impl.params, summary: impl.summary });
  }
  for (const [name, impl] of Object.entries(PLACEMENT_IMPLS)) {
    if (!registry.impl(name)) registry.registerImpl(name, { params: impl.params, summary: impl.summary });
  }
  for (const key of Object.keys(SHIPPED_OBJECTS) as Array<keyof typeof SHIPPED_OBJECTS>) {
    const already = registry.shipped().some((one) => {
      const raw = one.raw as { kind?: unknown; id?: unknown } | null;
      return `${String(raw?.kind)}:${String(raw?.id)}` === key;
    });
    if (!already) registry.registerShipped(SHIPPED_OBJECTS[key], `@agent-nexus/driftbench-checks ${key}`);
  }
  return registry;
}

/** The shipped default of a kind, resolved: `policy/blame:default` or `policy/placement:default`. */
export function shippedPolicy(
  kind: 'policy/blame' | 'policy/placement',
  registry: ObjectRegistry = objectRegistry,
): ResolvedObject {
  registerBlameObjects(registry);
  return new ObjectStore(registry).resolve(kind, 'default');
}
