import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

it.each([0, 1, 2, 3])('Northwind rehearsal propagates campaign exit %i', async (code) => {
  const path = fileURLToPath(new URL('../../../.github/workflows/northwind-campaign.yml', import.meta.url));
  const workflow = parse(await readFile(path, 'utf8'));
  const step = workflow.jobs.rehearsal.steps.find((entry: { name?: string }) => entry.name === 'Run the campaign on the stand-in runtime');
  const dir = await mkdtemp(join(tmpdir(), 'northwind-workflow-'));
  try {
    await writeFile(join(dir, 'pnpm'), '#!/bin/sh\nexit "$PNPM_STUB_EXIT"\n');
    await chmod(join(dir, 'pnpm'), 0o755);
    const result = spawnSync('bash', ['-c', step.run], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, OUT: dir, CONFIG: 'fictional.yaml', GITHUB_RUN_ID: 'fictional', PNPM_STUB_EXIT: String(code) },
      encoding: 'utf8',
    });
    expect(result.status, result.stdout + result.stderr).toBe(code);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
