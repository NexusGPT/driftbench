import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import ts from 'typescript';
import { COMMAND_MODULES } from '../../packages/cli/src/command-index';
import { type HelpTopic, loadHelpTopics } from '../../packages/cli/src/help-topics';
import { fullProgram } from '../../packages/cli/src/main';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export type CoverageRow = { kind: 'command' | 'flag' | 'error'; item: string; topics: string[] };
export function section(body: string, name: string): string {
  return body.split(`## ${name}\n`)[1]?.split('\n## ')[0] ?? '';
}
export async function registeredProgram(): Promise<Command> {
  return fullProgram(
    await Promise.all(COMMAND_MODULES.map((m) => m.load())),
    { cwd: ROOT, out: () => {}, err: () => {} },
    () => {},
  );
}

/** Find exported error registries in every package, including registries added later. */
export function registeredErrors(root = join(ROOT, 'packages')): string[] {
  const codes = new Set<string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (
          !ts.isVariableStatement(statement) ||
          !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        )
          continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!/(?:Issue|Warning|Error)Codes$/.test(declaration.name.getText(source))) continue;
          let value = declaration.initializer;
          while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)))
            value = value.expression;
          if (!value || !ts.isArrayLiteralExpression(value))
            throw new Error(`Unrecognised error registry: ${path}`);
          for (const element of value.elements) {
            if (!ts.isStringLiteral(element)) throw new Error(`Nonliteral error code: ${path}`);
            codes.add(element.text);
          }
        }
      }
    }
  };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) visit(join(root, entry.name, 'src'));
  }
  return [...codes].sort();
}

export function coverageRows(program: Command, topics: HelpTopic[], codes: string[]): CoverageRow[] {
  const rows: CoverageRow[] = [];
  const walk = (command: Command, path: string[]) => {
    const name = path.join(' ');
    const own = topics.filter((t) =>
      name === '' ? t.id === 'core-global-options' : t.commands.includes(name),
    );
    if (
      name &&
      (command.commands.length === 0 || (command as unknown as { _actionHandler?: unknown })._actionHandler)
    ) {
      rows.push({
        kind: 'command',
        item: name,
        topics: own
          .filter((t) => section(t.body, t.area === 'recipes' ? 'Steps' : 'Commands and every option').trim())
          .map((t) => t.id),
      });
    }
    // A command may share its options with a directly linked reference topic.
    const references = topics.filter((t) => own.some((o) => o.see_also.includes(t.id)));
    for (const option of command.options) {
      const flag = option.long ?? option.short;
      if (!flag) continue;
      rows.push({
        kind: 'flag',
        item: `${name || '(global)'} ${flag}`,
        topics: [...own, ...references]
          .filter((t) => {
            const text = section(t.body, t.area === 'recipes' ? 'Steps' : 'Commands and every option');
            return [option.long, option.short]
              .filter((alias): alias is string => alias !== undefined)
              .every((alias) => new RegExp(`${alias}(?=[\\s\x60<,=]|$)`).test(text));
          })
          .map((t) => t.id),
      });
    }
    for (const child of command.commands) walk(child, [...path, child.name()]);
  };
  walk(program, []);
  rows.push({
    kind: 'command',
    item: 'help',
    topics: topics.filter((t) => t.commands.includes('help')).map((t) => t.id),
  });
  for (const code of codes)
    rows.push({
      kind: 'error',
      item: code,
      topics: topics
        .filter((t) =>
          section(t.body, t.area === 'recipes' ? 'When a step fails' : 'Common errors').includes(
            `\x60${code}\x60`,
          ),
        )
        .map((t) => t.id),
    });
  return rows;
}
export async function currentCoverage(): Promise<CoverageRow[]> {
  return coverageRows(await registeredProgram(), loadHelpTopics(), registeredErrors());
}

/** One object of a Zod schema tree: the dotted path from the root, and the keys it declares. */
export type SchemaObject = { path: string; keys: string[] };
type ZodNode = { _zod?: { def?: ZodDef }; def?: ZodDef };
type ZodDef = {
  type?: string;
  innerType?: ZodNode;
  element?: ZodNode;
  in?: ZodNode;
  valueType?: ZodNode;
  options?: ZodNode[];
  shape?: Record<string, ZodNode>;
  getter?: () => ZodNode;
};

/**
 * Every object of a schema tree, found by reading the live Zod definition, so a key added to a schema is
 * listed here without any hand-kept table. Arrays add `[]` to the path, records `{}`. A union lists the
 * keys of all its options under one path.
 */
