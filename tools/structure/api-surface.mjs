#!/usr/bin/env node
// Prints the public API of every package: one row per name exported by packages/*/src/index.ts, with
// the facts needed to decide whether the name should stay public. It fails nothing and writes no file.
//
//   node tools/structure/api-surface.mjs          tab-separated rows, then one summary row per package
//   node tools/structure/api-surface.mjs --json   the same data as one JSON document
//
// Columns: package, name, kind (type or value), declaredIn, doc (the declaration has a doc comment),
// inDocs (the name appears as a word in docs/**, README.md or a package README), srcImporters (other
// packages whose src imports it), testFiles (test files that import it), examples and tools (files
// there that import it), usedNowhere (none of the above).
//
// An import is matched by symbol, not by text: the TypeScript checker resolves each imported name to
// its declaration, so a name counts as used when it is imported from the package root, from a file
// inside the package, through a namespace (`import * as ns` then `ns.name`), through `export * as`, or
// through a dynamic `import()`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const asJson = process.argv.includes('--json');
const posix = (path) => path.split(sep).join('/');
const rel = (path) => posix(relative(ROOT, path));

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name) || entry.name.startsWith('.'))
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, keep, out);
    else if (keep.test(entry.name)) out.push(path);
  }
  return out;
}

const packages = readdirSync(join(ROOT, 'packages'))
  .filter((dir) => existsSync(join(ROOT, 'packages', dir, 'src', 'index.ts')))
  .sort();
const paths = {};
for (const dir of packages) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'));
  paths[manifest.name] = [join(ROOT, 'packages', dir, 'src', 'index.ts')];
}

const CODE = /\.(ts|mts|tsx|mjs)$/;
const files = [
  ...walk(join(ROOT, 'packages'), CODE),
  ...walk(join(ROOT, 'examples'), CODE),
  ...walk(join(ROOT, 'tools'), CODE),
].filter((file) => !file.endsWith('.d.ts'));

const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  allowJs: true,
  resolveJsonModule: true,
  paths,
  types: [],
});
const checker = program.getTypeChecker();
const resolved = (symbol) =>
  symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

// Words in the documentation, for the inDocs column.
const docFiles = [
  ...walk(join(ROOT, 'docs'), /\.md$/),
  join(ROOT, 'README.md'),
  ...packages.map((dir) => join(ROOT, 'packages', dir, 'README.md')),
].filter((file) => existsSync(file));
const docWords = new Set(
  docFiles.flatMap((file) => readFileSync(file, 'utf8').match(/[A-Za-z_$][\w$]*/g) ?? []),
);

// The exports, keyed by the declaration each one resolves to.
const rows = [];
const bySymbol = new Map();
for (const dir of packages) {
  const index = program.getSourceFile(join(ROOT, 'packages', dir, 'src', 'index.ts'));
  const moduleSymbol = index && checker.getSymbolAtLocation(index);
  for (const exported of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
    const symbol = resolved(exported);
    const declaration = symbol.declarations?.[0];
    const row = {
      package: dir,
      name: exported.name,
      kind: symbol.flags & ts.SymbolFlags.Value ? 'value' : 'type',
      declaredIn: declaration ? rel(declaration.getSourceFile().fileName) : '?',
      doc: ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim().length > 0,
      inDocs: docWords.has(exported.name),
      srcImporters: new Set(),
      testFiles: new Set(),
      examples: new Set(),
      tools: new Set(),
    };
    rows.push(row);
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
  }
}

// Where a file sits: another package's src, a test, an example or a tool.
function place(file) {
  const parts = rel(file).split('/');
  if (parts[0] === 'packages') return { pkg: parts[1], area: parts[2] === 'src' ? 'src' : 'test' };
  if (parts[0] === 'examples') return { area: parts.includes('test') ? 'test' : 'examples' };
  return { area: /\.test\.(ts|mjs)$/.test(file) ? 'test' : 'tools' };
}

function record(symbol, file, where) {
  for (const row of bySymbol.get(resolved(symbol)) ?? []) {
    if (where.area === 'src') {
      if (where.pkg !== row.package) row.srcImporters.add(where.pkg);
    } else if (where.area === 'test') row.testFiles.add(file);
    else row[where.area].add(file);
  }
}

// The module a specifier names, when it resolves to a file of this repo.
const moduleOf = (specifier) =>
  specifier && ts.isStringLiteralLike(specifier) ? checker.getSymbolAtLocation(specifier) : undefined;
const member = (moduleSymbol, name) =>
  moduleSymbol && checker.tryGetMemberInModuleExports(name, moduleSymbol);

