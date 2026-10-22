import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

describe('install from source, as the guide index shows it', () => {
  it('links the built CLI, and the linked driftbench command prints its version', async () => {
    const cli = join(ROOT, 'packages/cli');
    if (!existsSync(join(cli, 'dist/bin.js'))) {
      await exec('pnpm', ['build'], { cwd: ROOT, timeout: 480_000, maxBuffer: 64 * 1024 * 1024 });
    }
    const prefix = await mkdtemp(join(tmpdir(), 'driftbench-link-'));
    try {
      await exec('npm', ['link', '--prefix', prefix, '--cache', join(prefix, 'cache')], {
        cwd: cli,
        timeout: 120_000,
      });
      const done = await exec(join(prefix, 'bin', 'driftbench'), ['--version'], { timeout: 60_000 });
      expect(done.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  }, 600_000);
});
