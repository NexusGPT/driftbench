import { parseTypes, type TypesDocument, type TypesOptions } from '@agent-nexus/driftbench-core';

function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

/** Resolve only a reader's own built-ins with the common loader. User extensions are resolved by the CLI. */
export function readerSetupTypes(runtime: string, document: TypesDocument): TypesOptions {
  const options: TypesOptions = {
    runtime,
    roots: { source: '.' },
    shapes: [],
    folder: '.',
    source: `reader:${runtime}`,
  };
  const builtins = parseTypes(document, options);
  if (!builtins.ok) throw new Error(`invalid ${runtime} built-ins: ${JSON.stringify(builtins.errors)}`);
  return immutable({ ...options, base: builtins.set });
}
