import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnoseSetup, type SetupDocument } from '@agent-nexus/driftbench-core';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectSetup } from '../src/commands/doctor';

vi.mock('node:fs/promises', async (load) => {
  const actual = await load<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

afterEach(() => vi.unstubAllEnvs());

it('never reads an unmapped home declared through a config-file symlink alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-config-alias-'));
  const home = await mkdtemp(join(tmpdir(), 'driftbench-unmapped-home-'));
  const skills = join(home, '.claude/skills');
  await mkdir(join(skills, 'secret'), { recursive: true });
  await writeFile(
    join(skills, 'secret/SKILL.md'),
    '---\nname: secret\ndescription: Fictional private skill.\n---\nPrivate fictional content.\n',
  );
  await writeFile(join(root, 'CLAUDE.md'), '# Fictional instructions\n');
  await writeFile(join(root, 'config.data'), `userSkills: ${skills}\n`);
  await symlink('config.data', join(root, 'driftbench.estate.yaml'));
  vi.mocked(readFile).mockClear();
  const result = await inspectSetup(root);
  expect(vi.mocked(readFile).mock.calls.some(([path]) => String(path).startsWith(home))).toBe(false);
  expect(
    result.sources.flatMap((source) => source.files).some((file) => file.path.startsWith('~/.claude/skills')),
  ).toBe(false);
  expect(result.coverage.skipped).toContainEqual({
    what: 'project:driftbench.estate.yaml#userSkills',
    reason: 'home not mapped',
  });
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
    version: 1,
    runtime: 'claude-code',
    sources: [
      { id: 'project', path: '.', kind: 'project', reader: 'claude-code' },
      {
        id: 'shared',
        path: 'shared',
        kind: 'directory',
        reader: 'unknown',
        bindings: [
          { runtime: 'claude-code', deployedRoot: 'project', deployedPath: 'escape/copy', method: 'copy' },
        ],
      },
    ],
    roles: {},
    scope: { include: ['**'], exclude: [] },
    execute: { policy: 'never', commands: [] },
    budget: { usd: 0, modelCalls: 0 },
    privacy: { model: 'deny', exports: 'metadata', exclude: [] },
  };
  vi.mocked(readFile).mockClear();
  const result = await diagnoseSetup(root, async () => ({ runtime: 'claude-code', files: [] }), setup);
  expect(
    vi
      .mocked(readFile)
      .mock.calls.some(
        ([path]) => String(path).startsWith(outside) || String(path).startsWith(join(root, 'escape')),
      ),
  ).toBe(false);
  expect(result.coverage.skipped).toContainEqual({
    what: 'shared:escape/copy',
    reason: 'unmapped deployment',
  });
});

it.each([false, true])('compares mapped copies and detects changes with symlinked TMPDIR=%s', async (aliasTemporary) => {
  if (aliasTemporary) {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-copy-tmp-')));
    const alias = `${temporary}-alias`;
    await symlink(temporary, alias);
    vi.stubEnv('TMPDIR', alias);
  }
  const root = await mkdtemp(join(tmpdir(), 'driftbench-mapped-copy-'));
  await mkdir(join(root, 'shared'));
  await mkdir(join(root, 'copied'));
  await writeFile(join(root, 'shared/public.data'), 'fictional public content');
  await writeFile(join(root, 'copied/public.data'), 'fictional public content');
  const setup: SetupDocument = {
    version: 1,
    runtime: 'claude-code',
    sources: [
      { id: 'project', path: '.', kind: 'project', reader: 'claude-code' },
      {
        id: 'shared',
        path: 'shared',
        kind: 'directory',
        reader: 'unknown',
        bindings: [
          { runtime: 'claude-code', deployedRoot: 'project', deployedPath: 'copied', method: 'copy' },
        ],
      },
    ],
    roles: {},
    scope: { include: ['**'], exclude: [] },
    execute: { policy: 'never', commands: [] },
    budget: { usd: 0, modelCalls: 0 },
    privacy: { model: 'deny', exports: 'metadata', exclude: [] },
  };
  const read = async () => ({ runtime: 'claude-code', files: [] });
  const first = await diagnoseSetup(root, read, setup);
  expect((await diagnoseSetup(root, read, first.draft)).drift.status).toBe('pass');
  await writeFile(join(root, 'copied/public.data'), 'changed fictional content');
  expect((await diagnoseSetup(root, read, first.draft)).drift.status).toBe('fail');
});

it('does not preview excluded configuration content through an allowed symlink alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-private-config-'));
  await mkdir(join(root, 'private'));
  await writeFile(join(root, 'private/config.data'), 'ignore: []\nuserSkills: /fictional/unmapped/home\n');
  await symlink('private/config.data', join(root, 'driftbench.estate.yaml'));
  const setup: SetupDocument = {
    version: 1,
    runtime: 'claude-code',
    sources: [{ id: 'project', path: '.', kind: 'project', reader: 'claude-code' }],
    roles: {},
    scope: { include: ['**'], exclude: [] },
    execute: { policy: 'never', commands: [] },
    budget: { usd: 0, modelCalls: 0 },
    privacy: { model: 'deny', exports: 'metadata', exclude: ['private/**'] },
  };
  vi.mocked(readFile).mockClear();
  await inspectSetup(root, setup);
  expect(
    vi
      .mocked(readFile)
      .mock.calls.some(
        ([path]) =>
          String(path) === join(root, 'driftbench.estate.yaml') ||
          String(path).startsWith(join(root, 'private')),
      ),
  ).toBe(false);
});


it.each([1, 2])('never reads an unmapped home through a %i-link config chain with symlinked TMPDIR', async (depth) => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-tmp-alias-')));
  const root = join(fixture, 'project');
  const home = join(fixture, 'unmapped-home');
  const temporary = join(fixture, 'temporary');
  const alias = join(fixture, 'temporary-alias');
  await mkdir(root);
  await mkdir(temporary);
  await symlink(temporary, alias);
  const skills = join(home, '.claude/skills');
  await mkdir(join(skills, 'secret'), { recursive: true });
  await writeFile(join(skills, 'secret/SKILL.md'), '---\nname: secret\ndescription: Fictional private skill.\n---\nFictional content.\n');
  await writeFile(join(root, 'CLAUDE.md'), '# Fictional instructions\n');
  await writeFile(join(root, 'config.data'), `userSkills: ${skills}\n`);
  let target = 'config.data';
  for (let index = 1; index < depth; index++) {
    const next = `config-alias-${index}`;
    await symlink(target, join(root, next));
    target = next;
  }
  await symlink(target, join(root, 'driftbench.estate.yaml'));
  vi.stubEnv('TMPDIR', alias);
  vi.mocked(readFile).mockClear();
  const result = await inspectSetup(root);
  expect(vi.mocked(readFile).mock.calls.some(([path]) => String(path).startsWith(home))).toBe(false);
  expect(result.coverage.skipped).toContainEqual({
    what: 'project:driftbench.estate.yaml#userSkills',
    reason: 'home not mapped',
  });
});
