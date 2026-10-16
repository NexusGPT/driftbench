import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
