import { readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeReader, copyEstate, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: Review fictional parcels.\n---\n${body}\n`;

describe('user skill layer', () => {
  it('reads both layers, uses project precedence by name, and resolves nested user references', async () => {
    const root = await estate({ '.claude/skills/local/SKILL.md': skill('review', 'Project version.') });
    const user = await estate({
      'renamed/SKILL.md': skill('review', 'Shadowed user version.'),
      'renamed/obsolete.md': 'Do not include this shadowed file.',
      'parcels/SKILL.md': skill('parcels', 'Read `references/notes.md`.'),
      'parcels/references/notes.md': 'Read `more.txt`.',
      'parcels/references/more.txt': 'Always show the fictional parcel number.',
    });
    const reader = new ClaudeCodeReader({ userSkills: user });
    const result = await scanEstate({ root, reader, now: NOW });
    expect(result.raw.skills.map((s) => s.name)).toEqual(['review', 'parcels']);
    expect(result.raw.files.some((f) => f.path.includes('/renamed/'))).toBe(false);
    expect(result.raw.prose.some((p) => p.file.endsWith('more.txt'))).toBe(true);
    const refs = result.map.atoms.filter((a) => a.kind === 'reference');
    expect(refs).toHaveLength(2);
    expect(refs.every((a) => a.fields?.exists === true)).toBe(true);
    expect(lintEstate(result.map, await reader.read(root)).counts.QUOTE_DRIFT).toBe(0);
    const destination = await estate({});
    await copyEstate(root, destination, result.map);
    expect(await readFile(join(destination, '.claude/skills/parcels/references/more.txt'), 'utf8')).toBe(
      'Always show the fictional parcel number.',
    );
  });

  it('defaults off in tests and can be explicitly disabled even when an environment folder is set', async () => {
    const root = await estate({ 'CLAUDE.md': '# Fictional estate' });
    const reader = new ClaudeCodeReader();
    expect((await reader.read(root)).userSkills).toBe(false);
    expect((await new ClaudeCodeReader({ userSkills: false }).read(root)).skills).toEqual([]);
  });

  it('gives the project folder priority when declared names differ', async () => {
    const root = await estate({ '.claude/skills/review/SKILL.md': skill('project-review', '') });
    const user = await estate({ 'review/SKILL.md': skill('user-review', '') });
    const raw = await new ClaudeCodeReader({ userSkills: user }).read(root);
    expect(raw.skills.map((s) => s.name)).toEqual(['project-review']);
  });
});

describe('user-layer source identity and assets', () => {
  it('scans and copies the same selected user asset when the project has no skill definition', async () => {
    const root = await estate({ '.claude/skills/parcels/notes.md': '# Loose project file' });
    const user = await estate({
      'parcels/SKILL.md': skill('parcels', 'Read `notes.md`.'),
      'parcels/notes.md': '# Selected user notes',
    });
    const reader = new ClaudeCodeReader({ userSkills: user });
    const result = await scanEstate({ root, reader, now: NOW });
    const path = '.claude/skills/parcels/notes.md';
    const scanned = result.raw.files.find((file) => file.path === path);
    expect(scanned?.text).toBe('# Selected user notes');
    const destination = await estate({});
    await copyEstate(root, destination, result.map);
    expect(await readFile(join(destination, path), 'utf8')).toBe(scanned?.text);
  });

  it('does not cross-match a project declared name with a different user folder name', async () => {
    const root = await estate({ '.claude/skills/local/SKILL.md': skill('review', '') });
    const user = await estate({ 'review/SKILL.md': skill('parcels', '') });
    const raw = await new ClaudeCodeReader({ userSkills: user }).read(root);
    expect(raw.skills.map((s) => s.name)).toEqual(['review', 'parcels']);
  });

  it('copies oversized user assets from the user folder into their effective skill folder', async () => {
    const data = 'x'.repeat(2 * 1024 * 1024);
    const root = await estate({ 'CLAUDE.md': '# Fictional estate' });
    const user = await estate({ 'parcels/SKILL.md': skill('parcels', ''), 'parcels/data.txt': data });
    const reader = new ClaudeCodeReader({ userSkills: user });
    const result = await scanEstate({ root, reader, now: NOW });
    const path = '.claude/skills/parcels/data.txt';
    expect(await reader.listFiles(root)).toContain(path);
    expect((await reader.fileSources(root)).get(path)).toBe(join(user, 'parcels/data.txt'));
    const destination = await estate({});
    await copyEstate(root, destination, result.map);
    expect(await readFile(join(destination, path), 'utf8')).toBe(data);
  });

  it('resolves an explicit absolute user source to its selected logical file', async () => {
    const user = await estate({
      'parcels/SKILL.md': skill('parcels', ''),
      'parcels/notes.md': '# User notes',
    });
    const path = join(user, 'parcels/notes.md');
    const root = await estate({ 'CLAUDE.md': `Read [the user notes](${path}).` });
    const result = await scanEstate({ root, reader: new ClaudeCodeReader({ userSkills: user }), now: NOW });
    const ref = result.map.atoms.find((a) => a.kind === 'reference' && a.provenance.file === 'CLAUDE.md');
    expect(ref?.fields?.path).toBe('.claude/skills/parcels/notes.md');
    expect(ref?.fields?.external).not.toBe(true);
    expect(ref?.fields?.readPaths).toContain(path);
    const evidence = ref?.evidence.find((e) => e.type === 'tool_called');
    if (evidence?.type !== 'tool_called') throw new Error('missing read evidence');
    const assertion = evidence.input?.file_path as { regex: string };
    const reads = new RegExp(assertion.regex);
    expect(reads.test(path)).toBe(true);
    expect(reads.test('/run/.claude/skills/parcels/notes.md')).toBe(true);
    expect(reads.test(`${path}.other`)).toBe(false);
  });

  it('reads an explicitly cited shadowed user guide and its relative chain without activating the user skill', async () => {
    const user = await estate({
      'review/SKILL.md': skill('review', 'User version.'),
      'review/notes.md': 'Read [more](more.txt).',
      'review/more.txt': 'User-only detail.',
      'review/unused.md': 'Unreferenced shadowed file.',
    });
    const path = join(user, 'review/notes.md');
    const root = await estate({
      'CLAUDE.md': `Read [the user guide](${path}).`,
      '.claude/skills/review/SKILL.md': skill('review', 'Project version.'),
      '.claude/skills/review/notes.md': '# Project notes',
      '.claude/skills/review/more.txt': 'Project-only detail.',
    });
    const reader = new ClaudeCodeReader({ userSkills: user });
    const result = await scanEstate({ root, reader, now: NOW });
    expect(result.raw.skills).toHaveLength(1);
    expect(
      result.raw.files.find((f) => f.path.endsWith('/more.txt') && f.text === 'User-only detail.'),
    ).toBeDefined();
    expect(
      result.raw.files.some((f) => f.path.includes('/user-skills/') && f.path.endsWith('/unused.md')),
    ).toBe(false);
    const outer = result.map.atoms.find((a) => a.kind === 'reference' && a.provenance.file === 'CLAUDE.md');
    expect(outer?.fields?.path).toBe('.claude/user-skills/review/notes.md');
    const nested = result.map.atoms.find(
      (a) => a.kind === 'reference' && a.provenance.file === outer?.fields?.path,
    );
    expect(nested?.fields?.path).toBe('.claude/user-skills/review/more.txt');
    const destination = await estate({});
    await copyEstate(root, destination, result.map);
    expect(await readFile(join(destination, '.claude/user-skills/review/more.txt'), 'utf8')).toBe(
      'User-only detail.',
    );
    expect(await readFile(join(destination, '.claude/skills/review/more.txt'), 'utf8')).toBe(
      'Project-only detail.',
    );
  });

  it('expands home paths against HOME, not a configured alternate user directory', async () => {
    const home = await estate({
      '.claude/skills/parcels/SKILL.md': skill('parcels', ''),
      '.claude/skills/parcels/notes.md': '# Home notes',
    });
    const root = await estate({ 'CLAUDE.md': 'Read [home notes](~/.claude/skills/parcels/notes.md).' });
    vi.stubEnv('HOME', home);
    try {
      const result = await scanEstate({
        root,
        reader: new ClaudeCodeReader({ userSkills: join(home, '.claude/skills') }),
        now: NOW,
      });
      const ref = result.map.atoms.find((a) => a.kind === 'reference');
      expect(ref?.fields?.path).toBe('.claude/skills/parcels/notes.md');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('user skill containers and canonical identity', () => {
  it('reads deep container skills, collapses project and user folder aliases, and excludes trash', async () => {
    const root = await estate({
      '.claude/skills/project-a/SKILL.md': skill('project-a', 'Read [notes](notes.md).'),
      '.claude/skills/project-a/notes.md': '# Project notes',
      '.claude/skills/project-b/SKILL.md': skill('project-b', ''),
    });
    const user = await estate({
      'ordinary/SKILL.md': skill('ordinary', ''),
      'catalog/team/deep/SKILL.md': skill('deep-user', 'Read [notes](references/notes.md).'),
      'catalog/team/deep/references/notes.md': 'Read [more](more.txt).',
      'catalog/team/deep/references/more.txt': '# Deep notes',
      'synced/group/remote/SKILL.md': skill('remote-user', ''),
      '.trash/retired/SKILL.md': skill('retired', 'Never use the retired material.'),
    });
    await symlink(join(root, '.claude/skills/project-a'), join(user, 'project-a-alias'));
    await symlink(join(root, '.claude/skills/project-b'), join(user, 'project-b-alias'));
    await symlink(join(user, 'ordinary'), join(user, 'ordinary-alias'));
    await symlink(join(user, '.trash'), join(user, 'trash-alias'));
    await symlink(join(user, '.trash/retired/SKILL.md'), join(user, 'retired-note.md'));
    const reader = new ClaudeCodeReader({ userSkills: user });
    const result = await scanEstate({ root, reader, now: NOW });
    expect(result.raw.skills.map((s) => s.name).sort()).toEqual([
      'deep-user',
      'ordinary',
      'project-a',
      'project-b',
      'remote-user',
    ]);
    expect(result.raw.notes.filter((n) => n.message.includes('duplicate skill name'))).toEqual([]);
    expect(result.raw.files.some((f) => f.path.includes('.trash') || f.path.includes('trash-alias'))).toBe(
      false,
    );
    expect(result.raw.files.some((f) => f.path.endsWith('/retired-note.md'))).toBe(false);
    expect(result.raw.files.some((f) => f.path.includes('project-a-alias'))).toBe(false);
    expect(result.raw.skills.filter((s) => s.name === 'ordinary')).toHaveLength(1);
    expect(result.raw.files.find((f) => f.path.endsWith('/deep/references/notes.md'))?.owner).toBe(
      'deep-user',
    );
    const refs = result.map.atoms.filter((a) => a.kind === 'reference');
    expect(refs.every((r) => r.fields?.exists === true)).toBe(true);
    const destination = await estate({});
    await copyEstate(root, destination, result.map);
    expect(
      await readFile(join(destination, '.claude/skills/catalog/team/deep/references/more.txt'), 'utf8'),
    ).toBe('# Deep notes');
  });

  it('binds explicit citations through a project symlink alias to the existing project file', async () => {
    const root = await estate({
      '.claude/skills/review/SKILL.md': skill('review', ''),
      '.claude/skills/review/notes.md': 'Read [more](more.txt).',
      '.claude/skills/review/more.txt': '# One physical guide',
    });
    const user = await estate({});
    await symlink(join(root, '.claude/skills/review'), join(user, 'review-link'));
    const standing = `Read [user alias](${join(user, 'review-link/notes.md')}).`;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, 'CLAUDE.md'), standing);
    const result = await scanEstate({ root, reader: new ClaudeCodeReader({ userSkills: user }), now: NOW });
    expect(result.raw.skills).toHaveLength(1);
    expect(result.raw.files.filter((f) => f.text === '# One physical guide')).toHaveLength(1);
    const ref = result.map.atoms.find((a) => a.kind === 'reference' && a.provenance.file === 'CLAUDE.md');
    expect(ref?.fields?.path).toBe('.claude/skills/review/notes.md');
    expect(ref?.fields?.readPaths).toContain(join(user, 'review-link/notes.md'));
  });
});
