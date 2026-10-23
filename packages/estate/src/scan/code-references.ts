import type { AtomBuilder } from './code';
import { chunkLines, pathMentions } from './code';
import { normativeEstate } from './document-roles';
import type { RawEstate } from './reader';
import { documentFileType } from './reference-role';

/**
 * The references code reads with no model: every path a prose line writes as a code span, a link destination, a
 * quoted name or a loose token, and every `@path` line of a standing file (an import). The syntax decides what is
 * a path (`pathMentions`); no word of the prose decides anything. Each path gives one `reference` atom on its
 * line, with the file it leads to, or why it leads nowhere:
 *
 *   exists      the path is a file of the estate
 *   external    the path is written outside the estate (`~/`, `/`, an external folder): information
 *   candidates  several files end the path: the lint names them
 *   neither     a named file that does not exist: a missing reference
 *
 * An import that exists gives no atom: the runtime loads it, and the agent reads nothing. A model or the pointer
 * reader splits the prose into units and decides which of them tell the reader to read a file; code has no such
 * unit, so it keeps the paths that are certain: a file that exists, an outside path, a missing import, and a
 * missing path whose extension names a prose or script file type. A bare loose word that several files could be
 * is left out.
 */

/** The line of a standing file that imports another file: `@path`, alone on its line. */
const IMPORT = /^@(\S+)\s*$/;

/** Adds one reference atom per path the prose of the estate names. The code atoms are already in the builder. */
export function referenceAtoms(raw: RawEstate, builder: AtomBuilder): void {
  raw = normativeEstate(raw);
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  for (const chunk of raw.prose) {
    const source = files.get(chunk.file);
    for (const line of chunkLines(chunk, source)) {
      const imported = source?.kind === 'standing' ? IMPORT.exec(line.text.trim())?.[1] : undefined;
      const mentions = imported
        ? [{ path: imported.replace(/^\.\//, ''), bare: false }]
        : pathMentions(line.text).map(({ path, bare }) => ({ path, bare }));
      for (const mention of mentions) {
        const key = `${chunk.file}\0${line.line}\0${mention.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const target = builder.resolve(mention.path, chunk.file, mention.bare);
        if (target.exists && target.path === chunk.file) continue;
        // The runtime loads an import that exists: nobody reads it, so it is no reference. One it cannot load is.
        if (imported && target.exists) continue;
        const outside = target.via === 'external';
        const several = target.candidates !== undefined;
        if (!target.exists && !outside) {
          if (target.ignored || target.unresolved) continue;
          if (several && mention.bare) continue;
          if (!several && !imported && !documentFileType(mention.path)) continue;
        }
        builder.add({
          kind: 'reference',
          title: `Read ${mention.path}`,
          at: { file: chunk.file, startLine: line.line, endLine: line.line, quote: line.quote },
          evidence: [
            { type: 'tool_called', label: raw.labels.read, input: { file_path: { contains: target.path } } },
          ],
          fields: {
            path: target.path,
            from: chunk.file,
            exists: target.exists,
            ...(imported ? { import: true } : {}),
            ...(target.concrete ? { concrete: true } : {}),
            ...(target.via === 'alias' || target.via === 'suffix' ? { resolvedBy: target.via } : {}),
            ...(several ? { candidates: target.candidates } : {}),
            ...(outside ? { external: true } : {}),
          },
        });
      }
    }
  }
}
