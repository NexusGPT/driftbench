import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localProvider } from '../../../packages/sandbox/src/index';

const dir = await mkdtemp(join(tmpdir(), 'probe-'));
const box = await localProvider({ dir }).create();
const record = await box.exec('python3 -c "import sys; sys.stdout.write(\'x\'*20000000)"', {
  timeoutMs: 120000,
});
console.log(
  JSON.stringify({
    exitCode: record.exitCode,
    stdoutBytes: Buffer.byteLength(record.stdout ?? ''),
    truncated: record.truncated ?? false,
  }),
);
await box.destroy();
