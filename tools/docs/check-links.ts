/**
 * Checks the links between docs pages.
 *
 * Every relative link in docs/ must point at a file or folder that exists, and at a heading that
 * exists when it names one. Every page must be reachable from docs/index.md by following links.
 * External URLs are not fetched. Pages are the markdown files git tracks or would track, so a file
 * git ignores or excludes (a local working file) is not a page; outside a git repository every
 * markdown file counts, except docs/lanes.
 *
 * Usage:  tsx tools/docs/check-links.ts [folder]
 * Exit:   0 clean, 1 broken links or unreachable pages.
 */
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Link = { line: number; target: string };
export type Problem = { file: string; line: number; target: string; reason: string };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DOCS = resolve(ROOT, 'docs');
const SKIP = new Set(['lanes', 'node_modules']);
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** GitHub's heading anchor: lower case, punctuation dropped, each space turned into a hyphen. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Lines outside fenced code blocks, with inline code removed. Fences become empty lines. */
function proseLines(markdown: string): string[] {
  let fence: string | undefined;
  return markdown.split('\n').map((line) => {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === undefined && opener !== undefined) {
      fence = opener;
      return '';
    }
    if (fence !== undefined) {
      if (line.trim().startsWith(fence)) fence = undefined;
      return '';
    }
    return line.replace(/(`+)[^`]*?\1/g, '');
  });
}

/** The anchors GitHub gives the headings of a page, with -1, -2 on repeated headings. */
export function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  let fence: string | undefined;
  for (const line of markdown.split('\n')) {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === undefined && opener !== undefined) {
      fence = opener;
      continue;
    }
    if (fence !== undefined) {
      if (line.trim().startsWith(fence)) fence = undefined;
      continue;
    }
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const base = slug(heading);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/** Inline links, images and reference definitions, outside code. */
export function extractLinks(markdown: string): Link[] {
  const links: Link[] = [];
  proseLines(markdown).forEach((text, index) => {
    for (const match of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      if (match[1]) links.push({ line: index + 1, target: match[1] });
    }
    const definition = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/.exec(text)?.[1];
    if (definition) links.push({ line: index + 1, target: definition });
  });
  return links;
}

/** True for a link this checker owns: not a URL with a scheme, not protocol relative. */
export function isRelative(target: string): boolean {
  return !SCHEME.test(target) && !target.startsWith('//');
}

/** The markdown files under the folder that git tracks or would track, or every markdown file outside a repository. */
export async function markdownFiles(dir: string): Promise<string[]> {
  const listed = gitMarkdownFiles(dir);
  if (listed) return listed;
  return walkMarkdownFiles(dir);
}

function gitMarkdownFiles(dir: string): string[] | undefined {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', dir],
      {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return out
      .split('\0')
      .filter((file) => file !== '' && extname(file).toLowerCase() === '.md')
      .map((file) => resolve(dir, file))
      .sort();
  } catch {
    return undefined;
  }
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkMarkdownFiles(full)));
    else if (extname(entry.name).toLowerCase() === '.md') out.push(full);
  }
  return out.sort();
}

async function exists(path: string): Promise<'file' | 'folder' | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return undefined;
  return info.isDirectory() ? 'folder' : 'file';
}

/** Resolves a relative link from the page that holds it. Returns the file and the anchor. */
export function resolveLink(from: string, target: string): { path: string; anchor?: string } {
  const hash = target.indexOf('#');
  const pathPart = hash === -1 ? target : target.slice(0, hash);
  const anchor = hash === -1 ? undefined : decodeURIComponent(target.slice(hash + 1));
  const path = pathPart === '' ? from : resolve(dirname(from), decodeURIComponent(pathPart));
  return anchor === undefined ? { path } : { path, anchor };
}

/** Checks every relative link in every page under the folder. */
export async function checkLinks(
  dir: string = DOCS,
): Promise<{ problems: Problem[]; links: number; files: number }> {
  const files = await markdownFiles(dir);
  const anchorCache = new Map<string, Set<string>>();
  const anchorsOf = async (file: string) => {
    let anchors = anchorCache.get(file);
    if (!anchors) {
      anchors = headingAnchors(await readFile(file, 'utf8'));
      anchorCache.set(file, anchors);
    }
    return anchors;
  };

  const problems: Problem[] = [];
  let count = 0;
  for (const file of files) {
    const shown = relative(dir, file);
    for (const link of extractLinks(await readFile(file, 'utf8'))) {
      if (!isRelative(link.target)) continue;
      count += 1;
      const report = (reason: string) =>
        problems.push({ file: shown, line: link.line, target: link.target, reason });
      if (link.target.startsWith('/')) {
        report('absolute path; use a path relative to the page');
        continue;
      }
      const { path, anchor } = resolveLink(file, link.target);
      const kind = await exists(path);
      if (kind === undefined) {
        report('no such file or folder');
        continue;
      }
      if (anchor === undefined || anchor === '') continue;
      if (kind === 'folder' || extname(path).toLowerCase() !== '.md') {
        report('a heading link must point at a markdown page');
        continue;
      }
      if (!(await anchorsOf(path)).has(anchor)) report(`no heading with the anchor #${anchor}`);
    }
  }
  return { problems, links: count, files: files.length };
}

/** Pages under the folder that cannot be reached from the entry page by following links. */
export async function unreachablePages(dir: string = DOCS, entry = 'index.md'): Promise<string[]> {
  const files = await markdownFiles(dir);
  const start = resolve(dir, entry);
  const reached = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || reached.has(file)) continue;
    if ((await exists(file)) !== 'file') continue;
    reached.add(file);
    for (const link of extractLinks(await readFile(file, 'utf8'))) {
      if (!isRelative(link.target) || link.target.startsWith('/')) continue;
      const { path } = resolveLink(file, link.target);
      if (extname(path).toLowerCase() === '.md' && !reached.has(path)) queue.push(path);
    }
  }
  return files.filter((file) => !reached.has(file)).map((file) => relative(dir, file));
}

export type Io = { out: (text: string) => void; err: (text: string) => void };

/** Runs the checker on a folder. Returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const dir = resolve(argv[0] ?? DOCS);
  const { problems, links, files } = await checkLinks(dir);
  const lost = await unreachablePages(dir);
  const shown = relative(process.cwd(), dir) || '.';
  if (problems.length === 0 && lost.length === 0) {
    io.out(
      `${shown}: ${links} relative links in ${files} pages resolve; every page is reachable from index.md.\n`,
    );
    return 0;
  }
  for (const problem of problems) {
    io.err(`${problem.file}:${problem.line}  ${problem.target}  ${problem.reason}\n`);
  }
  for (const page of lost) io.err(`${page}  not reachable from index.md\n`);
  io.err(`${shown}: ${problems.length} broken links, ${lost.length} unreachable pages.\n`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
