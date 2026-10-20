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
      // Code unions: `export type XCode = 'A' | 'B'` and a `code: 'A' | 'B'` member of an error shape.
      const literals = (node: ts.TypeNode | undefined): string[] =>
        node && ts.isUnionTypeNode(node)
          ? node.types.flatMap((member) => literals(member))
          : node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)
            ? [node.literal.text]
            : [];
      const scan = (node: ts.Node): void => {
        if (
          ts.isTypeAliasDeclaration(node) &&
          node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
          /(Issue|Warning|Error)Codes?$/.test(node.name.text)
        )
          for (const code of literals(node.type)) codes.add(code);
        if (ts.isPropertySignature(node) && node.name.getText(source) === 'code')
          for (const code of literals(node.type))
            if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(code)) codes.add(code);
        ts.forEachChild(node, scan);
      };
      scan(source);
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
