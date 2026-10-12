// Reads a host file, a path outside the workspace and a workspace file through our local sandbox.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localProvider } from '../../../packages/sandbox/src/index';

const box = await localProvider({ dir: await mkdtemp(join(tmpdir(), 'read-probe-')) }).create();
for (const path of ['/etc/hosts', '../secret-outside.txt', 'notes.txt']) {
  try {
    const data = await box.readFile(path);
    console.log(path.padEnd(22), 'read', data.length, 'bytes');
  } catch (e) {
    console.log(path.padEnd(22), 'error', (e as Error).name);
  }
}
await box.destroy();
