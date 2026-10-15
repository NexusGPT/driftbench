import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type ObjectRegistry,
  ObjectStore,
  objectRegistry,
  parseObjectText,
  type ResolvedObject,
} from '@agent-nexus/driftbench-core';
import { PLACEMENT_IMPLS } from '../placement/apply';
import { BLAME_IMPLS } from './impls';
import { BLOCK_STEPS, CAMPAIGN_STEPS } from './steps';

/**
 * The shipped blame and placement objects: data files under `packages/checks/objects/`, registered with the
 * object registry with their implementations, so a project object can extend them (`extends: default`) and a
 * spec can name them in `uses`. A shipped object is immutable: a user writes one that extends it.
 */

/** The shipped object files of this package, by kind and id, relative to its `objects/` folder. */
export const SHIPPED_OBJECT_FILES = {
  'policy/blame:default': 'policy/blame/default.yaml',
  'policy/placement:default': 'policy/placement/default.yaml',
} as const;

/** The shipped diagnostics, registered once the diagnostic kind declares their fields (the F5 runner). */
export const SHIPPED_DIAGNOSTIC_FILES = {
  'diagnostic:code-agent-liability': 'diagnostic/code-agent-liability.yaml',
  'diagnostic:fix-plan': 'diagnostic/fix-plan.yaml',
  'diagnostic:liability-confirm': 'diagnostic/liability-confirm.yaml',
  'diagnostic:value-mismatch': 'diagnostic/value-mismatch.yaml',
  'diagnostic:flaky-block': 'diagnostic/flaky-block.yaml',
} as const;

/** The top-level fields a diagnostic file holds beside its steps (codeagent_equivalence_blame.md G5). */
export const DIAGNOSTIC_FIELDS = ['scope', 'when', 'reads', 'output', 'cost'] as const;

/** The package's `objects/` folder: beside `src/` in a checkout, beside `dist/` once built. */
export function objectsDir(): string {
  for (const up of ['../../objects/', '../objects/']) {
    const path = fileURLToPath(new URL(up, import.meta.url));
    if (existsSync(path)) return path;
  }
  throw new Error('the shipped objects folder of @agent-nexus/driftbench-checks is missing');
}

/** The text of a shipped object file. */
export function shippedObjectText(
  key: keyof typeof SHIPPED_OBJECT_FILES | keyof typeof SHIPPED_DIAGNOSTIC_FILES,
): { text: string; path: string } {
  const relative =
    key in SHIPPED_OBJECT_FILES
      ? SHIPPED_OBJECT_FILES[key as keyof typeof SHIPPED_OBJECT_FILES]
      : SHIPPED_DIAGNOSTIC_FILES[key as keyof typeof SHIPPED_DIAGNOSTIC_FILES];
  const path = `${objectsDir()}${relative}`;
  return { text: readFileSync(path, 'utf8'), path };
}

function registerFile(registry: ObjectRegistry, key: string, text: string, path: string): void {
  const already = registry.shipped().some((one) => {
    const raw = one.raw as { kind?: unknown; id?: unknown } | null;
    return `${String(raw?.kind)}:${String(raw?.id)}` === key;
  });
  if (!already) registry.registerShipped(parseObjectText(text, path).raw, path);
}

/** Whether the registry's diagnostic kind declares the fields the shipped diagnostics hold. */
export function diagnosticKindReady(registry: ObjectRegistry = objectRegistry): boolean {
  const fields = registry.kind('diagnostic')?.fields ?? {};
  return DIAGNOSTIC_FIELDS.every((name) => name in fields);
}

const registered = new WeakSet<ObjectRegistry>();

/** Registers the blame and placement implementations and shipped objects once per registry. */
export function registerBlameObjects(registry: ObjectRegistry = objectRegistry): ObjectRegistry {
  if (registered.has(registry)) return registry;
  for (const [name, impl] of Object.entries(BLAME_IMPLS)) {
    if (!registry.impl(name)) registry.registerImpl(name, { params: impl.params, summary: impl.summary });
  }
  for (const [name, impl] of Object.entries(PLACEMENT_IMPLS)) {
    if (!registry.impl(name)) registry.registerImpl(name, { params: impl.params, summary: impl.summary });
  }
  for (const [name, step] of [...Object.entries(BLOCK_STEPS), ...Object.entries(CAMPAIGN_STEPS)]) {
    if (!registry.impl(name)) registry.registerImpl(name, { params: step.params, summary: step.summary });
  }
  for (const key of Object.keys(SHIPPED_OBJECT_FILES) as Array<keyof typeof SHIPPED_OBJECT_FILES>) {
    const { text, path } = shippedObjectText(key);
    registerFile(registry, key, text, path);
  }
  // A diagnostic file holds scope, when, reads, output and cost beside its steps; the kind must accept them
  // before a store can hold the file, so the files join once the diagnostics runner declares those fields.
  if (diagnosticKindReady(registry)) {
    for (const key of Object.keys(SHIPPED_DIAGNOSTIC_FILES) as Array<keyof typeof SHIPPED_DIAGNOSTIC_FILES>) {
      const { text, path } = shippedObjectText(key);
      registerFile(registry, key, text, path);
    }
  }
  registered.add(registry);
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
