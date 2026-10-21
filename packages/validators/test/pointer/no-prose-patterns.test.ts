import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The rule of the pointer bank (codex review of PR 1099): the seeded Prose generator returns what it wrote and
 * where (kit/words.ts registers the words of every text it returns), and nothing in the bank reads or edits prose
 * by matching its letters with a pattern. This guard reads every source file under the bank, kit, blind and sut
 * folders and fails on:
 * - a regular expression that matches letters or words: `\w`, `\W`, `\b`, `\B`, `\S`, `\p{..}`, `\P{..}`, or a
 *   character class that names a letter (`[a-z]`, `[aeo]`, `[^A-Za-z0-9]`), as a literal or built with RegExp;
 * - a word split: `split` on a string holding a space, or on a regular expression that matches a space or a letter;
 * - any `search`, `match` or `matchAll` call.
 * A site that reads text the generator did not write (the reader's own output, request bodies, source code, ids,
 * the vocabulary constants) is allowed only by a named entry below, with its reason; an entry that no longer
 * matches a site fails too, so the list stays exact.
 */

const ROOT = fileURLToPath(new URL('../../src/ladders/pointer/', import.meta.url));
const FOLDERS = ['bank', 'kit', 'blind', 'sut'];

type Finding = { file: string; line: number; text: string; why: string };
/** `contains` empty: every finding of the file. */
type Allowance = { file: string; contains: string; reason: string };

const ALLOWED: Allowance[] = [
  {
    file: 'kit/words.ts',
    contains: 'text.trim().split(/\\s+/)',
    reason: 'the generator splits its own vocabulary constants into words; no prose is read',
  },
  {
    file: 'kit/compose.ts',
    contains: ".split(' ')",
    reason:
      'the composer lays a text out at its spaces (wrapping, hard breaks): it changes and picks no word, and the truth it returns holds the text unchanged',
  },
  {
    file: 'kit/norm.ts',
    contains: '[\\s\\S]',
    reason: '`[\\s\\S]` matches any character: it unquotes a quoted value and reads no letter',
  },
  {
    file: 'kit/transport.ts',
    contains: '',
    reason: 'reads the request body the READER sent to the labeller (label names, the WINDOW line), not prose',
  },
  {
    file: 'kit/child.ts',
    contains: '[tj]s$/',
    reason: 'matches the path of the running script, not prose',
  },
  {
    file: 'bank/reader-imports.ts',
    contains: '',
    reason: "reads the READER's source code for its imports, not prose",
  },
  {
    file: 'bank/families/ids.ts',
    contains: '/^[0-9a-z]{10}$/',
    reason: "checks the shape of an id the READER minted, not prose",
  },
  {
    file: 'bank/families/ids.ts',
    contains: '/\\b1[5-9]\\d{11}\\b/',
    reason: 'looks for an epoch time in the ledger the READER wrote, not prose',
  },
  {
    file: 'bank/families/privacy.ts',
    contains: '/^[0-9a-f]+$/',
    reason:
      "skips the 8-character slices of a planted text that a hex fingerprint could also hold: it tests the hex alphabet of the READER's fingerprints, picks no word and changes nothing",
  },
  {
    file: 'bank/families/replay.ts',
    contains: '/[^a-z0-9.]/g',
    reason: 'normalises the keys of a JSON object (a request part name), not prose',
  },
  {
    file: 'bank/families/replay.ts',
    contains: 'new RegExp(`(^|[^A-Za-z0-9_-])',
    reason: "finds a token (a field name) whole in the error message the READER wrote, not prose",
  },
  {
    file: 'bank/families/replay.ts',
    contains: '/^[0-9a-f]{64}$/',
    reason: 'checks that the cassette keys the READER wrote are 64 hex characters, not prose',
  },
  {
    file: 'bank/families/labels.ts',
    contains: '/^WINDOW \\S+#\\d+/',
    reason: 'reads the WINDOW line of the request the READER sent to the labeller, not prose',
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    contains: 'text.matchAll(/ /g)',
    reason:
      'the offsets of the spaces of a sentence the item wrote itself from a fixed template and drawn nouns: a space is not a letter and no word is read',
  },
  {
    file: 'bank/families/hardening-bugs-d.ts',
    contains: '.split(/[,\\s]+/)',
    reason: 'splits the field list of an error message the READER wrote, not prose',
  },
  {
    file: 'blind/bank/identity.ts',
    contains: '/^[a-z2-7]{10}$/',
    reason: 'checks the shape of an id the READER minted, not prose',
  },
  {
    file: 'blind/bank/identity.ts',
    contains: ".replace('.', '').split(' ')",
    reason:
      'splits a grid sentence the item joined itself from its own word arrays (no Prose output), to count shared words',
  },
  {
    file: 'blind/bank/privacy.ts',
    contains: '/\\\\u([0-9a-f]{4})/gi',
    reason: 'decodes the \\u escapes of the serialized ledger the READER wrote, not prose',
  },
  {
    file: 'blind/cheats.ts',
    contains: '',
    reason:
      'the cheating readers the blind bank must catch: reading the text they are given is what a reader does, and no item is built from it',
  },
  {
    file: 'blind/bank.test.ts',
    contains: '',
    reason: "a test file: its assertions read the bank's output and READER ids; it builds no item",
  },
  {
    file: 'sut/blind-binding/replay.ts',
    contains: '',
    reason: "reads the READER's own message (the versions it names), not prose",
  },
];