export function schemaObjects(root: unknown, rootName = '(root)'): SchemaObject[] {
  const found = new Map<string, string[]>();
  const visit = (node: ZodNode | undefined, path: string, seen: Set<ZodNode>, depth: number): void => {
    if (!node || depth > 14) return;
    const def = node._zod?.def ?? node.def;
    switch (def?.type) {
      case 'optional':
      case 'nullable':
      case 'default':
      case 'readonly':
      case 'catch':
      case 'prefault': {
        visit(def.innerType, path, seen, depth + 1);
        return;
      }
      case 'array': {
        visit(def.element, `${path}[]`, seen, depth + 1);
        return;
      }
      case 'pipe': {
        visit(def.in, path, seen, depth + 1);
        return;
      }
      case 'lazy': {
        visit(def.getter?.(), path, seen, depth + 1);
        return;
      }
      case 'record': {
        visit(def.valueType, `${path}{}`, seen, depth + 1);
        return;
      }
      case 'union':
        for (const option of def.options ?? []) visit(option, path, seen, depth + 1);
        return;
      case 'object': {
        if (seen.has(node)) return;
        const keys = Object.keys(def.shape ?? {});
        const name = path || rootName;
        found.set(name, [...new Set([...(found.get(name) ?? []), ...keys])]);
        const inside = new Set(seen).add(node);
        for (const [key, child] of Object.entries(def.shape ?? {}))
          visit(child, path ? `${path}.${key}` : key, inside, depth + 1);
        return;
      }
      default:
    }
  };
  visit(root as ZodNode, '', new Set(), 0);
  return [...found].map(([path, keys]) => ({ path, keys }));
}

/** The code of a topic text: fenced blocks and inline code spans. A key counts as named only inside code. */
function codeOf(text: string): string {
  const fences = [...text.matchAll(/^\x60\x60\x60[^\n]*\n([\s\S]*?)^\x60\x60\x60/gm)].map((m) => m[1] ?? '');
  const inline = [
    ...text.replace(/^\x60\x60\x60[\s\S]*?^\x60\x60\x60/gm, '').matchAll(/\x60([^\x60\n]+)\x60/g),
  ].map((m) => m[1] ?? '');
  return [...fences, ...inline].join('\n');
}

