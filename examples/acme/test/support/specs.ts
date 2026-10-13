import { fileURLToPath } from 'node:url';
import { type LoadedSpec, loadSpecs } from '@agent-nexus/driftbench-core';

export const SPECS_DIR = fileURLToPath(new URL('../../specs', import.meta.url));
export const INVENTORY_PATH = fileURLToPath(new URL('../../inventory.yaml', import.meta.url));

/** Every Acme spec, loaded by the same loader as `driftbench spec validate`. Throws on an invalid one. */
export async function loadAcmeSpecs(): Promise<LoadedSpec[]> {
  const results = await loadSpecs([SPECS_DIR]);
  const invalid = results.filter((result) => !result.ok);
  if (invalid.length > 0) throw new Error(`invalid Acme specs: ${JSON.stringify(invalid, null, 2)}`);
  return results.filter((result): result is LoadedSpec => result.ok);
}
