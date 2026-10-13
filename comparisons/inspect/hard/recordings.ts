import { existsSync, readdirSync, readFileSync } from 'node:fs';

// Immutable parts plus the append-only active file retain complete recordings.
export function recordingLines(root: URL): string[] {
  const parts = new URL('./calls/', root);
  const paths = existsSync(parts)
    ? readdirSync(parts)
        .filter((name) => /^part-\d+\.jsonl$/.test(name))
        .sort()
        .map((name) => new URL(name, parts))
    : [];
  const active = new URL('./calls.jsonl', root);
  if (existsSync(active)) paths.push(active);
  return paths.flatMap((path) => readFileSync(path, 'utf8').split('\n').filter(Boolean));
}
