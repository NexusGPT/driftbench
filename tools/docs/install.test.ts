import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

/** The commands of the first bash block under a heading or bold lead, from `git clone` to `driftbench --version`. */
async function installLines(page: string): Promise<string[]> {
  const text = await readFile(join(ROOT, page), 'utf8');
  const start = text.indexOf('```bash\ngit clone ');
  expect(start, `${page} shows the clone commands`).toBeGreaterThan(-1);
  const block = text.slice(start + '```bash\n'.length, text.indexOf('\n```', start));
  const lines = block.split('\n');
  return lines.slice(0, lines.indexOf('driftbench --version') + 1);
}

/** The clone and the build take minutes and need the network: they run on CI, where the checkout is a clean tree. */
const onCi = process.env.CI !== undefined && process.env.CI !== '';

describe('install from source, as the guide shows it', () => {
  it.skipIf(!onCi)(
    'runs the exact install lines of the quickstart in a fresh clone of this checkout',
    async () => {
      const lines = await installLines('docs/guide/quickstart.md');
      const work = await mkdtemp(join(tmpdir(), 'driftbench-quickstart-'));
      try {
        // The page clones the public address. The test clones this checkout instead, so it tests this commit.
        const local = `git clone ${JSON.stringify(ROOT)} driftbench`;
        const script = lines.map((line) => (line.startsWith('git clone ') ? local : line)).join('\n');
        const prefix = join(work, 'prefix');
        const done = await exec('sh', ['-ec', script], {
          cwd: work,
          timeout: 840_000,
          maxBuffer: 256 * 1024 * 1024,
          env: {
            ...process.env,
            npm_config_prefix: prefix,
            npm_config_cache: join(work, 'npm-cache'),
            PATH: `${join(prefix, 'bin')}:${process.env.PATH ?? ''}`,
          },
        });
        expect(done.stdout.trim().split('\n').pop()).toMatch(/^\d+\.\d+\.\d+/);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
    900_000,
  );

  it('shows the same install commands in the guide index and in the quickstart', async () => {
    const index = await installLines('docs/guide/index.md');
    const quickstart = await installLines('docs/guide/quickstart.md');
    expect(index).toEqual([
      'git clone https://github.com/NexusGPT/driftbench.git',
      'cd driftbench',
      'pnpm install',
      'pnpm build',
      'cd packages/cli && npm link && cd ../..',
      'driftbench --version',
    ]);
    expect(quickstart).toEqual(index);
  });

  it('links the built CLI, and the linked driftbench command prints its version', async () => {
    const cli = join(ROOT, 'packages/cli');
    if (!existsSync(join(cli, 'dist/bin.js'))) {
      await exec('pnpm', ['build'], { cwd: ROOT, timeout: 480_000, maxBuffer: 64 * 1024 * 1024 });
    }
    const prefix = await mkdtemp(join(tmpdir(), 'driftbench-link-'));
    try {
      await exec('npm', ['link'], {
        cwd: cli,
        timeout: 120_000,
        env: { ...process.env, npm_config_prefix: prefix, npm_config_cache: join(prefix, 'cache') },
      });
      const done = await exec(join(prefix, 'bin', 'driftbench'), ['--version'], { timeout: 60_000 });
      expect(done.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  }, 600_000);
});
