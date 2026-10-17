import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Atom, EstateMap } from '../../src/schema';

/** Invented: a boat hall with a keeper, keys and moorings. Nothing here comes from a real estate. */
export const HALL: Record<string, string> = {
  'CLAUDE.md': [
    '# Boat hall',
    '',
    '- Name the keeper of every boat before it leaves the hall.',
    '- When a mooring is overdue by more than two days, warn the keeper and offer a reminder.',
    '- A boat that stays at most 3 nights pays the short fee.',
    '',
    'Never hand out a key without a signature. Lock the hall when the last boat is out.',
    '',
  ].join('\n'),
  'scripts/count-boats.py': 'print(3)\n',
};

export async function hallFolder(files: Record<string, string> = HALL): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-variables-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

let serial = 0;

/** An atom as the estate map holds it; `quote` is copied from the hall text by the caller. */
export function atom(over: {
  kind?: Atom['kind'];
  file?: string;
  quote: string;
  title?: string;
  role?: Atom['role'];
  approved?: boolean;
  producedBy?: Atom['producedBy'];
  situation?: string;
  fields?: Record<string, unknown>;
}): Atom {
  serial += 1;
  return {
    id: `${over.kind ?? 'instruction'}.hall.atom-${serial}`,
    kind: over.kind ?? 'instruction',
    title: over.title ?? `Atom ${serial}`,
    provenance: {
      file: over.file ?? 'CLAUDE.md',
      startLine: 1,
      endLine: 1,
      quote: over.quote,
      hash: `hash-${serial}`,
    },
    producedBy: over.producedBy ?? 'model',
    role: over.role ?? 'axis',
    approved: over.approved ?? true,
    ...(over.situation === undefined ? {} : { situation: over.situation }),
    evidence: [{ type: 'text', must: ['x'] }],
    enforcement: [],
    ...(over.fields === undefined ? {} : { fields: over.fields }),
  } as Atom;
}

export function mapOf(atoms: Atom[]): EstateMap {
  return {
    version: 1,
    runtime: 'claude-code',
    root: '.',
    readAt: '2026-10-18T00:00:00.000Z',
    atoms,
    edges: [],
    hash: 'f'.repeat(64),
  } as unknown as EstateMap;
}
