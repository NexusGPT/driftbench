import { join } from 'node:path';
import { type EstateMap, loadEstateMap, mapHash } from '../../src/index';
import { FIXTURE } from '../support';

/** The fixture's approved map, as committed. */
export async function approvedFixture(): Promise<EstateMap> {
  const loaded = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.map;
}

/** A copy of a map with some atoms and edges changed, its hash recomputed. */
export function edited(map: EstateMap, change: (copy: EstateMap) => void): EstateMap {
  const copy = structuredClone(map);
  change(copy);
  copy.hash = mapHash(copy.atoms, copy.edges);
  return copy;
}
