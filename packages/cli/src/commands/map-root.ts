import type { MapRoot } from '@agent-nexus/driftbench-estate';
import { show } from '../files';
import type { Io } from '../io';

/** The error for a map whose estate folder is not there: the folder looked at, the root as recorded, a fix. */
export function rootRefusal(mapFile: string, found: Extract<MapRoot, { ok: false }>, io: Io): string {
  return `Cannot find the estate folder ${show(found.root, io)} that ${show(mapFile, io)} names (root: ${found.recorded}).\nFix: ${found.fix}\n`;
}
