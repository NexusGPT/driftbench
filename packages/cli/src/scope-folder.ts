import { spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A campaign's scope folder is `<prefix><owner pid>-<random>`, so a later run can tell whose it was. */
export const SCOPE_PREFIX = 'driftbench-sandboxes-';

/**
 * Waits for the owner process to end, then removes the folder. It stops by itself once the folder is
 * gone, so a campaign that closes its scope normally leaves nothing running. A kill the owner cannot
 * catch (SIGKILL) is the case it exists for.
 */
const WATCHER = `
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const [pid, prefix] = process.argv.slice(1);
const folder = mkdtempSync(prefix);
// The owner may die before it reads the folder. Keep watching even if its pipe is gone.
process.stdout.on('error', () => {});
process.stdout.end(folder);
const alive = () => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const tick = () => {
  if (!existsSync(folder)) return process.exit(0);
  if (alive()) return setTimeout(tick, 200);
  rmSync(folder, { recursive: true, force: true });
  process.exit(0);
};
tick();
`;

/** True while a process with this pid exists. A pid this user may not signal still exists. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Removes the scope folders whose owner process is gone. Best effort: a folder that stays is tried again next run. */
export async function sweepDeadScopes(parent: string = tmpdir()): Promise<void> {
  let names: string[];
  try {
    names = await readdir(parent);
  } catch {
    return;
  }
  for (const name of names) {
    const owner = new RegExp(`^${SCOPE_PREFIX}(\\d+)-`).exec(name)?.[1];
    if (owner === undefined || pidAlive(Number(owner))) continue;
    await rm(join(parent, name), { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * The watcher creates the folder, then reports its path. Creating it in the owner first leaves a gap
 * where an interrupt can kill the owner before the watcher starts, stranding an empty folder.
 */
export async function makeScopeFolder(): Promise<string> {
  await sweepDeadScopes();
  const prefix = join(tmpdir(), `${SCOPE_PREFIX}${process.pid}-`);
  const child = spawn(process.execPath, ['-e', WATCHER, String(process.pid), prefix], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  child.unref();
  return new Promise((resolve, reject) => {
    let folder = '';
    child.once('error', reject);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text: string) => {
      folder += text;
    });
    child.stdout.once('error', reject);
    child.stdout.once('end', () => {
      if (folder.startsWith(prefix)) resolve(folder);
      else reject(new Error('Cannot start the campaign sandbox cleanup watcher.'));
    });
  });
}
