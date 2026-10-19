import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// The folders this test file made. Vitest loads this module once per test file,
// so the list, and the removal after the file's last test, belong to that file.
const made: string[] = [];

afterAll(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A new folder under the temp folder, removed after the last test of the file that asked for it. */
export async function tempFolder(prefix: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  made.push(folder);
  return folder;
}

/** The synchronous form of tempFolder. */
export function tempFolderSync(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  made.push(folder);
  return folder;
}
