import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { CheckOutcome } from '@agent-nexus/driftbench-core';
import { ClaudeCodeReader, copyEstate, type EstateMap, lintEstate, scanEstate } from '../../src/index';
import { NOW, structurePointer } from '../support';
import type { Files } from './claude-layout';
import type { UnitKey } from './spec';

/**
 * The adapter between the generated setups and the product: it writes a setup to a disk, asks the product to
 * read it, and answers in the terms of the tests: which units were read, which reached a labeler, how many
 * orphan parts, unresolved links and unreachable parts the checks found. A test asks the `Observation`, never
 * the product, so a change of the product's output changes this file only.
 */

export type FindingKind = 'orphan' | 'unresolved-link' | 'unreachable';
const KIND_OF: Record<string, FindingKind> = {
  ORPHAN: 'orphan',
  MISSING_REFERENCE: 'unresolved-link',
  UNREACHABLE: 'unreachable',
};
const CODE_OF: Record<FindingKind, string> = {
  orphan: 'ORPHAN',
  'unresolved-link': 'MISSING_REFERENCE',
  unreachable: 'UNREACHABLE',
};

export type Observation = {
  /** The part was read by the reader. */
  isRead(unit: UnitKey): boolean;
  /** Prose of the part reached the splitter, and so a labeler (a cost). */
  reachedLabeler(unit: UnitKey): boolean;
  /** An atom or a document of the map stands for the part. */
  isNamed(unit: UnitKey): boolean;
  /** A copy of the setup (for a mutant or a unit run) holds the part. */
  isCopied(unit: UnitKey): boolean;
  count(kind: FindingKind): number;
  /** The outcome of the check that finds this kind of finding: its status and what it read and skipped. */
  outcome(kind: FindingKind): CheckOutcome;
  /** Every check's outcome, in the product's order. */
  outcomes: CheckOutcome[];
  /** The files some check reports as unknown: no part type covers them. Sorted, once each. */
  unknown: string[];
  /** The subjects of the orphan findings: the files the orphan check found nothing names. */
  orphanFiles: string[];
  counts: Record<FindingKind, number>;
  /** Pairs of read parts that differ only in letter case: a part read under two spellings. */
  twins: string[];
  /** Parts read, and the product's map, for the checks that need the identity a part got. */
  readCount: number;
  map: EstateMap;
};

const made: string[] = [];

export async function cleanup(): Promise<void> {
  while (made.length > 0) await rm(made.pop() ?? '', { recursive: true, force: true });
}

export async function write(files: Files, root?: string): Promise<string> {
  const folder = root ?? (await mkdtemp(join(tmpdir(), 'driftbench-variant-')));
  if (root === undefined) made.push(folder);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  return folder;
}

async function filesUnder(to: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out.push(relative(to, path).split('\\').join('/'));
    }
  };
  await walk(to);
  return out.sort();
}

function twinsOf(files: readonly string[]): string[] {
  const seen = new Map<string, string>();
  const twins: string[] = [];
  for (const file of files) {
    const key = file.toLowerCase();
    const earlier = seen.get(key);
    if (earlier !== undefined && earlier !== file) twins.push(`${earlier} / ${file}`);
    else seen.set(key, file);
  }
  return twins;
}

/** Reads the setup at `root` and answers for the units, each given with the path it was written at. */
export async function observe(
  root: string,
  paths: ReadonlyMap<UnitKey, string>,
  options: { ignore?: string[]; userSkills?: string } = {},
): Promise<Observation> {
  const reader = new ClaudeCodeReader(options);
  const { map, raw } = await scanEstate({ root, reader, now: NOW, pointer: structurePointer() });
  const lint = lintEstate(map, raw);
  const counts: Record<FindingKind, number> = { orphan: 0, 'unresolved-link': 0, unreachable: 0 };
  for (const finding of lint.findings) {
    const kind = KIND_OF[finding.code];
    if (kind) counts[kind] += 1;
  }
  const files = new Set(raw.files.map((file) => file.path));
  const prose = new Set(raw.prose.map((chunk) => chunk.file));
  const named = new Set([
    ...map.atoms.map((atom) => atom.provenance.file),
    ...(map.documents ?? []).map((document) => document.path),
  ]);
  const to = await mkdtemp(join(tmpdir(), 'driftbench-variant-copy-'));
  made.push(to);
  await copyEstate(root, to, map);
  const copy = new Set(await filesUnder(to));
  const where = (unit: UnitKey) => paths.get(unit) ?? `no path for ${unit}`;
  return {
    isRead: (unit) => files.has(where(unit)),
    reachedLabeler: (unit) => prose.has(where(unit)),
    isNamed: (unit) => named.has(where(unit)),
    isCopied: (unit) => copy.has(where(unit)),
    count: (kind) => counts[kind],
    outcome: (kind) => {
      const found = lint.outcomes.find((outcome) => outcome.check === CODE_OF[kind]);
      if (!found) throw new Error(`the lint reports no outcome for ${CODE_OF[kind]}`);
      return found;
    },
    outcomes: lint.outcomes,
    orphanFiles: lint.findings
      .filter((finding) => finding.code === CODE_OF.orphan)
      .map((finding) => finding.subject)
      .sort(),
    unknown: [...new Set(lint.outcomes.flatMap((outcome) => outcome.coverage.unknown))].sort(),
    counts,
    twins: [...twinsOf([...files]), ...twinsOf([...copy]).map((pair) => `copy: ${pair}`)],
    readCount: files.size,
    map,
  };
}

/** Whether this disk keeps the case of a name: `a` and `A` are two files on Linux and one on a Mac. */
export async function diskKeepsCase(): Promise<boolean> {
  const dir = await write({ a: 'x' });
  return (await stat(join(dir, 'A')).catch(() => undefined)) === undefined;
}
