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
