import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'built-faults-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeAll(() => {
  for (const name of readdirSync(join(ROOT, 'packages')).sort()) {
    const folder = join(ROOT, 'packages', name);
    const command = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).scripts?.build;
    if (typeof command !== 'string' || !command.startsWith('tsup ')) continue;
    const words = command.split(' ').filter((word) => word !== '--dts' && word !== '--clean');
    const built = spawnSync('pnpm', ['exec', ...words, '--silent'], { cwd: folder, encoding: 'utf8' });
    if (built.status !== 0) throw new Error(`building ${name}: ${built.stdout} ${built.stderr}`);
  }
}, 600_000);

it('plain Node can load a TypeScript fault set with extensionless sibling imports', () => {
  writeFileSync(join(dir, 'helper.ts'), `export const id: string = 'fixture';`);
  writeFileSync(
    join(dir, 'index.ts'),
    `import { id } from './helper';
export const faults = [{ id, kind: 'control', class: 'X1_local', target: 'function:fixture',
affects: [], description: 'Fictional control', agent: { kind: 'function', create: () => ({ respond: () => ({ text: 'hello' }) }) } }];`,
  );
  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, 'packages/cli/dist/bin.js'),
      'ci',
      '--specs',
      join(ROOT, 'examples/acme/specs/conversations/plan-upgrade.yaml'),
      '--target',
      'fault:fixture',
      '--faults',
      dir,
      '--baseline',
      'missing',
      '--store',
      join(dir, 'missing.db'),
    ],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } },
  );
  expect(result.status).toBe(2);
  expect(result.stderr).not.toContain('Cannot load the fault set');
  expect(result.stderr).toContain('store');
}, 120_000);

it('plain Node loads the shipped Acme fault set', () => {
  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, 'packages/cli/dist/bin.js'),
      'ci',
      '--specs',
      join(ROOT, 'examples/acme/specs/conversations/plan-upgrade.yaml'),
      '--target',
      'fault:x1-invents-price',
      '--faults',
      join(ROOT, 'examples/acme/faults'),
      '--baseline',
      'missing',
      '--store',
      join(dir, 'missing.db'),
    ],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } },
  );
  expect(result.status).toBe(2);
  expect(result.stderr).not.toContain('Cannot load the fault set');
  expect(result.stderr).toContain('store');
}, 120_000);
