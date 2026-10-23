import { posix } from 'node:path';
import { CLAUDE_CODE_PROFILE, type Link, runtimeProfile } from '@agent-nexus/driftbench-core';
import type { EstateFile, RawEstate } from '../scan/reader';
import type { ExtractInput, Mention, ModuleCandidate, ReferenceExtractor } from './extractor';
import { referenceExtractors, registerReferenceExtractor } from './extractor';
import { referenceRulesOf } from './rules';

/**
 * The rule `module`: a code file points at another file by naming a module its language loads. The extractors read
 * the import statements of a language by its syntax (comments and the contents of strings are not statements), and
 * give each specifier with the files it can lead to by the language's resolution rules. Which of those files exists
 * is for the graph to say.
 *
 * - Python: `import a.b`, `from a import b`, `from .a import b`, `from . import b`. A module is `name.py` or
 *   `name/__init__.py`, looked for from the folder of the importing file (the script folder is on the path) and from
 *   the folders above it, or, for a relative import, from the package folder the dots name. Importing a module
 *   also runs the `__init__.py` of each package above it.
 * - JavaScript and TypeScript: `import ... from`, `import '...'`, `import(...)`, `export ... from`, `require(...)`. A
 *   specifier that starts with `./` or `../` is a path from the importing file; `./a.js` may be `a.ts`; a missing
 *   extension is tried; a folder leads to its `index` file. A bare specifier is a package, and leads to no file here.
 */

const PY = /\.py$/i;
const JS = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;
const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json'];
/** A source extension and the TypeScript sources a compiled name may stand for. */
const COMPILED: Record<string, readonly string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

// ---------------------------------------------------------------------------------------------------------------------
// Python

/** The text with comments and the contents of strings blanked, newlines and positions kept. */
export function blankPython(text: string): string {
  const out = text.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (text[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '#') {
      let j = i;
      while (j < text.length && text[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
    } else if (c === '"' || c === "'") {
      const quote = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text.startsWith(quote, j)) {
          j += quote.length;
          break;
        }
        // A string with one quote ends at its line.
        if (quote.length === 1 && text[j] === '\n') break;
        j += 1;
      }
      blank(i, Math.min(j, text.length));
      i = j;
    } else i += 1;
  }
  return out.join('');
}

function climb(folder: string, steps: number): string {
  let out = folder;
  for (let k = 0; k < steps; k += 1) out = posix.dirname(out);
  return out;
}

function ancestorsOf(folder: string): string[] {
  const found = [folder];
  for (let current = folder; current !== '.' && current !== '/'; ) {
    current = posix.dirname(current);
    found.push(current);
  }
  return found;
}

/** The files a Python module can be, from the bases it is looked for in, with the packages that run beside it. */
function pythonCandidates(file: string, dots: number, dotted: string): ModuleCandidate[] {
  const folder = posix.dirname(file);
  const bases = dots === 0 ? ancestorsOf(folder) : [climb(folder, dots - 1)];
  const parts = dotted === '' ? [] : dotted.split('.');
  const found: ModuleCandidate[] = [];
  for (const base of bases) {
    const above: string[] = [];
    // The package of a relative import runs too, and the package of each name above the module.
    if (dots > 0) above.push(posix.join(base, '__init__.py'));
    for (let k = 1; k < parts.length; k += 1)
      above.push(posix.join(base, ...parts.slice(0, k), '__init__.py'));
    if (parts.length === 0) found.push({ path: posix.join(base, '__init__.py') });
    else {
      const stem = posix.join(base, ...parts);
      found.push(
        { path: `${stem}.py`, companions: above },
        { path: `${stem}/__init__.py`, companions: above },
      );
    }
  }
  return found.map((candidate) => ({ ...candidate, path: posix.normalize(candidate.path) }));
}

const PY_IMPORT =
  /(?:^|[;:])[ \t]*import[ \t]+([A-Za-z_][\w.]*(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[A-Za-z_][\w.]*(?:[ \t]+as[ \t]+\w+)?)*)/gm;
