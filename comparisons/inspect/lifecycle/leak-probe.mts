import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'leak-parent-'));
const SANDBOX = new URL('../../../packages/sandbox/src/index.ts', import.meta.url).pathname;
const child = `
import { localProvider } from '${SANDBOX}';
const box = await localProvider({ dir: '${dir}' }).create();
await box.exec('echo hi');
process.exit(0); // exits without destroy, as an interrupted run would
`;
const file = join(dir, 'child.mts');
await import('node:fs/promises').then((fs) => fs.writeFile(file, child));
execFileSync('npx', ['tsx', file], {
  cwd: new URL('../../../', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const left = (await readdir(dir)).filter((n) => n !== 'child.mts');
console.log(JSON.stringify({ leftAfterUncleanExit: left.length }));
