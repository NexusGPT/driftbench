import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { VariablesImpl } from './interface';

/** An environment variable that names another module exporting `variablesImpl`, to plant a mutant. */
export const IMPL_ENV = 'DRIFTBENCH_VARIABLES_IMPL';

/**
 * The module the implementation is loaded from: the one the variable names, else the adapter beside this file. A
 * built package holds no adapter source beside it: there the adapter of the checkout under `root` is the one.
 */
export function implModulePath(root?: string): string {
  const named = process.env[IMPL_ENV];
  if (named) return named;
  if (import.meta.url.endsWith('.ts') || root === undefined)
    return fileURLToPath(new URL('./adapter.ts', import.meta.url));
  return join(root, 'packages', 'validators', 'src', 'ladders', 'variables', 'adapter.ts');
}

/** Loads the implementation. A module may export `variablesImpl`, a default export, or the three functions. */
export async function loadImpl(
  path: string = implModulePath(),
): Promise<{ impl: Partial<VariablesImpl>; module: string }> {
  const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const impl = (mod.variablesImpl ?? mod.default ?? mod) as Partial<VariablesImpl>;
  return { impl, module: path };
}
