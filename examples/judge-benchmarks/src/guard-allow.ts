import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Public benchmark answers quote supplied data. Denylist findings are never allowed. */
const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
type Finding = { line: number; kind: string };
type Guard = {
  scanText(text: string, options: { denylist: readonly string[] }): { findings: Finding[] };
  loadDenylist(env: NodeJS.ProcessEnv, root: string): string[];
};
const guard = () => import(pathToFileURL(join(ROOT, 'tools/guard/guard.mjs')).href) as Promise<Guard>;

/** Scan the whole recording, including files larger than the tree guard's byte limit. */
export async function allowPublicPatterns(text: string, denylist: readonly string[]): Promise<{
  text: string; marked: number; denied: number;
}> {
  const { findings } = (await guard()).scanText(text, { denylist });
  const deniedLines = new Set(findings.filter((f) => f.kind.startsWith('denylist')).map((f) => f.line));
  const allowedLines = new Set(findings.filter((f) => !f.kind.startsWith('denylist') && !deniedLines.has(f.line)).map((f) => f.line));
  const lines = text.split('\n');
  for (const line of allowedLines) {
    const entry = JSON.parse(lines[line - 1] as string) as Record<string, unknown>;
    lines[line - 1] = JSON.stringify({ ...entry, guard: 'guard:allow' });
  }
  return {
    text: lines.join('\n'), marked: allowedLines.size,
    denied: findings.filter((f) => f.kind.startsWith('denylist')).length,
  };
}

async function main(): Promise<void> {
  const benchAt = process.argv.indexOf('--bench');
  const bench = benchAt < 0 ? undefined : process.argv[benchAt + 1];
  if (benchAt >= 0 && (!bench || !/^[a-z0-9-]+$/.test(bench))) throw new Error('Invalid --bench');
  const base = join(ROOT, 'examples', 'judge-benchmarks', 'recordings');
  const directories = bench ? [join(base, bench)] : (await readdir(base, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => join(base, entry.name));
  const denylist = (await guard()).loadDenylist(process.env, ROOT);
  let denied = 0;
  for (const directory of directories) {
    for (const file of (await readdir(directory)).filter((file) => file.endsWith('.jsonl'))) {
      const path = join(directory, file);
      const result = await allowPublicPatterns(await readFile(path, 'utf8'), denylist);
      denied += result.denied;
      if (result.marked > 0) {
        await writeFile(path, result.text, 'utf8');
        process.stdout.write(`${path}: ${result.marked} public-pattern line(s) marked\n`);
      }
    }
  }
  if (denied > 0) {
    process.stderr.write(`${denied} denylist finding(s): not marked, fix them first\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 2;
  });
}
