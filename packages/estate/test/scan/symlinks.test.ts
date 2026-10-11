import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate, FIXTURE } from '../support';

/** A link at `path` (relative to the root) pointing at `target`, as written in the link. */
async function link(root: string, path: string, target: string): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true });
  await symlink(target, join(root, path));
}

describe('the reader follows symbolic links', () => {
  it('walks a linked folder and a linked file under the link path, with the kind the path gives', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      'shared/skills/claims/SKILL.md': '---\nname: claims\ndescription: File a claim.\n---\n\n# Claims\n',
      'shared/skills/claims/scripts/file.sh': '#!/bin/sh\nexit 0\n',
      'shared/notes.md': '# Notes\n\nKeep claims short.\n',
    });
    await link(root, '.claude/skills/claims', '../../shared/skills/claims');
    await link(root, '.claude/memory/notes.md', '../../shared/notes.md');
    const raw = await new ClaudeCodeReader().read(root);
    const kinds = Object.fromEntries(raw.files.map((file) => [file.path, file.kind]));
    expect(kinds).toEqual({
      'CLAUDE.md': 'standing',
      '.claude/memory/notes.md': 'memory',
      '.claude/skills/claims/SKILL.md': 'skill',
      '.claude/skills/claims/scripts/file.sh': 'skill_file',
    });
    expect(raw.skills.map((skill) => skill.name)).toEqual(['claims']);
    expect(raw.files.find((file) => file.path === '.claude/memory/notes.md')?.text).toContain('Keep claims');
    expect(raw.notes).toEqual([]);
  });

  it('skips a link back to a folder it is inside, and a link to nothing, each with a note', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/claims/SKILL.md': '---\nname: claims\n---\n\n# Claims\n',
    });
    await link(root, '.claude/skills/claims/loop', '..');
    await link(root, '.claude/skills/claims/self', '.');
    await link(root, '.claude/skills/claims/gone.md', 'missing.md');
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md', '.claude/skills/claims/SKILL.md']);
    expect(raw.notes).toEqual([
      { file: '.claude/skills/claims/gone.md', message: 'skipped: a link that points at nothing' },
      {
        file: '.claude/skills/claims/loop',
        message: 'skipped: a link back to a folder the walk is already inside',
      },
      {
        file: '.claude/skills/claims/self',
        message: 'skipped: a link back to a folder the walk is already inside',
      },
    ]);
  });

  it('reads the fixture skill whose scripts folder and one reference are links', async () => {
    const raw = await new ClaudeCodeReader().read(FIXTURE);
    const linked = raw.files.filter((file) => file.owner === 'parcel-claims').map((file) => file.path);
    expect(linked).toEqual([
      '.claude/skills/parcel-claims/SKILL.md',
      '.claude/skills/parcel-claims/references/supplier-languages.md',
      '.claude/skills/parcel-claims/scripts/check-carrier.sh',
      '.claude/skills/parcel-claims/scripts/track.sh',
    ]);
    expect(raw.notes.filter((note) => note.message.includes('link'))).toEqual([]);
  });
});
