import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Sources, VariablesImpl } from './interface';
import { labelled } from './labels';

/** An environment variable that names another module exporting `variablesImpl`, to plant a mutant. */
export const IMPL_ENV = 'DRIFTBENCH_VARIABLES_IMPL';

/** The module the implementation is loaded from: the adapter beside this file, or the one the variable names. */
export function implModulePath(): string {
  return process.env[IMPL_ENV] ?? fileURLToPath(new URL('./adapter.ts', import.meta.url));
}

/** The implementation with the recorded labels put on the spans it is given (labels.ts). */
export function withLabels(impl: Partial<VariablesImpl>): Partial<VariablesImpl> {
  const build = impl.buildStore;
  return build ? { ...impl, buildStore: (sources: Sources) => build(labelled(sources)) } : impl;
}

/**
 * Loads the implementation in this process, for tests: a module may export `variablesImpl`, a default export, or the
 * functions by name. The bank itself calls the product through the frame (bank/product.ts).
 */
export async function loadImpl(
  path: string = implModulePath(),
): Promise<{ impl: Partial<VariablesImpl>; module: string }> {
  const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const impl = (mod.variablesImpl ?? mod.default ?? mod) as Partial<VariablesImpl>;
  return { impl: withLabels(impl), module: path };
}
