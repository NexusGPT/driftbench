import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { COMMAND_MODULES } from '../src/command-index';
import { main } from '../src/main';

const installed = vi.hoisted(() => ({ value: true }));
vi.mock('../src/acme-example', async (original) => {
  const actual = await original<typeof import('../src/acme-example')>();
  return {
    ...actual,
    acmeExampleInstalled: () => installed.value,
    acmeExample: () => (installed.value ? actual.acmeExample() : Promise.resolve(undefined)),
  };
});
vi.mock('@agent-nexus/driftbench-generate', async (original) => {
  const actual = await original<typeof import('@agent-nexus/driftbench-generate')>();
  return {
    ...actual,
    portFromEnv: () =>
      new actual.FakeModelPort([readFileSync(join(ROOT, SPEC), 'utf8')], { family: 'mistral' }),
  };
});
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = 'examples/acme/specs/conversations/plan-upgrade.yaml';
let dir: string;
async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd: ROOT,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adapter-refusals-'));
  await writeFile(join(dir, 'faults.mjs'), 'export const faults = [];');
  expect(
    (await cli(['campaign', 'run', SPEC, '--store', join(dir, 'baseline.db'), '--campaign', 'baseline']))
      .code,
  ).toBe(0);
  expect(
    (
      await cli([
        'holdout',
        'seal',
        '--specs',
        'examples/acme/gated/control-handwritten',
        '--out',
        join(dir, 'sealed'),
      ])
    ).code,
  ).toBe(0);
  installed.value = false;
});
afterAll(async () => {
  installed.value = true;
  await rm(dir, { recursive: true, force: true });
});

/** Follow action call graphs from the actual registry, including campaign wrappers such as ci. */
function targetCommands(): string[] {
  const configFile = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();
  const declaration = (node: ts.Node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration;
  };
  function reaches(node: ts.Node, seen = new Set<ts.Node>()): boolean {
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'adapterFor')
        return true;
      const target = declaration(node.expression);
      if (target?.getSourceFile().fileName.includes('/packages/cli/src/') && reaches(target, seen))
        return true;
    }
    return ts.forEachChild(node, (child) => reaches(child, seen) || undefined) ?? false;
  }
  function commandPath(node: ts.Node): string[] {
    if (ts.isIdentifier(node)) {
      const target = declaration(node);
      return target && ts.isVariableDeclaration(target) && target.initializer
        ? commandPath(target.initializer)
        : [];
    }
    if (!ts.isCallExpression(node)) return [];
    if (ts.isPropertyAccessExpression(node.expression)) {
      const parent = commandPath(node.expression.expression);
      const name = node.arguments[0];
      return node.expression.name.text === 'command' && name && ts.isStringLiteral(name)
        ? [...parent, name.text.split(' ')[0] as string]
        : parent;
    }
    return node.arguments.flatMap(commandPath);
  }
  const registry = join(ROOT, 'packages/cli/src/command-index.ts');
  const source = readFileSync(registry, 'utf8');
  const files = [...source.matchAll(/import\('(.+?)'\)/g)].map((match) =>
    resolve(dirname(registry), `${match[1]}.ts`),
  );
  const commands = new Set<string>();
  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    expect(sourceFile, file).toBeDefined();
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'action'
      ) {
        const action = node.arguments[0];
        if (action && reaches(action)) commands.add(commandPath(node.expression.expression).join(' '));
      }
      ts.forEachChild(node, visit);
    }
    if (sourceFile) visit(sourceFile);
  }
  // The run-time registry and the parsed module list must agree too.
  expect(files.length).toBe(COMMAND_MODULES.length);
  return [...commands].sort();
}

it('every registered action that resolves a target explains an absent example', async () => {
  const fixtures: Record<string, string[]> = {
    'campaign run': [SPEC],
    'campaign plan': [SPEC],
    generate: [
      '--map',
      'examples/acme/map/approved.yaml',
      '--out',
      join(dir, 'generated'),
      '--model',
      '--proposals',
      '1',
      '--reference',
      'function:acme-sales',
      '--faults',
      join(dir, 'faults.mjs'),
      '--max',
      '1',
      '--tasks',
      '1',
    ],
    'campaign resume': ['baseline', '--store', join(dir, 'baseline.db')],
    smoke: [SPEC],
    isolation: ['examples/acme/parents/checkout.yaml', '--target', 'function:acme-sales'],
    ci: [
      '--specs',
      SPEC,
      '--target',
      'function:acme-sales',
      '--baseline',
      join(dir, 'baseline.db'),
      '--store',
      join(dir, 'candidate.db'),
    ],
    perturb: [SPEC, '--class', 'D1', '--at', '0'],
    simulate: [
      SPEC,
      '--persona',
      'examples/acme/personas/sam-upgrader.yaml',
      '--recording',
      'examples/acme/personas/recordings/sam-upgrader.yaml',
    ],
    attack: [SPEC],
    'redteam grade': [SPEC, '--cassette', 'packages/cli/test/fixtures/redteam-grade.cassette.json'],
    'redteam run': [SPEC, '--replay', 'packages/cli/test/fixtures/redteam-crescendo.json'],
    'family verify': ['examples/acme/specs', '--reference', 'function:acme-sales'],
    'pilot run': [
      '--map',
      'examples/acme/map/approved.yaml',
      '--suite',
      'examples/acme/generated/specs',
      '--target',
      'function:acme-random',
      '--store',
      join(dir, 'pilot.db'),
    ],
    gate: [
      SPEC,
      '--reference',
      'function:acme-sales',
      '--faults',
      join(dir, 'faults.mjs'),
      '--out',
      join(dir, 'gate'),
    ],
    'holdout score': ['--sealed', join(dir, 'sealed'), '--target', 'function:acme-sales', '--budget', '1'],
  };
  const commands = targetCommands();
  expect(commands).toEqual(Object.keys(fixtures).sort());
  for (const command of commands) {
    const result = await cli([...command.split(' '), ...(fixtures[command] ?? [])]);
    expect.soft(result.code, command).toBe(command === 'generate' ? 1 : 2);
    expect.soft(result.err, command).toContain('is not part of the installed CLI');
    expect.soft(result.err, command).toContain('examples/acme');
    expect
      .soft(result.err, command)
      .toContain(command === 'pilot run' ? 'no pilot target' : 'This install reaches');
    if (command === 'holdout score') expect(result.err).toContain('nothing ran, no query was spent');
  }
}, 30_000);
