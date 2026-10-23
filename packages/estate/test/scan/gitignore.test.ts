import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { GitIgnore, parseGitignore } from '../../src/scan/gitignore';
import { estate } from '../support';

const skill =
  '---\nname: dock-roster\ndescription: Plan the dock roster.\n---\n\nAlways keep the roster in whole shifts.\n';

async function matcher(files: Record<string, string>, folders: string[] = ['']) {
  const root = await estate(files);
  const git = new GitIgnore(root);
  for (const folder of folders) await git.enter(folder);
  return git;
}

describe('a .gitignore is read as git reads it', () => {
  it('skips blank lines and comments, trims spaces and keeps escapes', () => {
    const rules = parseGitignore('# note\n\n  \nlogs/  \n\\#kept\n\\!bang\n!back.md\n');
    expect(rules.map((rule) => [rule.pattern, rule.negated, rule.folderOnly])).toEqual([
      ['logs/', false, true],
      ['\\#kept', false, false],
      ['\\!bang', false, false],
      ['!back.md', true, false],
    ]);
  });

  it('matches a glob at any depth unless it holds a slash, and a folder rule only a folder', async () => {
    const git = await matcher({ '.gitignore': '*.tmp\n/top.md\nbuild/\ndocs/*.draft\nout/**\n' });
    expect(git.match('a/b/x.tmp', false)).toBe('.gitignore: *.tmp');
    expect(git.match('top.md', false)).toBe('.gitignore: /top.md');
    expect(git.match('a/top.md', false)).toBeUndefined();
    expect(git.match('a/build', true)).toBe('.gitignore: build/');
    expect(git.match('a/build', false)).toBeUndefined();
    expect(git.match('docs/n.draft', false)).toBe('.gitignore: docs/*.draft');
    expect(git.match('docs/sub/n.draft', false)).toBeUndefined();
    expect(git.match('out/a/b.md', false)).toBe('.gitignore: out/**');
    expect(git.match('out', true)).toBeUndefined();
  });

  it('lets a later line bring a file back and a deeper file override a higher one', async () => {
    const git = await matcher(
      {
        '.gitignore': '*.md\n!keep.md\n',
        'sub/.gitignore': '!hidden.md\nnotes.txt\n',
      },
      ['', 'sub'],
    );
    expect(git.match('a.md', false)).toBe('.gitignore: *.md');
    expect(git.match('keep.md', false)).toBeUndefined();
    expect(git.match('sub/hidden.md', false)).toBeUndefined();
    expect(git.match('sub/notes.txt', false)).toBe('sub/.gitignore: notes.txt');
    expect(git.match('notes.txt', false)).toBeUndefined();
  });

  it('counts the folders above a path, and never hides the local files the runtime loads', async () => {
    const git = await matcher({ '.gitignore': 'scratch/\n.claude/settings.local.json\nCLAUDE.local.md\n' });
    expect(await git.matchPath('scratch/a/b.md')).toBe('.gitignore: scratch/');
    expect(await git.matchPath('notes/b.md')).toBeUndefined();
    expect(git.match('.claude/settings.local.json', false)).toBeUndefined();
    expect(git.match('pkg/CLAUDE.local.md', false)).toBeUndefined();
  });

  it('reads a character class and an escaped star', async () => {
    const git = await matcher({ '.gitignore': 'run-[0-9].log\nstar\\*.md\n' });
    expect(git.match('run-4.log', false)).toBe('.gitignore: run-[0-9].log');
    expect(git.match('run-x.log', false)).toBeUndefined();
    expect(git.match('star*.md', false)).toBe('.gitignore: star\\*.md');
    expect(git.match('starry.md', false)).toBeUndefined();
  });
});

describe('the reader honours the .gitignore of the estate', () => {
  it('leaves out a git-ignored file, counts it under its line, and keeps the files the runtime loads', async () => {
    const root = await estate({
      '.gitignore':
        '.claude/skills/dock-roster/references/local-notes.md\n.claude/settings.local.json\nCLAUDE.local.md\n',
      'CLAUDE.md': '# Rules\n',
      'CLAUDE.local.md': '# Local\n',
      '.claude/settings.json': '{}\n',
      '.claude/settings.local.json': '{}\n',
      '.claude/skills/dock-roster/SKILL.md': skill,
      '.claude/skills/dock-roster/references/guide.md': '# Guide\n',
      '.claude/skills/dock-roster/references/local-notes.md': '# Local notes\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    const paths = raw.files.map((file) => file.path);
    expect(paths).not.toContain('.claude/skills/dock-roster/references/local-notes.md');
    expect(paths).toEqual(
      expect.arrayContaining([
        'CLAUDE.local.md',
        '.claude/settings.local.json',
        '.claude/skills/dock-roster/references/guide.md',
      ]),
    );
    expect(raw.ignored?.paths).toEqual(['.claude/skills/dock-roster/references/local-notes.md']);
    expect(raw.ignored?.patterns.filter((entry) => entry.files > 0)).toEqual([
      { pattern: '.gitignore: .claude/skills/dock-roster/references/local-notes.md', files: 1 },
    ]);
  });

  it('leaves out a git-ignored file a document names, and a folder of ignored files whole', async () => {
    const root = await estate({
      '.gitignore': 'scratch/\n',
      'CLAUDE.md': '# Rules\n\nRead `scratch/plan.md` first.\n',
      'scratch/plan.md': '# Plan\n',
      '.claude/skills/dock-roster/SKILL.md': skill,
      '.claude/skills/dock-roster/scratch/draft.md': '# Draft\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    const paths = raw.files.map((file) => file.path);
    expect(paths).not.toContain('scratch/plan.md');
    expect(paths).not.toContain('.claude/skills/dock-roster/scratch/draft.md');
    expect(raw.ignored?.paths.sort()).toEqual([
      '.claude/skills/dock-roster/scratch/draft.md',
      'scratch/plan.md',
    ]);
  });

  it('skips a .claude folder nested in a skill or hook folder, and the test caches', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/dock-roster/SKILL.md': skill,
      '.claude/skills/dock-roster/.claude/agent-memory-local/notes.md': '# Memory\n',
      '.claude/skills/.claude/agent-memory-local/notes.md': '# Memory\n',
      '.claude/hooks/lib/.claude/agent-memory-local/notes.md': '# Memory\n',
      '.claude/hooks/.pytest_cache/README.md': '# Cache\n',
      '.claude/skills/dock-roster/.mypy_cache/meta.json': '{}\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md', '.claude/skills/dock-roster/SKILL.md']);
  });
});
