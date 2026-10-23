import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CheckOutcome } from '@agent-nexus/driftbench-core';
import { ClaudeCodeReader, lintEstate, referenceGraph, scanEstate } from '../../src/index';
import type { EstateFile } from '../../src/scan/reader';
import { NOW } from '../support';
import type { Aspect, LinkKind } from './vocabulary';

/**
 * The ONLY file of the seam tests that touches the product. It reads an estate through the scanner and the lint of
 * the code under test and gives back parts (with aspects), typed links and check outcomes, in the words of
 * `vocabulary.ts`. When the common model lands, only this file changes; every test states what a reader of the
 * model must see.
 *
 * Today the model does not exist, so the adapter derives what it can from the map and the lint:
 * - links come from the reference graph (`referenceGraph`), the extractors of each file's part type;
 * - aspects come from the kind of the file the reader gave;
 * - outcomes are the lint's own `outcomes` (step 1 of the model), coverage included.
 */

export type PartRef = { id: string; path: string };

export type ObservedLink = {
  kind: LinkKind;
  from: string;
  /** The part the link leads to, or null when it leads to no part of the estate. */
  to: string | null;
  /** True when the written path leads to a file that exists. */
  resolved: boolean;
  /** True when the path is written outside the estate: information, never a missing reference. */
  external: boolean;
};

/**
 * The outcome of one check, as the common model reports it (`CheckOutcome` of `@agent-nexus/driftbench-core`): a
 * status, what it read and left out, and its findings, here as part ids where a finding names a part. The checks the
 * tests state are `references` (the lint's MISSING_REFERENCE) and `orphans` (ORPHAN).
 */
export type Outcome = CheckOutcome<string> & { name: 'references' | 'orphans' };

export type Observed = {
  aspects: Map<string, Set<Aspect>>;
  links: ObservedLink[];
  outcomes: Outcome[];
};

export type Files = Record<string, string>;

export type ObserveOptions = {
  /** Folders to nest the estate root in, so a test can move the root without changing a relative path. */
  nest?: readonly string[];
};

const SCRIPT = /\.(?:py|sh|bash|js|mjs|cjs|ts)$/i;

function aspectsOf(file: EstateFile): Set<Aspect> {
  const aspects = new Set<Aspect>();
  if (file.kind === 'standing' || file.kind === 'memory' || file.kind === 'skill' || file.kind === 'subagent')
    aspects.add('instructs');
  if (SCRIPT.test(file.path)) aspects.add('executes');
  return aspects;
}

/** Writes the files, reads the estate with no model, and reports parts, links and outcomes. */
export async function observe(
  files: Files,
  parts: readonly PartRef[],
  options: ObserveOptions = {},
): Promise<Observed> {
  const top = await mkdtemp(join(tmpdir(), 'driftbench-seam-'));
  const root = join(top, ...(options.nest ?? []));
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const idOf = new Map(parts.map((part) => [part.path, part.id]));
    const id = (path: string) => idOf.get(path) ?? `?${path}`;
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const lint = lintEstate(map, raw);

    const aspects = new Map<string, Set<Aspect>>();
    for (const file of raw.files) aspects.set(id(file.path), aspectsOf(file));

    // The links are the reference graph's: what the extractors of each file's part type read, resolved. A mention
    // that leads to no file is a link with no target.
    const graph = referenceGraph(raw);
    const links: ObservedLink[] = graph.entries
      // A module import that leads to no file is not a link: the check lists it as skipped.
      .filter((entry) => entry.outcome !== 'unresolved')
      .map((entry) => ({
        kind: entry.mention.kind,
        from: id(entry.from),
        to: entry.outcome === 'resolved' ? id(entry.path) : null,
        resolved: entry.outcome === 'resolved',
        external: entry.outcome === 'external',
      }));

    // The outcomes are the lint's own (step 1 gives every code its outcome with coverage); the test only renames the
    // finding subjects of ORPHAN to part ids.
    const of = (code: 'MISSING_REFERENCE' | 'ORPHAN', name: Outcome['name']): Outcome => {
      const found = lint.outcomes.find((entry) => entry.check === code);
      if (!found) throw new Error(`the lint reports no ${code} outcome`);
      return {
        ...found,
        name,
        findings: found.findings.map((finding) =>
          code === 'ORPHAN' ? id(finding.subject) : finding.subject,
        ),
      };
    };
    const outcomes: Outcome[] = [of('MISSING_REFERENCE', 'references'), of('ORPHAN', 'orphans')];
    return { aspects, links, outcomes };
  } finally {
    await rm(top, { recursive: true, force: true });
  }
}