const PY_FROM = /(?:^|[;:])[ \t]*from[ \t]+(\.*)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+(\([^)]*\)|[^\n;]*)/gm;

export function pythonImports(file: EstateFile): Mention[] {
  const blank = blankPython(file.text);
  const base = {
    reader: 'module-python',
    kind: 'includes' as const,
    syntax: 'module',
    bare: false,
    import: true,
  };
  const out: Mention[] = [];
  const add = (offset: number, written: string, dots: number, dotted: string, optional: boolean) =>
    out.push({
      ...base,
      written,
      line: lineOf(blank, offset),
      quote: (file.text.split('\n')[lineOf(blank, offset) - 1] ?? '').trim(),
      confidence: 1,
      candidates: pythonCandidates(file.path, dots, dotted),
      ...(optional ? { optional } : {}),
    });
  for (const match of blank.matchAll(PY_IMPORT)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0] ?? '';
      if (/^[A-Za-z_][\w.]*$/.test(name)) add(match.index ?? 0, name, 0, name, false);
    }
  }
  for (const match of blank.matchAll(PY_FROM)) {
    const dots = (match[1] ?? '').length;
    const module = match[2] ?? '';
    const written = `${'.'.repeat(dots)}${module}`;
    // `from . import m` names the package itself; `from a import b` names the module a, and b if b is a module.
    add(match.index ?? 0, written, dots, module, module === '');
    const names = (match[3] ?? '')
      .replace(/[()]/g, ' ')
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0] ?? '')
      .filter((name) => /^[A-Za-z_]\w*$/.test(name));
    for (const name of names)
      add(
        match.index ?? 0,
        `${written}${module === '' ? '' : '.'}${name}`,
        dots,
        module === '' ? name : `${module}.${name}`,
        true,
      );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// JavaScript and TypeScript

type Token = { kind: 'word' | 'string' | 'template' | 'punct'; value: string; offset: number };

const REGEX_AFTER = new Set([
  'return',
  'typeof',
  'in',
  'of',
  'delete',
  'void',
  'instanceof',
  'new',
  'case',
  'else',
  'do',
  'yield',
  'await',
]);

/** Tokens of a script with its comments left out; a string keeps its value. A `/` is a regex or a division by what precedes. */
export function tokenizeScript(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? '';
    if (/\s/.test(c)) {
      i += 1;
    } else if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== c && text[j] !== '\n') {
        if (text[j] === '\\') {
          value += text[j + 1] ?? '';
          j += 2;
        } else {
          value += text[j];
          j += 1;
        }
      }
      tokens.push({ kind: 'string', value, offset: i });
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (depth === 0 && text[j] === '`') break;
        else if (text.startsWith('${', j)) {
          depth += 1;
          j += 2;
        } else if (depth > 0 && text[j] === '}') {
          depth -= 1;
          j += 1;
        } else j += 1;
      }
      tokens.push({ kind: 'template', value: '', offset: i });
      i = j + 1;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < text.length && /[\w$]/.test(text[j] ?? '')) j += 1;
      tokens.push({ kind: 'word', value: text.slice(i, j), offset: i });
      i = j;
    } else if (/\d/.test(c)) {
      let j = i;
      while (j < text.length && /[\w.]/.test(text[j] ?? '')) j += 1;
      tokens.push({ kind: 'word', value: text.slice(i, j), offset: i });
      i = j;
    } else if (c === '/') {
      const last = tokens[tokens.length - 1];
      const regex =
        last === undefined ||
        (last.kind === 'punct' && ![')', ']', '}'].includes(last.value)) ||
        (last.kind === 'word' && REGEX_AFTER.has(last.value));
      if (regex) {
        let j = i + 1;
        let inClass = false;
        while (j < text.length && text[j] !== '\n') {
          if (text[j] === '\\') j += 2;
          else if (text[j] === '[') {
            inClass = true;
            j += 1;
          } else if (text[j] === ']') {
            inClass = false;
            j += 1;
          } else if (text[j] === '/' && !inClass) break;
          else j += 1;
        }
        i = j + 1;
        while (i < text.length && /[a-z]/i.test(text[i] ?? '')) i += 1;
        tokens.push({ kind: 'template', value: '', offset: i });
      } else {
        tokens.push({ kind: 'punct', value: '/', offset: i });
        i += 1;
      }
    } else {
      tokens.push({ kind: 'punct', value: c, offset: i });
      i += 1;
    }
  }
  return tokens;
}

