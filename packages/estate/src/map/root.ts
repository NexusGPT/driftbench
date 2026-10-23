import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { EstateMap } from '../schema';

/**
 * Where the estate of a map lies. A map records its root relative to the folder of the map file, so a map
 * moved away from its estate names a folder that is not there. The result carries the structured facts a
 * caller prints: the folder looked at, the root as recorded, and a fix.
 */
export type MapRoot =
  | { ok: true; root: string }
  | { ok: false; root: string; recorded: string; fix: string };

/** Resolves the root of a map from the folder of its file, and finds out whether that folder is there. */
export async function resolveMapRoot(mapFile: string, map: Pick<EstateMap, 'root'>): Promise<MapRoot> {
  const root = resolve(dirname(mapFile), map.root);
  if ((await stat(root).catch(() => undefined))?.isDirectory() === true) return { ok: true, root };
  return {
    ok: false,
    root,
    recorded: map.root,
    fix: 'Scan the estate again from the folder where the map will live, or set root: in the map to the estate folder, written relative to the map file.',
  };
}
