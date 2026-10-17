import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const JUDGES = '@agent-nexus/driftbench-judges';
const STATS = '@agent-nexus/driftbench-stats';
// Only the repository entry needs dataset loading, root discovery and argument parsing.
const ENTRY_EXPORTS = new Map([
  ['@agent-nexus/driftbench-core', new Set(['loadSpecs'])],
  ['@agent-nexus/driftbench-store', new Set(['openMemoryStore', 'openStore', 'readTree'])],
  ['@agent-nexus/driftbench-validators', new Set(['findRoot'])],
  ['commander', new Set(['Command', 'CommanderError'])],
]);
const JUDGE_EXPORTS = new Set([
  'buildPrompt',
  'parseJudgeText',
  // The recorder's wire allowance is the default judge's output room, one shared constant.
  'outputRoom',
  'pairwiseRequest',
  'judgePairwise',
  'createClaudeCliJudge',
  'createGoogleJudge',
  'createOpenAiJudge',
  'recordingClient',
  'playerClient',
  'loadCassette',
  'JudgeRequest',
  'JudgeClient',
  'Cassette',
  'PROMPT_FINGERPRINT',
  'requestKey',
]);

function production(file) {
  return file.startsWith('benchmarks/') && !/^benchmarks\/(?:test|scripts)(?:\/|$)/.test(file);
}

/** Check syntax rather than strings: comments and quoted examples are not imports. */
export function lintBenchSource(source, file = 'benchmarks/run.ts') {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems = [];
  const report = (node, message) => {
    const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
    problems.push(`${file}:${line + 1}:${character + 1}: ${message}`);
  };
  for (const diagnostic of tree.parseDiagnostics) {
    const { line, character } = tree.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    problems.push(
      `${file}:${line + 1}:${character + 1}: benchmark syntax: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
  }
  const checkSpecifier = (node) => {
    if (!ts.isStringLiteralLike(node)) {
      report(node, 'use literal static imports so the benchmark public API boundary can be checked');
      return undefined;
    }
    const specifier = node.text;
    if (specifier === JUDGES || specifier === STATS) return specifier;
    if (file === 'benchmarks/cli.ts' && ENTRY_EXPORTS.has(specifier)) return specifier;
    if (specifier === 'module' || specifier === 'node:module') {
      report(node, 'module loaders bypass the benchmark public API boundary; use static imports');
      return undefined;
    }
    if (isBuiltin(specifier)) return specifier;
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      if (!specifier.includes('\\') && production(target)) return specifier;
    }
    report(
      node,
      `import "${specifier}" is outside the benchmark public API boundary; use ${JUDGES}, ${STATS}, node builtins, or a local production benchmark module`,
    );
    return undefined;
  };
  const checkJudgeNames = (bindings, node) => {
    if (!bindings || !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
      report(
        node,
        'use named public judge imports or exports; namespace, default and star forms bypass the benchmark allowlist',
      );
      return;
    }
    for (const binding of bindings.elements) {
      const name = (binding.propertyName ?? binding.name).text;
      if (!JUDGE_EXPORTS.has(name)) {
        report(binding, `judge symbol "${name}" is outside the benchmark public API allowlist`);
      }
    }
  };
  const checkEntryNames = (specifier, bindings, node) => {
    const names = ENTRY_EXPORTS.get(specifier);
    if (!names) return;
    if (!bindings || !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
      report(node, 'use named public entry imports or exports');
      return;
    }
    for (const binding of bindings.elements) {
      if (!names.has((binding.propertyName ?? binding.name).text))
        report(binding, 'symbol is outside the repository entry public API allowlist');
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = checkSpecifier(node.moduleSpecifier);
      checkEntryNames(specifier, node.importClause?.namedBindings, node);
      if (ENTRY_EXPORTS.has(specifier) && node.importClause?.name)
        report(node.importClause.name, 'use named public entry imports, never a default import');
      if (specifier === JUDGES) {
        checkJudgeNames(node.importClause?.namedBindings, node);
        if (node.importClause?.name)
          report(node.importClause.name, 'use named public judge imports, never a default import');
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = checkSpecifier(node.moduleSpecifier);
      checkEntryNames(specifier, node.exportClause, node);
      if (specifier === JUDGES) checkJudgeNames(node.exportClause, node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      report(node, 'require-style imports bypass the benchmark public API boundary; use static imports');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (checkSpecifier(node.argument.literal) === JUDGES) {
        const qualifier = node.qualifier;
        if (!qualifier || !ts.isIdentifier(qualifier) || !JUDGE_EXPORTS.has(qualifier.text)) {
          report(node, 'use an allowed named public judge type');
        }
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(node, 'dynamic imports bypass the benchmark public API boundary; use static imports');
    } else if (
      (ts.isIdentifier(node) && ['require', 'createRequire', 'getBuiltinModule'].includes(node.text)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        ['require', 'createRequire', 'getBuiltinModule'].includes(node.argumentExpression.text))
    ) {
      report(node, 'runtime module loaders bypass the benchmark public API boundary; use static imports');
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return [...new Set(problems)];
}

/** Test and offline preparation folders are exempt, and production cannot import either folder. */
export function lintBenchmarks(root = process.cwd()) {
  const problems = [];
  if (!existsSync(join(root, 'benchmarks/run.ts')))
    return ['benchmarks/run.ts: benchmark harness is missing'];
  const scan = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      const file = relative(root, path).split(sep).join('/');
      if (!production(file)) continue;
      if (entry.isSymbolicLink()) {
        problems.push(`${file}: symlinks can bypass the benchmark public API boundary; use a regular file`);
      } else if (entry.isDirectory()) scan(path);
      else if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file))
        problems.push(...lintBenchSource(readFileSync(path, 'utf8'), file));
    }
  };
  scan(join(root, 'benchmarks'));
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = lintBenchmarks(resolve(process.argv[2] ?? process.cwd()));
  if (problems.length > 0) {
    process.stderr.write(`${problems.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Benchmark harness uses the public API only.\n');
  }
}
