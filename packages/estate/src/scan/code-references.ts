import { referenceGraph } from '../refs/graph';
import type { AtomBuilder } from './code';
import type { RawEstate } from './reader';

/**
 * The reference atoms of a scan with no model. The reference graph (`../refs`) holds what every file of prose points
 * at, read by the extractors of the file's part type from the syntax of a path; this turns each entry into a
 * `reference` atom on its line, with the file it leads to or why it leads nowhere:
 *
 *   exists      the path is a file of the estate
 *   external    the path is written outside the estate (`~/`, `/`, an external folder): information
 *   candidates  several files end the path: the lint names them
 *   neither     a named file that does not exist: a missing reference
 *
 * A model or the pointer reader splits the prose into units and decides which of them tell the reader to read a
 * file, and gives its own reference atoms; the scan with no model has no such unit, so its atoms are the graph's
 * entries, which are the paths that are certain (see `referenceGraph`).
 */
export function referenceAtoms(raw: RawEstate, builder: AtomBuilder): void {
  for (const entry of referenceGraph(raw).entries) {
    // A module import links two code files; it is no instruction to read a file, so it makes no atom.
    if (entry.mention.syntax === 'module') continue;
    if (entry.mention.import && entry.outcome === 'resolved') continue;
    builder.add({
      kind: 'reference',
      title: `Read ${entry.mention.written}`,
      at: {
        file: entry.from,
        startLine: entry.mention.line,
        endLine: entry.mention.line,
        quote: entry.mention.quote,
      },
      evidence: [
        { type: 'tool_called', label: raw.labels.read, input: { file_path: { contains: entry.path } } },
      ],
      fields: {
        path: entry.path,
        from: entry.from,
        exists: entry.outcome === 'resolved',
        ...(entry.mention.import ? { import: true } : {}),
        ...(entry.concrete ? { concrete: true } : {}),
        ...(entry.resolvedBy ? { resolvedBy: entry.resolvedBy } : {}),
        ...(entry.candidates ? { candidates: entry.candidates } : {}),
        ...(entry.outcome === 'external' ? { external: true } : {}),
      },
    });
  }
}
