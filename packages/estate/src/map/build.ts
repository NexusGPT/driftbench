import type { ModelPort } from '@driftbench/generate';
import { analyzeGraph, type GraphAnalysis } from '../graph/analyze';
import { buildGraph } from '../graph/edges';
import { DEFAULT_STANDING_CEILING, invariantAtoms, measureInvariants, scanAtoms } from '../scan/invariants';
import type { ChunkRun, ProseRefusal } from '../scan/prose';
import type { EstateReader, RawEstate } from '../scan/reader';
import { quoteAtSpan, sha256 } from '../scan/text';
import type { Atom, Edge, EstateMap } from '../schema';

/**
 * The whole scan, from a folder to an estate map: the reader reads the files, code reads every structured
 * atom, the model splits the prose (when a port is given), the graph links the atoms and decides what each
 * guard enforces, the invariants are measured, and every quote is checked once more at its span before the
 * map is returned. The same estate, the same recorded answers and the same clock give the same map.
 */

export type ScanEstateInput = {
  root: string;
  reader: EstateReader;
  port?: ModelPort;
  /** The root as the map records it: relative to where the map is written. Default `.`. */
  rootLabel?: string;
  ceiling?: number;
  now?: () => Date;
  maxTokens?: number;
};

export type ScanEstateResult = {
  map: EstateMap;
  raw: RawEstate;
  analysis: GraphAnalysis;
  chunks: ChunkRun[];
  refusals: ProseRefusal[];
  duplicates: string[];
  calls: number;
};

export async function scanEstate(input: ScanEstateInput): Promise<ScanEstateResult> {
  const raw = await input.reader.read(input.root);
  const scanned = await scanAtoms(raw, {
    ...(input.port ? { port: input.port } : {}),
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
  });
  const { builder } = scanned;
  const graph = buildGraph(builder.atoms, raw);
  for (const [guard, entries] of graph.enforces) {
    const atom = builder.atoms.find((candidate) => candidate.id === guard);
    if (atom) atom.fields = { ...atom.fields, enforces: entries };
    for (const entry of entries) {
      const rule = builder.atoms.find((candidate) => candidate.id === entry.atom);
      if (rule && !rule.enforcement.includes(guard)) rule.enforcement.push(guard);
    }
  }
  const before = analyzeGraph(builder.atoms, graph.edges, raw.files);
  invariantAtoms(
    raw,
    builder,
    measureInvariants(raw, before.orphans, input.ceiling ?? DEFAULT_STANDING_CEILING),
  );
  const analysis = analyzeGraph(builder.atoms, graph.edges, raw.files);

  const texts = new Map(raw.files.map((file) => [file.path, file.text]));
  for (const atom of builder.atoms) {
    const text = texts.get(atom.provenance.file);
    if (text === undefined || !quoteAtSpan(text, atom.provenance)) {
      throw new Error(
        `the scan built an atom whose quote is not at its span: ${atom.id} (${atom.provenance.file}:${atom.provenance.startLine})`,
      );
    }
  }

  const at = (input.now ?? (() => new Date()))().toISOString();
  const atoms = builder.atoms;
  const map: EstateMap = {
    version: 1,
    runtime: raw.runtime,
    root: input.rootLabel ?? '.',
    readAt: at,
    atoms,
    edges: graph.edges,
    ...(input.port
      ? { producedBy: { family: input.port.family, model: input.port.model ?? 'unknown', at } }
      : {}),
    hash: mapHash(atoms, graph.edges),
  };
  return {
    map,
    raw,
    analysis,
    chunks: scanned.chunks,
    refusals: scanned.refusals,
    duplicates: scanned.duplicates,
    calls: scanned.calls,
  };
}

/** SHA-256 over the sorted atom hashes (with their ids) and the sorted edges. Approval does not change it. */
export function mapHash(atoms: readonly Atom[], edges: readonly Edge[]): string {
  const lines = [
    ...atoms.map((atom) => `${atom.id} ${atom.provenance.hash}`).sort(),
    ...edges.map((edge) => `${edge.from} ${edge.kind} ${edge.to}`).sort(),
  ];
  return sha256(lines.join('\n'));
}
