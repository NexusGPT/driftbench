import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

/**
 * One reader of a block's verdict. Every read of a block's `pass` or `status`, and of a run detail's `pass`, goes
 * through `blockStatus`, `isScored`, `skipReason`, `runOutcome` or `blocksOutcome` (core runner/verdicts.ts): a
 * block not run or blocked has `pass` false and is no failure, and a direct read is how it got read as one.
 *
 * The check is by type, never by the name of the variable: the TypeScript checker gives the type of the value
 * read, and a block verdict type is an object with a boolean `pass` and `verdicts` (BlockResult, the report's
 * BlockDetail) or the block_end event (`pass`, `index`, `type`). A run detail (boolean `pass` and `blocks`) has its
 * `pass` checked; its `status` is the run's completion (completed, failed, stopped), not a verdict, and so is
 * RunResult's. The Python twin is python/driftbench/tests/test_verdict_reads.py.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** Where a direct read is the rule itself. */
const ALLOWED = new Set([
  'packages/core/src/runner/verdicts.ts', // the helpers
  'packages/core/src/schema/run.ts', // the schema that refuses a block whose pass and status disagree
]);
/** A function outside those files allowed to read: the run detail's verdict, from its pass and outcome. */
const ALLOWED_FUNCTIONS = new Set(['packages/report/src/format.ts#runDetailStatus']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** True when the type's `blocks` is an array of block verdict carriers (a run detail, not a list of flags). */
function blocksOfBlocks(checker: ts.TypeChecker, type: ts.Type): boolean {
  const blocks = type.getProperty('blocks');
  if (!blocks) return false;
  const list = checker.getNonNullableType(checker.getTypeOfSymbol(blocks));
  const element = checker.isArrayType(list)
    ? checker.getTypeArguments(list as ts.TypeReference)[0]
    : undefined;
  return element !== undefined && carrier(checker, element) === 'block';
}

/** The kind of verdict carrier a type is, if any: a block (pass and status checked) or a run (pass checked). */
function carrier(checker: ts.TypeChecker, type: ts.Type): 'block' | 'run' | undefined {
  const parts = type.isUnion() ? type.types : [type];
  let found: 'block' | 'run' | undefined;
  for (const part of parts) {
    const pass = part.getProperty('pass');
    if (!pass) continue;
    const passType = checker.getTypeOfSymbol(pass);
    if (!(checker.getNonNullableType(passType).flags & ts.TypeFlags.BooleanLike)) continue;
    const has = (name: string) => part.getProperty(name) !== undefined;
    if (has('verdicts') || (has('index') && has('type'))) found = 'block';
    else if (has('blocks') && found === undefined && blocksOfBlocks(checker, part)) found = 'run';
  }
  return found;
}

function enclosingFunction(node: ts.Node): string | undefined {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name) return at.name.getText();
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
  }
  return undefined;
}

/** Every direct read of a verdict field in the files, by type. */
function directReads(program: ts.Program, files: ReadonlySet<string>): string[] {
  const checker = program.getTypeChecker();
  const found: string[] = [];
  for (const source of program.getSourceFiles()) {
    if (!files.has(source.fileName)) continue;
    const file = relative(ROOT, source.fileName);
    if (ALLOWED.has(file)) continue;
    const visit = (node: ts.Node): void => {
      const read = (object: ts.Expression, field: string, at: ts.Node) => {
        if (field !== 'pass' && field !== 'status') return;
        const kind = carrier(checker, checker.getTypeAtLocation(object));
        if (kind === undefined || (kind === 'run' && field === 'status')) return;
        if (ALLOWED_FUNCTIONS.has(`${file}#${enclosingFunction(at)}`)) return;
        const { line } = source.getLineAndCharacterOfPosition(at.getStart());
        found.push(`${file}:${line + 1}: ${at.getText().slice(0, 80)}`);
      };
      if (ts.isPropertyAccessExpression(node)) {
        const assigned =
          ts.isBinaryExpression(node.parent) &&
          node.parent.left === node &&
          node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        if (!assigned) read(node.expression, node.name.text, node);
      }
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression))
        read(node.expression, node.argumentExpression.text, node);
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const field = (node.propertyName ?? node.name).getText();
        const holder = node.parent.parent;
        if (ts.isVariableDeclaration(holder) && holder.initializer) read(holder.initializer, field, node);
        if (ts.isParameter(holder)) read(holder.name as ts.Expression, field, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

function program(extra: Record<string, string> = {}): { program: ts.Program; files: Set<string> } {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(ROOT, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => undefined,
    },
  );
  if (!config) throw new Error('no tsconfig');
  const packages = join(ROOT, 'packages');
  const files = new Set(
    readdirSync(packages)
      .filter(
        (name) => name !== 'validators' && statSync(join(packages, name, 'src'), { throwIfNoEntry: false }),
      )
      .flatMap((name) => sources(join(packages, name, 'src'))),
  );
  const host = ts.createCompilerHost(config.options, true);
  const read = host.readFile;
  host.readFile = (name) => extra[name] ?? read(name);
  const fileExists = host.fileExists;
  host.fileExists = (name) => name in extra || fileExists(name);
  for (const name of Object.keys(extra)) files.add(name);
  return { program: ts.createProgram([...files], config.options, host), files };
}

it('no package reads a block pass or status outside the verdict helpers, whatever the value is named', () => {
  const { program: built, files } = program();
  expect(directReads(built, files)).toEqual([]);
}, 240_000);

it('the guard finds reads under any name, through destructuring and an element access', () => {
  const planted = join(ROOT, 'packages/report/src/planted-reads.ts');
  const { program: built } = program({
    [planted]: [
      "import type { BlockResult, RunResult } from '@agent-nexus/driftbench-core';",
      "import type { BlockDetail, RunDetail } from './scorecard';",
      'export function a(run: RunResult) { return run.blocks.filter((result) => result.pass).length; }',
      'export function b(result: BlockResult) { return result.status; }',
      'export function c(detail: BlockDetail) { const { pass } = detail; return pass; }',
      "export function d(x: RunDetail) { return x['pass']; }",
      'export function e(run: RunResult) { return run.status; }',
    ].join('\n'),
  });
  expect(directReads(built, new Set([planted])).map((line) => line.replace(/^.*?:(\d+): /, '$1 '))).toEqual([
    '3 result.pass',
    '4 result.status',
    '5 pass',
    "6 x['pass']",
  ]);
}, 240_000);
