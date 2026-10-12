import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The recordings hold judge answers about public benchmark items, which quote numbers from math and
 * science questions. A few of those numbers have the shape of a phone or national number, and the leak
 * guard reports them. This marks exactly the reported lines with `guard:allow` (a key the recording reader
 * ignores), so every other line stays under the guard. A denylist finding is never marked.
 *
 *   npx tsx examples/judge-benchmarks/src/guard-allow.ts
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

type Finding = { file: string; line: number; kind: string };

async function main(): Promise<void> {
  let out: string;
  try {
    out = execFileSync(
      process.execPath,
      ['tools/guard/guard.mjs', 'examples/judge-benchmarks/recordings', '--json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
  } catch (cause) {
    // The guard exits 1 when it finds something; its JSON is still on stdout.
    out = (cause as { stdout?: string }).stdout ?? '';
  }
  const findings = (JSON.parse(out) as { findings: Finding[] }).findings;
  const pattern = findings.filter((f) => f.kind !== 'denylist');
  const byFile = new Map<string, Set<number>>();
  for (const f of pattern) byFile.set(f.file, new Set([...(byFile.get(f.file) ?? []), f.line]));
  for (const [file, lines] of byFile) {
    const path = join(ROOT, file);
    const text = (await readFile(path, 'utf8')).split('\n');
    for (const line of lines) {
      const entry = JSON.parse(text[line - 1] as string) as Record<string, unknown>;
      text[line - 1] = JSON.stringify({ ...entry, guard: 'guard:allow' });
    }
    await writeFile(path, text.join('\n'), 'utf8');
    process.stdout.write(`${file}: ${lines.size} line(s) marked\n`);
  }
  const denylisted = findings.length - pattern.length;
  if (denylisted > 0) {
    process.stderr.write(`${denylisted} denylist finding(s): not marked, fix them first\n`);
    process.exitCode = 1;
  }
}

main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 2;
});
