import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
let parent: string;
beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'cleanup-parent-'));
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

/** A child process that creates a sandbox, runs a command, then ends without destroy (by exit or by a signal). */
async function childLeaving(how: 'exit' | 'sigterm'): Promise<string[]> {
  const dir = await mkdtemp(join(parent, `${how}-`));
  const file = join(dir, 'child.mts');
  const body = `
import { localProvider } from '${SRC}';
const box = await localProvider({ dir: '${dir}' }).create();
await box.exec('echo hi');
console.log('ready');
${how === 'exit' ? 'process.exit(0);' : 'setInterval(() => {}, 1000);'}
`;
  await writeFile(file, body);
  if (how === 'exit') {
    execFileSync('npx', ['tsx', file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    await new Promise<void>((done, fail) => {
      const child = spawn('npx', ['tsx', file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk;
        if (out.includes('ready')) child.kill('SIGTERM');
      });
      child.on('close', () => done());
      child.on('error', fail);
    });
  }
  return (await readdir(dir)).filter((name) => name !== 'child.mts');
}

describe('sandbox folders are removed when the process ends without destroy', () => {
  it('a process that exits without destroy leaves no sandbox folder behind', async () => {
    expect(await childLeaving('exit')).toEqual([]);
  }, 60_000);

  it('a process terminated by SIGTERM leaves no sandbox folder behind', async () => {
    expect(await childLeaving('sigterm')).toEqual([]);
  }, 60_000);
});

describe('a command the sandbox started does not outlive its process', () => {
  it('a sandbox command still running when the process is terminated is killed with it', async () => {
    const dir = await mkdtemp(join(parent, 'cmd-'));
    const marker = 'sleep 61.4729';
    const file = join(dir, 'parent.mts');
    await writeFile(
      file,
      `import { localProvider } from '${SRC}';
const box = await localProvider({ dir: '${dir}' }).create();
console.log('ready');
await box.exec('${marker}', { timeoutMs: 120000 });
`,
    );
    const child = spawn('npx', ['tsx', file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((ready) => {
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('ready')) ready();
      });
    });
    await new Promise((wait) => setTimeout(wait, 2500));
    child.kill('SIGTERM');
    await new Promise((wait) => setTimeout(wait, 1500));
    let survivors = 0;
    try {
      survivors = execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean).length;
    } catch {
      survivors = 0;
    }
    if (survivors > 0) execFileSync('pkill', ['-f', marker]);
    expect(survivors).toBe(0);
  }, 60_000);
});
