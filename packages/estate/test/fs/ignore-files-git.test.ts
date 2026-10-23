import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IgnoreFiles, parseIgnoreFile } from '../../src/fs/ignore-files';

/**
 * Our reading of an ignore file against git's, the reference the format comes from: the same random trees and
 * ignore lines go through `git ls-files --others --exclude-standard` and through the matcher, and the files each
 * keeps must be the same. Case is exact (`core.ignorecase=false`), no global or system configuration is read, and
 * no tree holds two names that differ only in case, so the result is the same on every disk. The test is skipped
 * when git is not installed. Lines and names are invented from small alphabets that reach every form: classes
 * (reversed, bracket first, named, never closed), escapes, anchors, `**`, negation, folders-only.
 */

const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
const HAS_GIT = git.status === 0;

const made: string[] = [];
afterEach(async () => {
  while (made.length > 0) await rm(made.pop() ?? '', { recursive: true, force: true });
});

function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(random: () => number, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)] as T;

/** File and folder names: lower case only, so no two differ in case. */
const NAMES = ['a', 'b', 'ab', 'ba', 'z', 'a-b', ']', 'a.b', 'q1', 'b-'] as const;
const FOLDERS = ['a', 'b', 'ab', 'z'] as const;

/** Pieces of a line, in the forms a real file holds. */
const ATOMS = [
  'a',
  'b',
  'ab',
  'z',
  '*',
  '**',
  '?',
  '[ab]',
  '[/]',
  '[!x]',
  '[!a]',
  '[^a]',
  '[]a]',
  '[!]a]',
  '[a-z]',
  '[z-a]',
  '[a-]',
  '[-a]',
  '[a-c-e]',
  '[[:alpha:]]',
  '[[:digit:]]',
  '[[:foo:]]',
  '[[:alpha:',
  '[a',
  '[',
  '[]',
  '\\a',
  '\\*',
  '\\[',
  '\\]',
  '.',
  '-',
  'q',
  '1',
] as const;

function lineOf(random: () => number): string {
  const count = 1 + Math.floor(random() * 3);
  let line = Array.from({ length: count }, () => pick(random, ATOMS)).join('');
  if (random() < 0.25) line = `${pick(random, ['', '', '**/', 'a/', 'b/', '/a/'])}${line}`;
  if (random() < 0.2) line = `${line}/${pick(random, ['', '', '*', 'a', '**'])}`;
  if (random() < 0.3) line = `${line}/`;
  if (random() < 0.15) line = `/${line}`;
  if (random() < 0.25) line = `!${line}`;
  if (random() < 0.04) line = `# ${line}`;
  if (random() < 0.03) line = `${line}\\`;
  if (random() < 0.03) line = `${line}  `;
  return line;
}

type Tree = { files: Map<string, string>; ignoreFiles: string[] };

function treeOf(seed: number): Tree {
  const random = rng(seed);
  const files = new Map<string, string>();
  const folders = [
    '',
    ...FOLDERS.flatMap((first) => [first, ...FOLDERS.map((second) => `${first}/${second}`)]),
  ];
  for (let n = 0; n < 14; n++) {
    const folder = pick(random, folders);
    const name = pick(random, NAMES);
    files.set(folder === '' ? name : `${folder}/${name}`, 'x\n');
  }
  // A path cannot be a file and a folder: drop files whose path is the folder of another.
  for (const path of [...files.keys()])
    if ([...files.keys()].some((other) => other.startsWith(`${path}/`))) files.delete(path);
  const ignoreFiles: string[] = [];
  for (const folder of ['', ...[...files.keys()].map(dirname).filter((d) => d !== '.')]) {
    if (ignoreFiles.includes(folder === '' ? '.gitignore' : `${folder}/.gitignore`)) continue;
    if (folder !== '' && random() > 0.4) continue;
    const lines = Array.from({ length: 1 + Math.floor(random() * 4) }, () => lineOf(random));
    const path = folder === '' ? '.gitignore' : `${folder}/.gitignore`;
    files.set(path, `${lines.join('\n')}\n`);
    ignoreFiles.push(path);
  }
  return { files, ignoreFiles };
}

