import { codeSpanRanges } from '../scan/code';
import type { ExtractInput, Mention, ReferenceExtractor } from './extractor';

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

/** One import found in a line: the path as written, unescaped, and where the prefix stands. */
export type ImportMention = { written: string; at: number };

/** A path ends here: sentence punctuation after it is not part of its name. */
const TRAILING = /[.,;:!?]+$/;

export function importMentions(line: string, prefix: string): ImportMention[] {
  const spans = codeSpanRanges(line);
  const found: ImportMention[] = [];
  let from = 0;
  for (;;) {
    const at = line.indexOf(prefix, from);
    if (at < 0) break;
    from = at + prefix.length;
    if (at > 0 && !/\s/.test(line[at - 1] ?? '')) continue;
    if (spans.some(([start, end]) => at >= start && at < end)) continue;
    let end = from;
    while (end < line.length) {
      if (line[end] === '\\' && line[end + 1] === ' ') {
        end += 2;
        continue;
      }
      if (/\s/.test(line[end] ?? '')) break;
      end++;
    }
    const raw = line.slice(from, end);
    // A quoted path is not an import, with or without the backslashes.
    if (raw === '' || /^["'`]/.test(raw)) continue;
    const written = raw.replace(/\\ /g, ' ').replace(TRAILING, '');
    if (written === '') continue;
    found.push({ written, at });
    from = end;
  }
  return found;
}

export const IMPORT_EXTRACTOR: ReferenceExtractor = {
  id: 'import-prefix',
  rule: 'import',
  extract(input: ExtractInput): Mention[] {
    const prefixes = input.rules.flatMap((rule) => (rule.by === 'import' ? [rule.prefix] : []));
    const out: Mention[] = [];
    for (const line of input.lines) {
      for (const prefix of prefixes) {
        for (const found of importMentions(line.text, prefix)) {
          out.push({
            reader: IMPORT_EXTRACTOR.id,
            kind: 'includes',
            written: found.written,
            line: line.line,
            quote: line.quote,
            syntax: 'import',
            bare: false,
            confidence: 1,
            import: true,
          });
        }
      }
    }
    return out;
  },
};