/** Whether the body of a regular expression matches letters or words (see the file comment). */
export function readsLetters(body: string): boolean {
  let inClass = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (ch === '\\') {
      const next = body[i + 1] ?? '';
      if ('wWSpP'.includes(next) || (!inClass && 'bB'.includes(next))) return true;
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) return true;
    } else if (ch === '[') {
      inClass = true;
      if (body[i + 1] === '^') i += 1;
    }
  }
  return false;
}

/** Whether a split by this regular expression body cuts at spaces or letters. */
const splitsWords = (body: string): boolean => readsLetters(body) || body.includes('\\s') || body.includes(' ');

const regexBody = (literal: string): string => literal.slice(1, literal.lastIndexOf('/'));

/** The static text of a string or template argument, holes left out. */
function staticText(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
  return undefined;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

export function findingsOf(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];
  const add = (node: ts.Node, why: string) =>
    found.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 160),
      why,
    });
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      if (readsLetters(regexBody(node.getText(sf)))) add(node, 'a regular expression that matches letters');
    } else if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
      const callee = node.expression;
      const args = node.arguments ?? ts.factory.createNodeArray();
      if (ts.isIdentifier(callee) && callee.text === 'RegExp') {
        const text = staticText(args[0]);
        if (text === undefined || readsLetters(text)) add(node, 'a RegExp built to match letters');
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        const first = args[0];
        if (name === 'split' && first) {
          const text = staticText(first);
          if (text !== undefined && text.includes(' ')) add(node, 'a split at spaces (word picking)');
          else if (first.kind === ts.SyntaxKind.RegularExpressionLiteral && splitsWords(regexBody(first.getText(sf))))
            add(node, 'a split by a pattern at spaces or letters (word picking)');
        } else if (name === 'search' || name === 'match' || name === 'matchAll') {
          add(node, `a ${name} call`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const allowedBy = (finding: Finding) =>
  ALLOWED.filter((a) => a.file === finding.file && finding.text.includes(a.contains));

describe('no letter pattern on generated prose in the pointer bank', () => {
  const findings = FOLDERS.flatMap((folder) =>
    sourceFiles(join(ROOT, folder)).flatMap((path) =>
      findingsOf(relative(ROOT, path).split('\\').join('/'), readFileSync(path, 'utf8')),
    ),
  );

  it('the classifier tells letter patterns from the others', () => {
    for (const body of ['\\b([a-z]{5,})\\b', '[aeo]', '(\\w+) ', '^(\\S+ \\S+)', '\\p{L}+', '[^A-Za-z0-9_-]'])
      expect(readsLetters(body), body).toBe(true);
    for (const body of ['\\s+', '\\.$', '^[0-9]+$', '^\\s*(```|~~~)', "[^'\"`\\n]+", '[,.;]', '[\\b]'])
      expect(readsLetters(body), body).toBe(false);
    const sample = [
      "const a = t.replace(/\\b([a-z]{5,})\\b/, 'x');",
      "const b = t.split(' ');",
      'const c = t.search(/[aeo]/);',
      'const d = new RegExp(`[^A-Za-z]${x}`);',
      'const e = t.split(/\\s+/);',
      "const f = t.replace(/\\.$/, '').split('|');",
      'const g = t.split(/\\r\\n|\\n/);',
    ].join('\n');
    expect(findingsOf('sample.ts', sample).map((f) => f.line)).toEqual([1, 2, 3, 3, 4, 5]);
  });

  it('finds no site outside the named allowances', () => {
    const open = findings.filter((f) => allowedBy(f).length === 0);
    const listing = open.map((f) => `${f.file}:${f.line}: ${f.why}: ${f.text}`).join('\n');
    expect(open, `letter patterns or word splits on prose:\n${listing}`).toEqual([]);
  });

  it('every allowance still names a site', () => {
    const stale = ALLOWED.filter((a) => !findings.some((f) => allowedBy(f).includes(a)));
    expect(stale.map((a) => `${a.file}: ${a.contains}`)).toEqual([]);
  });
});
