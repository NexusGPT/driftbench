import { type ImportMention, markdownView } from '../scan/markdown-view';
import type { ExtractInput, Mention, ReferenceExtractor } from './extractor';

export type { ImportMention };

/**
 * The rule `import(<prefix>)`: a part includes another file by writing the prefix and a path, `@path/to/file`
 * (the import of a standing file, as the Claude Code memory documentation describes it):
 *
 * - the prefix may stand anywhere in a line, at its start or after a space, outside a code span and a fenced block;
 *   it is not an import inside a word (`name@host`);
 * - the path ends at the first space, unless each space in it is written with a backslash;
 * - a path wrapped in quotes is not an import;
 * - a relative path is read from the folder of the file that holds the import.
 *
 * The extractor reads the syntax only. The graph resolves the path from the importer's folder, with no second place
 * to look in: the runtime loads the file where the path says, or loads nothing.
 */

/**
 * The imports a text writes with a prefix, with their lines. The text is read as CommonMark reads it: an import is
 * looked for in the runs of text only, so none is read in a code span (over one line or several), an indented or
 * fenced block, a definition, an image description or an HTML block. A link label is text; where it ends a path ends.
 */
export function importMentions(text: string, prefix: string): ImportMention[] {
  return markdownView(text).imports(prefix);
}

export const IMPORT_EXTRACTOR: ReferenceExtractor = {
  id: 'import-prefix',
  rule: 'import',
  extract(input: ExtractInput): Mention[] {
    const prefixes = input.rules.flatMap((rule) => (rule.by === 'import' ? [rule.prefix] : []));
    if (!input.view || prefixes.length === 0) return [];
    const sourceLines = input.file.text.split('\n');
    const out: Mention[] = [];
    for (const prefix of prefixes) {
      for (const found of input.view.imports(prefix)) {
        if (found.line < (input.from ?? 1) || found.line > (input.to ?? Number.MAX_SAFE_INTEGER)) continue;
        out.push({
          reader: IMPORT_EXTRACTOR.id,
          kind: 'includes',
          written: found.written,
          line: found.line,
          quote: (sourceLines[found.line - 1] ?? '').trim(),
          syntax: 'import',
          bare: false,
          confidence: 1,
          import: true,
        });
      }
    }
    return out;
  },
};
