// A 150 MB stream written into a FIFO in the workspace, read through our local sandbox (bound 100 MiB).
// Ours refuses a file that is not a regular file, and never reads more than one byte past the bound.
// Run: npx tsx comparisons/inspect/sandbox/read-bound-stream-ours.mts
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localProvider } from '../../../packages/sandbox/src/index';

const box = await localProvider({ dir: await mkdtemp(join(tmpdir(), 'fifo-ours-')) }).create();
const fifo = join(box.root, 'stream.bin');
execFileSync('mkfifo', [fifo]);
const writer = spawn('sh', ['-c', `head -c 157286400 /dev/zero > '${fifo}'`], { stdio: 'ignore' });
const start = Date.now();
try {
  const data = await box.readFile('stream.bin');
  console.log(`ours readFile returned ${data.length} bytes in ${((Date.now() - start) / 1000).toFixed(1)}s`);
} catch (error) {
  console.log(
    `ours readFile raised ${(error as Error).name} after ${((Date.now() - start) / 1000).toFixed(1)}s: ${(error as Error).message.slice(0, 100)}`,
  );
}
writer.kill();
await box.destroy();
