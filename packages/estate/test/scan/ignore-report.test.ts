import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Plan the ${name} chores.\n---\n\nAlways keep the totals in whole cents.\n`;
const TAG = 'Signature: 8a477f597d28d172789f06886806bc55\n# A cache.\n';

describe('the scan counts every file kept out under what kept it out', () => {
  it('counts a glob, an ignore-file line and a cache tag apart, each by the files it hid', async () => {
    const root = await estate({
      '.gitignore': 'scratch/\n*.tmp\n',
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/gantry/SKILL.md': skill('gantry'),
      '.claude/skills/gantry/scratch/a.md': '# A\n',
      '.claude/skills/gantry/scratch/b.md': '# B\n',
      '.claude/skills/gantry/draft.tmp': 'x\n',
      '.claude/skills/gantry/.windlass-cache/CACHEDIR.TAG': TAG,
      '.claude/skills/gantry/.windlass-cache/notes.md': '# N\n',
      '.claude/skills/gantry/debug.log': 'x\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    const counted = Object.fromEntries(
      (raw.ignored?.patterns ?? [])
        .filter((entry) => entry.files > 0)
        .map((entry) => [entry.pattern, entry.files]),
    );
    expect(counted).toEqual({
      '*.log': 1,
      '.gitignore: scratch/': 2,
      '.gitignore: *.tmp': 1,
      'CACHEDIR.TAG': 2,
    });
    expect([...(raw.ignored?.paths ?? [])].sort()).toEqual([
      '.claude/skills/gantry/.windlass-cache/CACHEDIR.TAG',
      '.claude/skills/gantry/.windlass-cache/notes.md',
      '.claude/skills/gantry/debug.log',
      '.claude/skills/gantry/draft.tmp',
      '.claude/skills/gantry/scratch/a.md',
      '.claude/skills/gantry/scratch/b.md',
    ]);
  });

  it('counts a file a document names under what kept it out', async () => {
    const root = await estate({
      '.gitignore': 'quarrycache/\n',
      'CLAUDE.md': '# Rules\n\nRead `quarrycache/notes.md` first.\n',
      'quarrycache/notes.md': '# Notes\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.ignored?.patterns.find((entry) => entry.pattern === '.gitignore: quarrycache/')?.files).toBe(
      1,
    );
    expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md']);
  });
});

describe('a second source is a tree of its own', () => {
  it('applies the ignore files inside it, and not those of the estate', async () => {
    const root = await estate({
      '.gitignore': 'estate-only.md\n',
      'CLAUDE.md': '# Rules\n',
      'team/.gitignore': 'draft.md\n',
      'team/gantry-kit/SKILL.md': skill('gantry-kit'),
      'team/gantry-kit/references/draft.md': '# Draft\n',
      'team/gantry-kit/references/estate-only.md': '# Kept\n',
      'team/gantry-kit/references/guide.md': '# Guide\n',
    });
    await mkdir(join(root, 'elsewhere'), { recursive: true });
    await writeFile(join(root, 'elsewhere', 'marker'), '');
    const raw = await new ClaudeCodeReader({ userSkills: join(root, 'team') }).read(root);
    const read = raw.files
      .filter((file) => file.layer === 'user')
      .map((file) => file.path.split('/').slice(-2).join('/'));
    expect(read.sort()).toEqual(['gantry-kit/SKILL.md', 'references/estate-only.md', 'references/guide.md']);
  });
});
