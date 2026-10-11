import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The repository root above a folder: the nearest folder holding pnpm-workspace.yaml, else the folder itself. */
export function findRoot(start: string): string {
  let folder = resolve(start);
  for (;;) {
    if (existsSync(join(folder, 'pnpm-workspace.yaml'))) return folder;
    const parent = dirname(folder);
    if (parent === folder) return resolve(start);
    folder = parent;
  }
}
