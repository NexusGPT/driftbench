import { mapHash } from '../../src/map/build';
import { provenanceHash } from '../../src/scan/text';
import type { Atom, AtomKind, Edge, EstateMap } from '../../src/schema';

/** One atom of a hand-made map: the hash is computed from the quote and the span, as the scanner does. */
export function atom(
  id: string,
  quote: string,
  options: {
    kind?: AtomKind;
    file?: string;
    line?: number;
    endLine?: number;
    approved?: boolean;
    evidence?: Atom['evidence'];
    fields?: Record<string, unknown>;
    producedBy?: 'code' | 'model';
  } = {},
): Atom {
  const file = options.file ?? 'CLAUDE.md';
  const startLine = options.line ?? 1;
  const endLine = options.endLine ?? startLine;
  const located = { file, startLine, endLine, quote };
  return {
    id,
    kind: options.kind ?? 'instruction',
    title: id,
    provenance: { ...located, hash: provenanceHash(located) },
    producedBy: options.producedBy ?? 'model',
    role: 'axis',
    approved: options.approved ?? true,
    evidence: options.evidence ?? [{ type: 'text', must: ['ok'] }],
    enforcement: [],
    ...(options.fields === undefined ? {} : { fields: options.fields }),
  };
}

/** A map of the given atoms and edges, with its hash. */
export function estateMap(atoms: Atom[], edges: Edge[] = [], readAt = '2026-10-11T00:00:00.000Z'): EstateMap {
  return {
    version: 1,
    runtime: 'claude-code',
    root: '.',
    readAt,
    atoms,
    edges,
    hash: mapHash(atoms, edges),
  };
}
