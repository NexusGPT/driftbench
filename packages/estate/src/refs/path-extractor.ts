import { pathMentions } from '../scan/code';
import type { ExtractInput, Mention, ReferenceExtractor } from './extractor';

/**
 * The rule `path`: a part points at a file by writing its path, in one of the notations of a document: a code span,
 * a link destination, a quoted name, a wiki link, an angle or bold name, or a loose word that is a path by its
 * syntax (a folder separator, or an extension of letters). A path in a table cell is a code span or a link inside a
 * cell, so it is read like any other. A fenced block is an example and is blanked before the line reaches the
 * extractor. A placeholder, a glob, a URL and a command are no path (`pathMentions`).
 *
 * A path the file's type reads as an import (`import(@)`) is the import extractor's, not this one's.
 */
export const PATH_EXTRACTOR: ReferenceExtractor = {
  id: 'path-syntax',
  rule: 'path',
  extract(input: ExtractInput): Mention[] {
    const prefixes = input.rules.flatMap((rule) => (rule.by === 'import' ? [rule.prefix] : []));
    const out: Mention[] = [];
    for (const line of input.lines) {
      for (const found of pathMentions(line.text)) {
        if (prefixes.some((prefix) => found.spelling.startsWith(prefix))) continue;
        out.push({
          reader: PATH_EXTRACTOR.id,
          kind: 'references',
          written: found.path,
          line: line.line,
          quote: line.quote,
          syntax: found.syntax,
          bare: found.bare,
          confidence: CONFIDENCE[found.syntax] ?? 0.6,
          import: false,
        });
      }
    }
    return out;
  },
};

/** A notation that delimits the path (a span, a link, a quote) is read from structure; a loose word is inferred. */
const CONFIDENCE: Record<string, number> = {
  'code-span': 1,
  link: 1,
  quoted: 0.9,
  wiki: 0.9,
  angle: 0.9,
  bold: 0.8,
  loose: 0.6,
};
