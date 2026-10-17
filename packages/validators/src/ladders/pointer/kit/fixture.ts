import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelArm, SourceFile } from '../sut/port';

/**
 * The committed fixture estate and its cassettes (`examples/estates/fixture`): data, read as files. The items that use
 * them record nothing: they replay what is committed, or replay a copy with one field changed.
 */

export type CassetteRow = { key: string; answer: unknown; readable: Record<string, string> };

export type Fixture = { files: SourceFile[]; cassette: string; rows: CassetteRow[] };

/** The committed cassette files an arm may live in, and the labeler names its entries carry. */
export const CASSETTE_OF: Record<ModelArm, { files: string[]; labelers: string[] }> = {
  haiku: { files: ['cassette.jsonl'], labelers: ['haiku', 'anthropic'] },
  jev: { files: ['cassette-jev.jsonl', 'cassette.jsonl'], labelers: ['jev'] },
  'jev-unit': { files: ['cassette-jev-unit.jsonl'], labelers: ['jev-unit'] },
};

function findFixtureDir(): string | undefined {
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 12; i += 1) {
      const candidate = join(dir, 'examples', 'estates', 'fixture');
      if (existsSync(join(candidate, 'CLAUDE.md'))) return candidate;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return undefined;
}

/** Loads the files the cassette covers and the cassette text; `why` says what is missing on this checkout. */
export function loadFixture(arm: ModelArm): Fixture | { why: string } {
  const dir = findFixtureDir();
  if (!dir) return { why: 'the fixture estate (examples/estates/fixture) is not in this checkout' };
  const spec = CASSETTE_OF[arm];
  const file = spec.files.find((f) => existsSync(join(dir, f)));
  if (!file)
    return { why: `none of ${spec.files.join(', ')} is committed in the fixture estate of this checkout` };
  const cassette = readFileSync(join(dir, file), 'utf8');
  const rows = cassette
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as CassetteRow);
  const mine = rows.filter((r) => spec.labelers.includes(r.readable.labeler ?? ''));
  if (mine.length === 0) return { why: `${file} holds no entry of the ${arm} arm` };
  const paths = [...new Set(mine.map((r) => r.readable.path ?? ''))].sort();
  const files: SourceFile[] = [];
  for (const p of paths) {
    const full = join(dir, p);
    if (!existsSync(full)) return { why: `the fixture file ${p} named by the cassette is missing` };
    files.push({ path: p, text: readFileSync(full, 'utf8') });
  }
  return { files, cassette, rows };
}

/** The cassette text with the entry at `index` (among the arm's entries) given a new key and one changed readable field. */
export function perturb(
  fixture: Fixture,
  arm: ModelArm,
  index: number,
  field: string,
  value: string,
): { cassette: string; window: string } {
  const labelers = CASSETTE_OF[arm].labelers;
  const mine = fixture.rows
    .map((r, i) => ({ r, i }))
    .filter((x) => labelers.includes(x.r.readable.labeler ?? '') && field in x.r.readable);
  const pick = mine[index % mine.length];
  if (!pick) throw new Error(`no entry of the ${arm} arm carries the field ${field}`);
  const lines = fixture.cassette.split('\n').filter((l) => l.trim() !== '');
  const row = JSON.parse(lines[pick.i] as string) as CassetteRow;
  row.key = `${row.key[0] === '0' ? '1' : '0'}${row.key.slice(1)}`;
  row.readable[field] = value;
  lines[pick.i] = JSON.stringify(row);
  return { cassette: `${lines.join('\n')}\n`, window: pick.r.readable.window ?? '' };
}
