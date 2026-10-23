import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnoseSetup, type SetupDocument } from '@agent-nexus/driftbench-core';
import { expect, it, vi } from 'vitest';
import { inspectSetup } from '../src/commands/doctor';

vi.mock('node:fs/promises', async (load) => {
  const actual = await load<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

it('never reads an unmapped home declared through a config-file symlink alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-config-alias-'));
  const home = await mkdtemp(join(tmpdir(), 'driftbench-unmapped-home-'));
  const skills = join(home, '.claude/skills');
  await mkdir(join(skills, 'secret'), { recursive: true });
  await writeFile(join(skills, 'secret/SKILL.md'), '---\nname: secret\ndescription: Fictional private skill.\n---\nPrivate fictional content.\n');
  await writeFile(join(root, 'CLAUDE.md'), '# Fictional instructions\n');
  await writeFile(join(root, 'config.data'), `userSkills: ${skills}\n`);
  await symlink('config.data', join(root, 'driftbench.estate.yaml'));
  vi.mocked(readFile).mockClear();
  const result = await inspectSetup(root);
  expect(vi.mocked(readFile).mock.calls.some(([path]) => String(path).startsWith(home))).toBe(false);
  expect(result.sources.flatMap((source) => source.files).some((file) => file.path.startsWith('~/.claude/skills'))).toBe(false);
  expect(result.coverage.skipped).toContainEqual({ what: 'project:driftbench.estate.yaml#userSkills', reason: 'home not mapped' });
});

it('never inventories a copy destination that escapes its declared root through a parent symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-copy-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'driftbench-copy-unmapped-'));
  await mkdir(join(root, 'shared'));
  await writeFile(join(root, 'shared/public.data'), 'fictional public content');
  await mkdir(join(outside, 'copy'));
  await writeFile(join(outside, 'copy/private.data'), 'fictional private content');
  await symlink(outside, join(root, 'escape'));
  const setup: SetupDocument = {
    version: 1, runtime: 'claude-code',
    sources: [
      { id: 'project', path: '.', kind: 'project', reader: 'claude-code' },
      { id: 'shared', path: 'shared', kind: 'directory', reader: 'unknown', bindings: [
        { runtime: 'claude-code', deployedRoot: 'project', deployedPath: 'escape/copy', method: 'copy' },
      ] },
    ],
    roles: {}, scope: { include: ['**'], exclude: [] },
    execute: { policy: 'never', commands: [] }, budget: { usd: 0, modelCalls: 0 },
    privacy: { model: 'deny', exports: 'metadata', exclude: [] },
  };
  vi.mocked(readFile).mockClear();
  const result = await diagnoseSetup(root, async () => ({ runtime: 'claude-code', files: [] }), setup);
  expect(vi.mocked(readFile).mock.calls.some(([path]) => String(path).startsWith(outside) || String(path).startsWith(join(root, 'escape')))).toBe(false);
  expect(result.coverage.skipped).toContainEqual({ what: 'shared:escape/copy', reason: 'unmapped deployment' });
});