async function write(tree: Tree): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-git-diff-'));
  made.push(root);
  for (const [path, text] of tree.files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** The files git keeps: untracked, not ignored. */
function keptByGit(root: string): string[] {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', HOME: root };
  const run = (args: string[]) =>
    spawnSync('git', ['-C', root, '-c', 'core.ignorecase=false', ...args], { encoding: 'utf8', env });
  expect(run(['init', '-q']).status).toBe(0);
  const listed = run(['ls-files', '--others', '--exclude-standard', '-z']);
  expect(listed.status).toBe(0);
  return listed.stdout
    .split('\0')
    .filter((path) => path !== '')
    .sort();
}

async function keptByUs(root: string, tree: Tree): Promise<string[]> {
  const ignore = new IgnoreFiles(root, ['.gitignore']);
  const kept: string[] = [];
  for (const path of [...tree.files.keys()].sort())
    if ((await ignore.matchPath(path)) === undefined) kept.push(path);
  return kept;
}

describe.skipIf(!HAS_GIT)('an ignore file is read as git reads it', () => {
  it.each(Array.from({ length: 120 }, (_, index) => index + 1))(
    'keeps the same files as git (tree %i)',
    async (seed) => {
      const tree = treeOf(seed);
      const root = await write(tree);
      const expected = keptByGit(root);
      const found = await keptByUs(root, tree);
      const lines = [...tree.files]
        .filter(([path]) => path.endsWith('.gitignore'))
        .map(([path, text]) => `${path}: ${JSON.stringify(text)}`);
      expect(found, lines.join('\n')).toEqual(expected);
    },
    60_000,
  );
});

/** Lines worth reading one by one against git: each form of a class, of a star, of a slash, of an escape. */
const LINES = [
  'a[/]b',
  'a[!x]b',
  'a[^x]b',
  'a?b',
  'a*b',
  'a**b',
  'a/**/b',
  '**/b',
  '**',
  'a/**',
  '/**',
  '**/**',
  'a/b/**',
  '[]a]',
  '[!]a]',
  '[]',
  '[z-a]',
  '[!z-a]',
  '[a-c-e]',
  '[a-]',
  '[-a]',
  '[[:alpha:]]',
  '[[:upper:]]',
  '[[:digit:][:alpha:]]',
  '[[:foo:]]',
  '[[:alpha:',
  '[[:]',
  '[a',
  '\\a',
  '\\',
  'a\\',
  '\\*',
  '\\[a]',
  '[\\]]',
  'a//',
  '//a',
  '/a/',
  'a/',
  'ab/',
  '!a',
  '\\!a',
  '\\#a',
  'a ',
  'a\\ ',
] as const;

const FIXED = [
  'a/b',
  'a/ab',
  'a/a-b',
  'b',
  'ab',
  'ba',
  'a',
  ']/a',
  'a-b',
  'z/a',
  'a.b',
  'q1',
  'a/b/z',
  'ab/b',
  '!a',
  '#a',
  'a ',
  '[a]',
] as const;

describe.skipIf(!HAS_GIT)('each form of a line keeps the files git keeps', () => {
  it.each(LINES)('line %j', async (line) => {
    const files = new Map<string, string>(FIXED.map((path) => [path, 'x\n']));
    // A path cannot be a file and a folder: `a` and `ab` are folders here, so their files are the entries inside.
    for (const path of [...files.keys()])
      if ([...files.keys()].some((other) => other.startsWith(`${path}/`))) files.delete(path);
    files.set('.gitignore', `${line}\n`);
    const tree: Tree = { files, ignoreFiles: ['.gitignore'] };
    const root = await write(tree);
    expect(await keptByUs(root, tree), JSON.stringify(line)).toEqual(keptByGit(root));
  });
});

describe('no line makes an invalid expression', () => {
  it('reads 20000 random lines of the alphabet without a throw, each to a line that tests paths', () => {
    const random = rng(7);
    for (let n = 0; n < 20_000; n++) {
      const lines = parseIgnoreFile(`${lineOf(random)}\n`);
      for (const line of lines) expect(typeof line.test('a/b')).toBe('boolean');
    }
  });

  it.each(['[z-a]', '[]^*]', '[', '[a', '[[:foo:]]', '[[:alpha:', 'a\\', '[!z-a]', '[]'])(
    'reads the line %s without a throw',
    (line) => {
      expect(() => parseIgnoreFile(`${line}\n`)).not.toThrow();
    },
  );
});
