import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Metadata rather than content: rewriting an identical file still opens a window where readers can
 * load truncated JavaScript. ctime also catches a writer that restores mtime. Directory metadata
 * catches files created and removed during the run. No watcher events or polling can be missed.
 */
export function sharedDistSnapshot(root) {
  const snapshot = new Map();
  const visit = (path) => {
    const stat = lstatSync(path, { bigint: true });
    snapshot.set(
      relative(root, path),
      [stat.ino, stat.size, stat.mode, stat.mtimeNs, stat.ctimeNs].join(':'),
    );
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
  };
  for (const group of ['packages', 'examples']) {
    const folder = join(root, group);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).sort()) {
      const dist = join(folder, name, 'dist');
      if (existsSync(dist)) visit(dist);
    }
  }
  return snapshot;
}

export function changedSharedDist(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}