/** True when `text` names `key` in code: a code span such as `key`, `a.key` or `{ key?, other }`, or a code block. */
export function documentsKey(text: string, key: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${key}(?![A-Za-z0-9_])`).test(codeOf(text));
}

/**
 * A piece of a topic that documents one object. `section` is a heading and its text; only the first cell of a table
 * row counts there, since a row of another object may name the same word. `table` is a whole table with the label
 * line before it (a line ending in a colon that names the object). `row` is one table row, which documents an
 * object kept inside one entry of its parent. `paragraph` is a paragraph an override points at.
 */
export type DocUnit = {
  topic: string;
  kind: 'section' | 'table' | 'row' | 'paragraph';
  where: string;
  text: string;
};

/** Where an object is documented when no heading, label or row of its own key says so. */
export type UnitOverride = {
  topic: string;
  /** A heading's exact text: its section, with only the first cell of each table row. */
  heading?: string;
  /** The start of a paragraph. */
  paragraph?: string;
  /** The start of the label line of a table: the whole table. */
  label?: string;
  /** The key a table row opens with: that row. */
  row?: string;
};

const firstCell = (row: string) => row.replace(/^\|/, '').split('|')[0] ?? '';
const spansOf = (line: string) =>
  [...line.matchAll(/\x60([^\x60\n]+)\x60/g)].map((m) => (m[1] ?? '').replace(/\[\]|\{\}/g, ''));
const namesObject = (line: string, name: string) =>
  spansOf(line).some((span) => span === name || span.endsWith(`.${name}`));

type Parsed = {
  lines: string[];
  fenced: boolean[];
  headings: Array<{ at: number; level: number; title: string }>;
};
function parse(topic: HelpTopic): Parsed {
  const lines = topic.body.split('\n');
  let fence = false;
  const fenced = lines.map((line) => {
    const edge = /^\x60\x60\x60/.test(line);
    if (edge) fence = !fence;
    return fence || edge;
  });
  const headings: Parsed['headings'] = [];
  lines.forEach((line, at) => {
    const m = /^(#{2,6}) (.*)$/.exec(line);
    if (m && !fenced[at]) headings.push({ at, level: (m[1] ?? '').length, title: m[2] ?? '' });
  });
  return { lines, fenced, headings };
}

/** A heading's text, with the table rows cut down to their first cell. */
function sectionText({ lines, fenced, headings }: Parsed, index: number): string {
  const heading = headings[index] as Parsed['headings'][number];
  const next = headings.slice(index + 1).find((other) => other.level <= heading.level);
  const prose: string[] = [];
  const cells: string[] = [];
  for (let i = heading.at + 1; i < (next?.at ?? lines.length); i++) {
    const line = lines[i] ?? '';
    if (/^\|/.test(line) && !fenced[i]) cells.push(firstCell(line));
    else prose.push(line);
  }
  return [...prose, ...cells].join('\n');
}

/** The documenting units of one topic that name `name` as their object. */
export function unitsNamed(topic: HelpTopic, name: string): DocUnit[] {
  const parsed = parse(topic);
  const { lines, fenced } = parsed;
  const units: DocUnit[] = [];
  parsed.headings.forEach((heading, index) => {
    if (heading.level >= 3 && namesObject(heading.title, name))
      units.push({
        topic: topic.id,
        kind: 'section',
        where: heading.title,
        text: sectionText(parsed, index),
      });
  });
  let i = 0;
  while (i < lines.length) {
    if (!/^\|/.test(lines[i] ?? '') || fenced[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && /^\|/.test(lines[i] ?? '')) i++;
    let before = start - 1;
    while (before >= 0 && (lines[before] ?? '').trim() === '') before--;
    const label = before >= 0 && start - before <= 2 && !fenced[before] ? (lines[before] ?? '') : '';
    const rows = lines.slice(start, i);
    if (/:\s*$/.test(label) && namesObject(label, name)) {
      units.push({ topic: topic.id, kind: 'table', where: label, text: `${label}\n${rows.join('\n')}` });
    }
    for (const row of rows) {
      const first = spansOf(firstCell(row))[0];
      if (first === name) units.push({ topic: topic.id, kind: 'row', where: first, text: row });
    }
  }
  return units;
}

function unitOf(topics: HelpTopic[], at: UnitOverride): DocUnit | undefined {
  const topic = topics.find((t) => t.id === at.topic);
  if (!topic) return undefined;
  const parsed = parse(topic);
  if (at.heading !== undefined) {
    const index = parsed.headings.findIndex((h) => h.title === at.heading);
    return index < 0
      ? undefined
      : { topic: topic.id, kind: 'section', where: at.heading, text: sectionText(parsed, index) };
  }
  if (at.row !== undefined) {
    const row = parsed.lines.find(
      (line, i) => /^\|/.test(line) && !parsed.fenced[i] && spansOf(firstCell(line))[0] === at.row,
    );
    return row === undefined ? undefined : { topic: topic.id, kind: 'row', where: at.row, text: row };
  }
  if (at.label !== undefined) {
    const from = parsed.lines.findIndex((line) => line.startsWith(at.label ?? '\u0000'));
    if (from < 0) return undefined;
    let first = from + 1;
    while (first < parsed.lines.length && (parsed.lines[first] ?? '').trim() === '') first++;
    if (!/^\|/.test(parsed.lines[first] ?? '')) return undefined;
    let to = first;
    while (to < parsed.lines.length && /^\|/.test(parsed.lines[to] ?? '')) to++;
    return { topic: topic.id, kind: 'table', where: at.label, text: parsed.lines.slice(from, to).join('\n') };
  }
  const start = parsed.lines.findIndex((line) => line.startsWith(at.paragraph ?? '\u0000'));
  if (start < 0) return undefined;
  let end = start;
  while (end < parsed.lines.length && (parsed.lines[end] ?? '').trim() !== '') end++;
  return {
    topic: topic.id,
    kind: 'paragraph',
    where: at.paragraph ?? '',
    text: parsed.lines.slice(start, end).join('\n'),
  };
}

/**
 * The units that document the object at `path`: the override for that exact path, else the units of its own key,
 * else those of the nearest ancestor key that has any. A key that is only named in some other object's row never
 * counts, since the units are found by object, not by word.
 */
export function unitsForObject(
  path: string,
  topics: HelpTopic[],
  overrides: Record<string, UnitOverride[]> = {},
): DocUnit[] {
  const pinned = overrides[path];
  if (pinned) {
    return pinned.map((at) => {
      const unit = unitOf(topics, at);
      if (!unit) throw new Error(`The unit of ${path} is gone: ${JSON.stringify(at)}`);
      return unit;
    });
  }
  const names = path.replace(/\[\]|\{\}/g, '').split('.');
  for (let at = names.length - 1; at >= 0; at--) {
    const found = topics.flatMap((topic) => unitsNamed(topic, names[at] as string));
    if (found.length > 0) return found;
  }
  return [];
}
