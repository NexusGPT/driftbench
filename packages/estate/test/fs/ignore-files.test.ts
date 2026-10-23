import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IgnoreFiles, parseIgnoreFile } from '../../src/fs/ignore-files';

const made: string[] = [];
afterEach(async () => {
  while (made.length > 0) await rm(made.pop() ?? '', { recursive: true, force: true });
});

async function entered(
  files: Record<string, string>,
  folders: string[] = [''],
  exempt?: (path: string) => boolean,
) {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-ignore-'));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const ignore = new IgnoreFiles(root, ['.ignore-list'], exempt);
  for (const folder of folders) await ignore.enter(folder);
  return ignore;
}

describe('an ignore file is read as such a file is read', () => {
  it('skips blank lines and comments, trims spaces and keeps escapes', () => {
    const lines = parseIgnoreFile('# note\n\n  \nlogs/  \n\\#kept\n\\!bang\n!back.md\n');
    expect(lines.map((line) => [line.text, line.negated, line.foldersOnly])).toEqual([
      ['logs/', false, true],
      ['\\#kept', false, false],
      ['\\!bang', false, false],
      ['!back.md', true, false],
    ]);
  });

  it('matches a glob at any depth unless it holds a slash, and a folder rule only a folder', async () => {
    const ignore = await entered({ '.ignore-list': '*.tmp\n/top.md\nbuild/\ndocs/*.draft\nout/**\n' });
    expect(ignore.match('a/b/x.tmp', false)?.line).toBe('*.tmp');
    expect(ignore.match('top.md', false)?.line).toBe('/top.md');
    expect(ignore.match('a/top.md', false)).toBeUndefined();
    expect(ignore.match('a/build', true)?.line).toBe('build/');
    expect(ignore.match('a/build', false)).toBeUndefined();
    expect(ignore.match('docs/n.draft', false)?.line).toBe('docs/*.draft');
    expect(ignore.match('docs/sub/n.draft', false)).toBeUndefined();
    expect(ignore.match('out/a/b.md', false)?.line).toBe('out/**');
    expect(ignore.match('out', true)).toBeUndefined();
  });

  it('lets a later line bring a file back and a deeper file override a higher one', async () => {
    const ignore = await entered(
      { '.ignore-list': '*.md\n!keep.md\n', 'sub/.ignore-list': '!hidden.md\nnotes.txt\n' },
      ['', 'sub'],
    );
    expect(ignore.match('a.md', false)?.line).toBe('*.md');
    expect(ignore.match('keep.md', false)).toBeUndefined();
    expect(ignore.match('sub/hidden.md', false)).toBeUndefined();
    expect(ignore.match('sub/notes.txt', false)).toEqual({ file: 'sub/.ignore-list', line: 'notes.txt' });
    expect(ignore.match('notes.txt', false)).toBeUndefined();
  });

  it('counts the folders above a path, and never hides what the runtime loads by itself', async () => {
    const ignore = await entered({ '.ignore-list': 'scratch/\nlocal.md\n' }, [''], (path) =>
      path.endsWith('local.md'),
    );
    expect((await ignore.matchPath('scratch/a/b.md'))?.line).toBe('scratch/');
    expect(await ignore.matchPath('notes/b.md')).toBeUndefined();
    expect(ignore.match('pkg/local.md', false)).toBeUndefined();
    expect(ignore.match('pkg/other-local.md', false)).toBeUndefined();
  });

  it('reads a character class and an escaped star, and is exact about case', async () => {
    const ignore = await entered({ '.ignore-list': 'run-[0-9].log\nstar\\*.md\nDraft.md\n' });
    expect(ignore.match('run-4.log', false)?.line).toBe('run-[0-9].log');
    expect(ignore.match('run-x.log', false)).toBeUndefined();
    expect(ignore.match('star*.md', false)?.line).toBe('star\\*.md');
    expect(ignore.match('starry.md', false)).toBeUndefined();
    expect(ignore.match('Draft.md', false)?.line).toBe('Draft.md');
    expect(ignore.match('draft.md', false)).toBeUndefined();
  });

  it('honours no file when the profile names none', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-ignore-'));
    made.push(root);
    await writeFile(join(root, '.ignore-list'), 'a.md\n');
    const none = new IgnoreFiles(root, []);
    await none.enter('');
    expect(none.active).toBe(false);
    expect(none.match('a.md', false)).toBeUndefined();
  });
});