// Climbs from `import('x')` through await, parentheses and casts to the declaration that receives it.
function receiver(call) {
  let node = call;
  while (
    node.parent &&
    (ts.isAwaitExpression(node.parent) ||
      ts.isParenthesizedExpression(node.parent) ||
      ts.isAsExpression(node.parent) ||
      ts.isSatisfiesExpression(node.parent) ||
      ts.isNonNullExpression(node.parent))
  )
    node = node.parent;
  return node.parent && ts.isVariableDeclaration(node.parent) && node.parent.initializer === node
    ? node.parent
    : undefined;
}

for (const sourceFile of program.getSourceFiles()) {
  if (sourceFile.isDeclarationFile || !sourceFile.fileName.startsWith(`${ROOT}/`)) continue;
  const file = rel(sourceFile.fileName);
  const where = place(sourceFile.fileName);
  // Local names that stand for a whole module: `import * as ns`, or `const ns = await import()`.
  const namespaces = new Map();
  const collect = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const moduleSymbol = moduleOf(node.moduleSpecifier);
      const bindings = node.importClause.namedBindings;
      if (node.importClause.name) record(checker.getSymbolAtLocation(node.importClause.name), file, where);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements)
          record(checker.getSymbolAtLocation(element.name), file, where);
      } else if (bindings && moduleSymbol) namespaces.set(bindings.name.text, moduleSymbol);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const moduleSymbol = moduleOf(node.moduleSpecifier);
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements)
          record(member(moduleSymbol, (element.propertyName ?? element.name).text), file, where);
      } else if (moduleSymbol) {
        // `export * from` and `export * as ns from` hand on every name of the module.
        for (const exported of checker.getExportsOfModule(moduleSymbol)) record(exported, file, where);
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const moduleSymbol = moduleOf(node.arguments[0]);
      const target = moduleSymbol && receiver(node);
      if (target && ts.isIdentifier(target.name)) namespaces.set(target.name.text, moduleSymbol);
      else if (target && ts.isObjectBindingPattern(target.name)) {
        for (const element of target.name.elements) {
          const name = element.propertyName ?? element.name;
          if (ts.isIdentifier(name)) record(member(moduleSymbol, name.text), file, where);
        }
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && node.qualifier) {
      let first = node.qualifier;
      while (ts.isQualifiedName(first)) first = first.left;
      record(member(moduleOf(node.argument.literal), first.text), file, where);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  if (namespaces.size === 0) continue;
  const follow = (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      record(member(namespaces.get(node.expression.text), node.name.text), file, where);
    } else if (ts.isQualifiedName(node) && ts.isIdentifier(node.left)) {
      record(member(namespaces.get(node.left.text), node.right.text), file, where);
    }
    ts.forEachChild(node, follow);
  };
  follow(sourceFile);
}

const out = rows.map((row) => {
  const srcImporters = [...row.srcImporters].sort();
  const counts = { testFiles: row.testFiles.size, examples: row.examples.size, tools: row.tools.size };
  const used = srcImporters.length + counts.testFiles + counts.examples + counts.tools > 0;
  return { ...row, srcImporters, ...counts, usedNowhere: !used && !row.inDocs };
});

const count = (list, test) => list.filter(test).length;
function summarise(name, list) {
  return {
    package: name,
    exports: list.length,
    types: count(list, (row) => row.kind === 'type'),
    values: count(list, (row) => row.kind === 'value'),
    noDoc: count(list, (row) => !row.doc),
    inDocs: count(list, (row) => row.inDocs),
    usedByAPackage: count(list, (row) => row.srcImporters.length > 0),
    testsOnly: count(
      list,
      (row) => row.testFiles > 0 && row.srcImporters.length + row.examples + row.tools === 0 && !row.inDocs,
    ),
    usedNowhere: count(list, (row) => row.usedNowhere),
  };
}
const summary = packages
  .map((dir) =>
    summarise(
      dir,
      out.filter((row) => row.package === dir),
    ),
  )
  .sort((a, b) => b.exports - a.exports || a.package.localeCompare(b.package));
const total = summarise('total', out);

if (asJson) {
  process.stdout.write(`${JSON.stringify({ exports: out, packages: summary, total }, null, 2)}\n`);
} else {
  const yes = (flag) => (flag ? 'yes' : 'no');
  const lines = [
    'package\tname\tkind\tdeclaredIn\tdoc\tinDocs\tsrcImporters\ttestFiles\texamples\ttools\tusedNowhere',
    ...out.map((row) =>
      [
        row.package,
        row.name,
        row.kind,
        row.declaredIn,
        yes(row.doc),
        yes(row.inDocs),
        row.srcImporters.join('|') || '-',
        row.testFiles,
        row.examples,
        row.tools,
        yes(row.usedNowhere),
      ].join('\t'),
    ),
    '',
    'summary\texports\ttypes\tvalues\tnoDoc\tinDocs\tusedByAPackage\ttestsOnly\tusedNowhere',
    ...[...summary, total].map((line) => Object.values(line).join('\t')),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}
