import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { diagnoseSetup } from '../../src/setup/doctor';
import type { SetupDocument } from '../../src/setup/schema';

it('supplies all filtered snapshot roots; cross-source links never resolve to original content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-setup-boundary-'));
  await mkdir(join(root, 'shared'));
  await mkdir(join(root, '.claude'));
  await writeFile(join(root, 'shared/public.txt'), 'fictional');
  await writeFile(join(root, 'shared/secret.txt'), 'private fictional text');
  await symlink('../shared', join(root, '.claude/shared'));
  const setup: SetupDocument = {
    version: 1,
    runtime: 'claude-code',
    sources: [
      { id: 'project', path: '.', kind: 'project', reader: 'claude-code' },
      { id: 'shared', path: 'shared', kind: 'directory', reader: 'agents-folder' },
    ],
    roles: {},
    scope: { include: ['**'], exclude: [] },
    execute: { policy: 'never', commands: [] },
    budget: { usd: 0, modelCalls: 0 },
    privacy: { model: 'deny', exports: 'metadata', exclude: ['**/secret.txt'] },
  };
  const visited: string[] = [];
  await diagnoseSetup(
    root,
    async (_id, snapshot, source, roots) => {
      visited.push(source.id);
      expect(Object.keys(roots).sort()).toEqual(['project', 'shared']);
      expect(snapshot).not.toBe(source.root);
      expect(await realpath(join(roots.project!, '.claude/shared'))).toBe(await realpath(roots.shared!));
      expect(await readFile(join(roots.shared!, 'public.txt'), 'utf8')).toBe('fictional');
      await expect(readFile(join(roots.shared!, 'secret.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      return { runtime: 'claude-code', files: [] };
    },
    setup,
  );
  expect(visited).toEqual(['project', 'shared']);
});

it('applies host privacy to a deployment alias as well as to its canonical source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-setup-alias-'));
  await mkdir(join(root, 'shared'));
  await mkdir(join(root, '.claude'));
  await writeFile(join(root, 'shared/secret.txt'), 'fictional secret');
  await symlink('../shared', join(root, '.claude/shared'));
  const setup: SetupDocument = {
    version: 1,
    runtime: 'claude-code',
    sources: [
      { id: 'project', path: '.', kind: 'project', reader: 'claude-code' },
      { id: 'shared', path: 'shared', kind: 'directory', reader: 'agents-folder' },
    ],
    roles: {},
    scope: { include: ['**'], exclude: [] },
    execute: { policy: 'never', commands: [] },
    budget: { usd: 0, modelCalls: 0 },
    privacy: { model: 'deny', exports: 'metadata', exclude: ['.claude/shared/secret.txt'] },
  };
  await diagnoseSetup(
    root,
    async (_id, _snapshot, _source, roots) => {
      await expect(readFile(join(roots.project!, '.claude/shared/secret.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readFile(join(roots.shared!, 'secret.txt'), 'utf8')).toBe('fictional secret');
      return { runtime: 'claude-code', files: [] };
    },
    setup,
  );
});

it('reports an empty drift baseline against an empty source as not-run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-empty-drift-'));
  const setup: SetupDocument = {
    version: 1,
    runtime: 'claude-code',
    sources: [{ id: 'project', path: '.', kind: 'project', reader: 'claude-code' }],
    roles: {},
    scope: { include: ['**'], exclude: [] },
    execute: { policy: 'never', commands: [] },
    budget: { usd: 0, modelCalls: 0 },
    privacy: { model: 'deny', exports: 'metadata', exclude: [] },
    drift: { files: [] },
  };
  const result = await diagnoseSetup(root, async () => ({ runtime: 'claude-code', files: [] }), setup);
  expect(result.drift.status).toBe('not-run');
  expect(result.coverage.status).toBe('not-run');
});

it('cannot bypass project privacy by inferring a nested source root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-inferred-privacy-'));
  await mkdir(join(root, 'shared'));
  await mkdir(join(root, '.claude'));
  await writeFile(join(root, 'CLAUDE.md'), '# Fictional\n');
  await writeFile(join(root, 'shared/secret.txt'), 'fictional private text');
  await symlink('../shared', join(root, '.claude/shared'));
  const setup: SetupDocument = {
    version: 1, runtime: 'claude-code',
    sources: [{ id: 'project', path: '.', kind: 'project', reader: 'claude-code' }],
    roles: {}, scope: { include: ['**'], exclude: [] },
    execute: { policy: 'never', commands: [] }, budget: { usd: 0, modelCalls: 0 },
    privacy: { model: 'deny', exports: 'metadata', exclude: ['shared/secret.txt'] },
  };
  const result = await diagnoseSetup(root, async (_id, _snapshot, source, roots) => {
    await expect(readFile(join(roots['linked-1']!, 'secret.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    return { runtime: 'claude-code', files: source.id === 'project' ? [{ path: 'CLAUDE.md', kind: 'standing', text: '# Fictional\n' }] : [] };
  }, setup);
  expect(result.draft.drift?.files.some((file) => file.path.endsWith('secret.txt'))).toBe(false);
});
