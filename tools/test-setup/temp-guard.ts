import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VARIABLES = ['TMPDIR', 'TMP', 'TEMP'] as const;

/**
 * Vitest globalSetup: every test file, worker and child process of this run gets a private temp
 * folder, and the run fails when anything is left in it. Each test removes what it makes.
 * The leftovers are removed before the failure is raised, so a red run adds nothing to the disk.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const parent = tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'driftbench-vitest-run-'));
  const before = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]));
  for (const name of VARIABLES) process.env[name] = root;
  return async () => {
    for (const name of VARIABLES) {
      const value = before[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const left = await readdir(root);
    await rm(root, { recursive: true, force: true });
    if (left.length > 0) {
      // mkdtemp adds six random characters; group by the name before them.
      const counts = new Map<string, number>();
      for (const name of left) {
        const prefix = name.replace(/[A-Za-z0-9]{6}$/, '');
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      }
      const shown = [...counts].map(([prefix, count]) => `${prefix}* x${count}`).join(', ');
      throw new Error(
        `The test run left ${left.length} entries in its temp folder: ${shown}. ` +
          'Remove what a test makes in afterEach/afterAll, or in a finally block.',
      );
    }
  };
}