const DECLARATION = new Set([
  'const',
  'let',
  'var',
  'function',
  'class',
  'default',
  'interface',
  'enum',
  'namespace',
  'declare',
  'abstract',
  'async',
  'type',
]);

/** The specifiers an `import`, `export ... from`, dynamic `import()` or `require()` of a script names, with their offsets. */
export function scriptSpecifiers(text: string): Array<{ specifier: string; offset: number }> {
  const tokens = tokenizeScript(text);
  const found: Array<{ specifier: string; offset: number }> = [];
  const wordAt = (index: number, value: string) =>
    tokens[index]?.kind === 'word' && tokens[index]?.value === value;
  const punctAt = (index: number, value: string) =>
    tokens[index]?.kind === 'punct' && tokens[index]?.value === value;
  const stringAt = (index: number) => (tokens[index]?.kind === 'string' ? tokens[index] : undefined);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token?.kind !== 'word' || punctAt(i - 1, '.')) continue;
    if (token.value === 'require' && punctAt(i + 1, '(')) {
      const spec = stringAt(i + 2);
      if (spec) found.push({ specifier: spec.value, offset: token.offset });
    } else if (token.value === 'import') {
      const next = stringAt(i + 1);
      if (next) {
        found.push({ specifier: next.value, offset: token.offset });
      } else if (punctAt(i + 1, '(')) {
        const spec = stringAt(i + 2);
        if (spec) found.push({ specifier: spec.value, offset: token.offset });
      } else if (!punctAt(i + 1, '.')) {
        for (let j = i + 1; j < tokens.length && j - i < 400 && !punctAt(j, ';'); j += 1) {
          if (wordAt(j, 'from') && stringAt(j + 1)) {
            found.push({ specifier: stringAt(j + 1)?.value ?? '', offset: token.offset });
            break;
          }
          if (wordAt(j, 'import')) break;
        }
      }
    } else if (token.value === 'export') {
      if (
        tokens[i + 1]?.kind === 'word' &&
        DECLARATION.has(tokens[i + 1]?.value ?? '') &&
        !wordAt(i + 1, 'type')
      )
        continue;
      for (let j = i + 1; j < tokens.length && j - i < 400 && !punctAt(j, ';'); j += 1) {
        if (wordAt(j, 'from') && stringAt(j + 1)) {
          found.push({ specifier: stringAt(j + 1)?.value ?? '', offset: token.offset });
          break;
        }
        if (wordAt(j, 'export') || wordAt(j, 'import')) break;
      }
    }
  }
  return found;
}

/** The files a relative specifier can lead to, in the order a loader tries them. */
function scriptCandidates(file: string, specifier: string): ModuleCandidate[] {
  const place = posix.normalize(posix.join(posix.dirname(file), specifier));
  const extension = posix.extname(place);
  const paths = [place];
  for (const source of COMPILED[extension] ?? []) paths.push(place.slice(0, -extension.length) + source);
  for (const ext of JS_EXTENSIONS) paths.push(`${place}${ext}`);
  for (const ext of JS_EXTENSIONS) paths.push(`${place}/index${ext}`);
  return [...new Set(paths)].map((path) => ({ path }));
}

