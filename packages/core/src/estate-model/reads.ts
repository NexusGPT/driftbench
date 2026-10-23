import { type CompiledGlob, compileGlob, type GlobError } from './glob';
import { LOAD_TIMES, type Loaded, type LoadTime } from './vocabulary';

/**
 * The small grammars a part type is written in: where its parts are (a locator), how a field is read (a field
 * read), when it loads, and how it points at other parts. Each is syntax, never a word list: a locator is a glob
 * and a JSON path, a field read is a JSON path, a frontmatter key, a section heading or a name of the part.
 */

/** One step of a JSON path: a key, an index, or any key or index (`*`). */
export type JsonStep = { key: string } | { index: number } | { any: true };

/** Why a JSON path was refused. */
export type JsonPathError = 'json-path-start' | 'json-path-step';

/**
 * Parses a JSON path: `$`, then `.key`, `.*`, `[0]`, `[*]` or `["key"]` steps. A key written after a dot holds
 * letters, digits, `_`, `-` and `$`; any other key is quoted in brackets.
 */
export function parseJsonPath(
  text: string,
): { ok: true; steps: JsonStep[] } | { ok: false; error: JsonPathError } {
  if (!text.startsWith('$')) return { ok: false, error: 'json-path-start' };
  const steps: JsonStep[] = [];
  let rest = text.slice(1);
  while (rest !== '') {
    const any = /^(?:\.\*|\[\*\])/.exec(rest);
    const index = /^\[(\d+)\]/.exec(rest);
    const key =
      /^\.([A-Za-z0-9_$-]+)/.exec(rest) ??
      /^\["((?:[^"\\]|\\.)+)"\]/.exec(rest) ??
      /^\['((?:[^'\\]|\\.)+)'\]/.exec(rest);
    if (any) steps.push({ any: true });
    else if (index) steps.push({ index: Number(index[1]) });
    else if (key) steps.push({ key: (key[1] as string).replace(/\\(.)/g, '$1') });
    else return { ok: false, error: 'json-path-step' };
    rest = rest.slice(((any ?? index ?? key) as RegExpExecArray)[0].length);
  }
  return { ok: true, steps };
}

/** Every value a JSON path selects in a parsed document, in document order. */
export function selectJson(value: unknown, steps: readonly JsonStep[]): unknown[] {
  let current: unknown[] = [value];
  for (const step of steps) {
    const next: unknown[] = [];
    for (const item of current) {
      if ('any' in step) {
        if (Array.isArray(item)) next.push(...item);
        else if (item !== null && typeof item === 'object') next.push(...Object.values(item));
      } else if ('index' in step) {
        if (Array.isArray(item) && step.index < item.length) next.push(item[step.index]);
      } else if (item !== null && typeof item === 'object' && !Array.isArray(item) && step.key in item) {
        next.push((item as Record<string, unknown>)[step.key]);
      }
    }
    current = next;
  }
  return current;
}

/**
 * Where a type's parts are: files (or folders, for a glob ending in `/`) a glob matches, or the entries a JSON
 * path selects inside each matched file (`settings.json#$.hooks.*`).
 */
export type Locator = { glob: CompiledGlob; entries?: JsonStep[]; written: string };

export type LocatorError = GlobError | JsonPathError | 'folder-entries';

/** Parses a locator: a glob, optionally followed by `#` and a JSON path that starts with `$`. */
export function parseLocator(
  text: string,
): { ok: true; locator: Locator } | { ok: false; error: LocatorError } {
  const at = text.indexOf('#$');
  const globText = at < 0 ? text : text.slice(0, at);
  const glob = compileGlob(globText);
  if (!glob.ok) return glob;
  if (at < 0) return { ok: true, locator: { glob: glob.glob, written: text } };
  if (glob.glob.folder) return { ok: false, error: 'folder-entries' };
  const path = parseJsonPath(text.slice(at + 1));
  if (!path.ok) return path;
  return { ok: true, locator: { glob: glob.glob, entries: path.steps, written: text } };
}

/**
 * How one field of a part is read:
 * - `$.a.b`: a JSON path into a structured file (JSON or YAML) or into the entry a locator selected;
 * - `frontmatter.a`: a key of a markdown file's frontmatter (a dotted path for a nested key);
 * - `section(Heading)`: the text under a markdown heading, to the next heading of the same or a higher level;
 * - `body`: the text after the frontmatter; `text`: the whole text;
 * - `file-name`: the file name without its last extension; `folder-name`: the name of the part's folder;
 * - `match`: what the last `*` of the locating glob matched.
 */
export type FieldRead =
  | { from: 'json'; path: JsonStep[] }
  | { from: 'frontmatter'; path: JsonStep[] }
  | { from: 'section'; heading: string }
  | { from: 'body' | 'text' | 'file-name' | 'folder-name' | 'match' };

export type FieldReadError = JsonPathError | 'field-read' | 'section-heading';

const PLAIN_READS = ['body', 'text', 'file-name', 'folder-name', 'match'] as const;

export function parseFieldRead(
  text: string,
): { ok: true; read: FieldRead } | { ok: false; error: FieldReadError } {
  if (text.startsWith('$')) {
    const path = parseJsonPath(text);
    return path.ok ? { ok: true, read: { from: 'json', path: path.steps } } : path;
  }
  if (text.startsWith('frontmatter.')) {
    const path = parseJsonPath(`$${text.slice('frontmatter'.length)}`);
    return path.ok ? { ok: true, read: { from: 'frontmatter', path: path.steps } } : path;
  }
  const section = /^section\((.*)\)$/s.exec(text);
  if (section) {
    const heading = (section[1] ?? '').trim();
    if (heading === '' || /[\r\n]/.test(heading)) return { ok: false, error: 'section-heading' };
    return { ok: true, read: { from: 'section', heading } };
  }
  const plain = PLAIN_READS.find((name) => name === text);
  return plain ? { ok: true, read: { from: plain } } : { ok: false, error: 'field-read' };
}

/** Parses a load time: one of `LOAD_TIMES`, or `on-event(<event>)` naming the event. */
export function parseLoaded(text: string): Loaded | undefined {
  const event = /^on-event\(([A-Za-z][\w.:-]*)\)$/.exec(text);
  if (event) return { when: 'on-event', event: event[1] as string };
  return (LOAD_TIMES as readonly string[]).includes(text) ? { when: text as LoadTime } : undefined;
}

/** The written form of a load time, as `parseLoaded` reads it. */
export function loadedText(loaded: Loaded): string {
  return loaded.event === undefined ? loaded.when : `${loaded.when}(${loaded.event})`;
}

/**
 * How a part points at other parts: by a path written in its text (`path`), by a line that starts with a prefix
 * and imports a file (`import(@)`), by another part's name (`name`), or by the module a code file imports
 * (`module`: a Python `import`, a JavaScript `import` or `require`, resolved by the rules of the file's language).
 */
export type ReferenceRule =
  | { by: 'path' }
  | { by: 'name' }
  | { by: 'module' }
  | { by: 'import'; prefix: string };

export function parseReferenceRule(text: string): ReferenceRule | undefined {
  if (text === 'path' || text === 'name' || text === 'module') return { by: text };
  const prefix = /^import\(([^\s()]{1,3})\)$/.exec(text);
  return prefix ? { by: 'import', prefix: prefix[1] as string } : undefined;
}

/** The written form of a reference rule. */
export function referenceRuleText(rule: ReferenceRule): string {
  return rule.by === 'import' ? `import(${rule.prefix})` : rule.by;
}
