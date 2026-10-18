import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'orphan-'));
const marker = 'sleep 61.4729';
const SANDBOX = new URL('../../../packages/sandbox/src/index.ts', import.meta.url).pathname;
const parentSrc = `import { localProvider } from '${SANDBOX}';
const box = await localProvider({ dir: '${dir}' }).create();
console.log('ready');
await box.exec('${marker}', { timeoutMs: 120000 });
`;
const file = join(dir, 'parent.mts');
await writeFile(file, parentSrc);
const child = spawn('npx', ['tsx', file], {
  cwd: new URL('../../../', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise<void>((r) => {
  child.stdout.on('data', (d) => {
    if (String(d).includes('ready')) r();
  });
});
await new Promise((r) => setTimeout(r, 2500));
child.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 1500));
let survivors = '';
try {
  survivors = execFileSync('pgrep', ['-fl', 'sleep 61.4729'], { encoding: 'utf8' });
} catch {
  survivors = '';
}
console.log(JSON.stringify({ survivingCommands: survivors.trim().split('\n').filter(Boolean).length }));
