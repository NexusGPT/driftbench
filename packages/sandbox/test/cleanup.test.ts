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
