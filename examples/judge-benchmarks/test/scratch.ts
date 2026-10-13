import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Keep fixtures in the worktree, outside the executor's denied host temporary folders. */
export async function scratch(prefix: string): Promise<string> {
  const root = resolve('.cache/rb/test-scratch');
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, prefix));
}
