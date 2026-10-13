import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoadEstateMapOptions } from '@agent-nexus/driftbench-estate';

/**
 * Where the estate commands keep their JSON copies of parsed maps (see `loadEstateMap`): the folder named by
 * DRIFTBENCH_MAP_CACHE, else `driftbench/map-cache` under the system's temporary folder. `off` turns the
 * cache off. A copy is keyed by the SHA-256 of the map's text, so an edited map is parsed again.
 */
export function mapCacheOptions(env: Record<string, string | undefined> = process.env): LoadEstateMapOptions {
  const chosen = env.DRIFTBENCH_MAP_CACHE;
  if (chosen === 'off') return {};
  return {
    cacheDir: chosen !== undefined && chosen !== '' ? chosen : join(tmpdir(), 'driftbench', 'map-cache'),
  };
}
