import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_CODE_PROFILE } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  comparableName,
  dedupeByRealPath,
  expandVariables,
  ignoreStack,
  LEGACY_CASE_INSENSITIVE_NAMES,
  leavesRoot,
  listFolder,
  rootRelative,
  sameName,
} from '../../src/fs/estate-fs';

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'driftbench-estate-fs-'));
}

describe('EstateFS', () => {
  it('lists a folder in exact-case order and an unreadable one as empty', async () => {
    const root = await folder();
    // Names that differ by more than case, so a case-folding file system holds all three.
    for (const name of ['b.md', 'Z.md', 'a.md']) await writeFile(join(root, name), name);
    expect((await listFolder(root)).map((entry) => entry.name)).toEqual(['Z.md', 'a.md', 'b.md']);
    expect(await listFolder(join(root, 'missing'))).toEqual([]);
  });

  it('keeps one spelling per real file, and notes a link that leaves the root', async () => {
    const root = await folder();
    const outside = await folder();
    await writeFile(join(root, 'a.md'), 'a');
    await symlink(join(root, 'a.md'), join(root, 'alias.md'));
    await writeFile(join(outside, 'x.md'), 'x');
    await symlink(join(outside, 'x.md'), join(root, 'out.md'));
    expect(await dedupeByRealPath(root, ['a.md', 'alias.md', 'gone.md'])).toEqual(['a.md', 'gone.md']);
    expect(await leavesRoot(root, 'out.md')).toBe(true);
    expect(await leavesRoot(root, 'alias.md')).toBe(false);
  });

  it('stacks ignore files, the profile globs and the configured globs, in that order', async () => {
    const root = await folder();
    await writeFile(join(root, '.agentignore'), '# comment\nbuild\n!keep\n');
    const stack = await ignoreStack(root, { ...CLAUDE_CODE_PROFILE, ignoreFiles: ['.agentignore'] }, [
      'drafts',
    ]);
    expect(stack.rules[0]?.pattern).toBe('build');
    expect(stack.rules.at(-1)?.pattern).toBe('drafts');
    expect(stack.match('build/out.md')?.pattern).toBe('build');
    expect(stack.match('node_modules/x.js')?.pattern).toBe('node_modules');
    expect(stack.match('notes.md')).toBeUndefined();
    // The claude-code profile honours no ignore file: its stack is its own globs, then the configuration's.
    const plain = await ignoreStack(root, CLAUDE_CODE_PROFILE, []);
    expect(plain.rules.map((rule) => rule.pattern)).toEqual([...CLAUDE_CODE_PROFILE.ignore]);
  });

  it('expands the profile variables, mapping home to --home', () => {
    const folders = { root: '/estate', home: '/fake-home' };
    expect(expandVariables('$CLAUDE_PROJECT_DIR/.claude/x.py', CLAUDE_CODE_PROFILE, folders)).toBe(
      '.claude/x.py',
    );
    expect(expandVariables('${CLAUDE_PLUGIN_ROOT}/y.sh', CLAUDE_CODE_PROFILE, folders)).toBe('y.sh');
    expect(expandVariables('$HOME/.claude/skills', CLAUDE_CODE_PROFILE, folders)).toBe(
      '/fake-home/.claude/skills',
    );
    expect(expandVariables('~/notes.md', CLAUDE_CODE_PROFILE, folders)).toBe('/fake-home/notes.md');
    expect(expandVariables('docs/a.md', CLAUDE_CODE_PROFILE, folders)).toBe('docs/a.md');
  });

  it('stores paths relative to the root, and none for a path outside it', () => {
    expect(rootRelative('/estate', '/estate/.claude/a.md')).toBe('.claude/a.md');
    expect(rootRelative('/estate', 'b/../c.md')).toBe('c.md');
    expect(rootRelative('/estate', '/elsewhere/a.md')).toBeUndefined();
  });

  it('folds name case behind one named option, which is on as the readers always were', () => {
    expect(LEGACY_CASE_INSENSITIVE_NAMES).toBe(true);
    expect(sameName('Trash', 'trash')).toBe(true);
    expect(sameName('Trash', 'trash', false)).toBe(false);
    expect(comparableName('Guard.PY', false)).toBe('Guard.PY');
  });
});