export function scriptImports(file: EstateFile): Mention[] {
  const lines = file.text.split('\n');
  const out: Mention[] = [];
  for (const found of scriptSpecifiers(file.text)) {
    const relative =
      found.specifier === '.' || found.specifier === '..' || /^\.{1,2}\//.test(found.specifier);
    const line = lineOf(file.text, found.offset);
    out.push({
      reader: 'module-javascript',
      kind: 'includes',
      written: found.specifier,
      line,
      quote: (lines[line - 1] ?? '').trim(),
      syntax: 'module',
      bare: false,
      confidence: 1,
      import: true,
      ...(relative ? { candidates: scriptCandidates(file.path, found.specifier) } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The extractors, and the module graph

export const PYTHON_MODULE_EXTRACTOR: ReferenceExtractor = {
  id: 'module-python',
  rule: 'module',
  extract: ({ file }: ExtractInput) => (PY.test(file.path) ? pythonImports(file) : []),
};

export const JAVASCRIPT_MODULE_EXTRACTOR: ReferenceExtractor = {
  id: 'module-javascript',
  rule: 'module',
  extract: ({ file }: ExtractInput) => (JS.test(file.path) ? scriptImports(file) : []),
};

registerReferenceExtractor(PYTHON_MODULE_EXTRACTOR);
registerReferenceExtractor(JAVASCRIPT_MODULE_EXTRACTOR);

/** A module import read from a file: a link to the file it leads to, or an import no file of the estate answers. */
export type ModuleEntry = {
  mention: Mention;
  from: string;
  outcome: 'resolved' | 'unresolved';
  /** The file it leads to, or the specifier as written when it leads to none. */
  path: string;
  link?: Link;
};

/** Why an import leads to no file: it names a library, or a file the estate does not hold. */
export const MODULE_NOT_IN_ESTATE = 'module-not-in-estate';

const MEMO = new WeakMap<readonly EstateFile[], ModuleEntry[]>();

/**
 * The module imports of the code files of an estate whose part type reads the rule `module`, resolved against the
 * files of the estate. A package whose `__init__` runs with the module is linked too. An import that leads to no
 * file is kept as unresolved, never a finding: a library has no file here.
 */
export function moduleEntries(raw: Pick<RawEstate, 'files' | 'runtime'>): ModuleEntry[] {
  const known = MEMO.get(raw.files);
  if (known) return known;
  const profile = runtimeProfile(raw.runtime) ?? CLAUDE_CODE_PROFILE;
  const extractors = referenceExtractors('module');
  const paths = new Set(raw.files.map((file) => file.path));
  const entries: ModuleEntry[] = [];
  const seen = new Set<string>();
  for (const file of raw.files) {
    const rules = referenceRulesOf(profile, file.path);
    if (!rules.some((rule) => rule.by === 'module')) continue;
    for (const extractor of extractors) {
      for (const mention of extractor.extract({ file, lines: [], rules, profile })) {
        const key = `${extractor.id}\0${file.path}\0${mention.line}\0${mention.written}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const hit = (mention.candidates ?? []).find(
          (candidate) => paths.has(candidate.path) && candidate.path !== file.path,
        );
        const link = (to: string, confidence: number): Link => ({
          from: file.path,
          to,
          kind: mention.kind,
          provenance: { reader: mention.reader, file: file.path, line: mention.line },
          confidence,
        });
        if (hit) {
          entries.push({
            mention,
            from: file.path,
            outcome: 'resolved',
            path: hit.path,
            link: link(hit.path, mention.confidence),
          });
          for (const companion of hit.companions ?? [])
            if (paths.has(companion) && companion !== file.path)
              entries.push({
                mention: { ...mention, written: companion },
                from: file.path,
                outcome: 'resolved',
                path: companion,
                link: link(companion, mention.confidence * 0.8),
              });
        } else if (!mention.optional) {
          entries.push({ mention, from: file.path, outcome: 'unresolved', path: mention.written });
        }
      }
    }
  }
  MEMO.set(raw.files, entries);
  return entries;
}
