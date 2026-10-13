#!/usr/bin/env node
// Prints the public API of every package export-map entry: one row per built export, with
// the facts needed to decide whether the name should stay public. It also keeps the frozen list of those
// names, tools/structure/api-surface.json: a name is added to, or removed from, a package's public API
// only together with that file, so the change shows in review.
//
//   node tools/structure/api-surface.mjs           tab-separated rows, then one summary row per package
//   node tools/structure/api-surface.mjs --json    the same data as one JSON document
//   node tools/structure/api-surface.mjs --check   compare the exports with the frozen list; exit 1 and
//                                                  name every added and removed export when they differ
//   node tools/structure/api-surface.mjs --build --write   rewrite the frozen list from the exports
//   --build                                        build if the input/output stamp is missing or stale
//   --snapshot <file>                              the frozen list to check or write, for the tests
//   --root <dir>                                   the repository to read, for the tests
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
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { declarationNames, packageEntries, requireFreshBuild, runtimeNames } from './built-api.mjs';

const flagValue = (flag) => {
  const at = process.argv.indexOf(flag);
  return at < 0 ? undefined : process.argv[at + 1];
};
// The repository to read: this one, or the folder --root names (the tests give a small one).
const ROOT = (flagValue('--root') ?? fileURLToPath(new URL('../..', import.meta.url))).replace(/[\\/]$/, '');
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

const entries = packageEntries(ROOT);
const packages = [...new Set(entries.map((entry) => entry.pkg))];
try {
  requireFreshBuild(ROOT, entries, process.argv.includes('--build'));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
const paths = Object.fromEntries(entries.map((entry) => [entry.specifier, [entry.source]]));
const declarations = declarationNames(entries);
const runtime = new Map(entries.map((entry) => [entry.key, runtimeNames(entry)]));

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
for (const entry of entries) {
  const index = program.getSourceFile(entry.source);
  const moduleSymbol = index && checker.getSymbolAtLocation(index);
  if (!moduleSymbol) throw new Error(`${entry.key}: source entry is not a module`);
  const sourceNames = new Map(checker.getExportsOfModule(moduleSymbol).map((item) => [item.name, item]));
  const values = runtime.get(entry.key);
  const types = new Set([...declarations.get(entry.key)].filter((name) => !values.has(name)));
  const sourceTypes = new Set([...sourceNames.keys()].filter((name) => !values.has(name)));
  const mismatch = [...new Set([...types, ...sourceTypes])].filter(
    (name) => types.has(name) !== sourceTypes.has(name),
  );
  if (mismatch.length)
    throw new Error(
      `${entry.key}: source and built declaration type-only names differ: ${mismatch.join(', ')}`,
    );
  for (const name of [...new Set([...values, ...types])].sort()) {
    const exported = sourceNames.get(name);
    const symbol = resolved(exported);
    const declaration = symbol?.declarations?.[0];
    const row = {
      package: entry.key,
      name,
      kind: values.has(name) ? 'value' : 'type',
      declaredIn: declaration ? rel(declaration.getSourceFile().fileName) : rel(entry.runtime),
      doc: symbol
        ? ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim().length > 0
        : false,
      inDocs: docWords.has(name),
      srcImporters: new Set(),
      testFiles: new Set(),
      examples: new Set(),
      tools: new Set(),
    };
    rows.push(row);
    if (symbol) bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
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
const summary = entries
  .map((entry) => entry.key)
  .map((dir) =>
    summarise(
      dir,
      out.filter((row) => row.package === dir),
    ),
  )
  .sort((a, b) => b.exports - a.exports || a.package.localeCompare(b.package));
const total = summarise('total', out);

const SNAPSHOT = flagValue('--snapshot') ?? join(ROOT, 'tools/structure/api-surface.json');

/** The frozen list: per package, each exported name with its kind (value or type), sorted by name. */
function frozen() {
  const list = {};
  for (const dir of entries.map((entry) => entry.key).sort()) {
    const own = out.filter((row) => row.package === dir).sort((a, b) => (a.name < b.name ? -1 : 1));
    list[dir] = Object.fromEntries(own.map((row) => [row.name, row.kind]));
  }
  return {
    note: 'The public API of every package export-map entry: values loaded from fresh built modules and type-only names cross-checked against built declarations. A test checks the build stamp and compares this list, so adding or removing a public name changes this file in the same pull request. Regenerate: node tools/structure/api-surface.mjs --build --write',
    packages: list,
  };
}

/** The names in `now` and not in `then`, and the reverse, as `package: kind name` lines. */
function differences(then, now) {
  const flat = (list) =>
    new Set(
      Object.entries(list.packages ?? {}).flatMap(([dir, names]) => [
        `${dir}: entry`,
        ...Object.entries(names).map(([name, kind]) => `${dir}: ${kind} ${name}`),
      ]),
    );
  const before = flat(then);
  const after = flat(now);
  return {
    added: [...after].filter((line) => !before.has(line)).sort(),
    removed: [...before].filter((line) => !after.has(line)).sort(),
  };
}

if (process.argv.includes('--write')) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(frozen(), null, 2)}\n`);
  process.stdout.write(`Wrote ${rel(SNAPSHOT)}: ${out.length} exports in ${packages.length} packages.\n`);
} else if (process.argv.includes('--check')) {
  if (!existsSync(SNAPSHOT)) {
    process.stderr.write(
      `${rel(SNAPSHOT)} is missing: run node tools/structure/api-surface.mjs --build --write\n`,
    );
    process.exit(1);
  }
  const { added, removed } = differences(JSON.parse(readFileSync(SNAPSHOT, 'utf8')), frozen());
  if (added.length + removed.length === 0) {
    process.stdout.write(`The public API matches ${rel(SNAPSHOT)}: ${out.length} exports.\n`);
  } else {
    const lines = [
      `The public API differs from ${rel(SNAPSHOT)}.`,
      ...added.map((line) => `  added    ${line}`),
      ...removed.map((line) => `  removed  ${line}`),
      'A public name changes only on purpose. If this change is meant: run',
      '  node tools/structure/api-surface.mjs --build --write',
      'commit the file, and name the new or removed exports in CHANGELOG.md.',
    ];
    process.stderr.write(`${lines.join('\n')}\n`);
    process.exit(1);
  }
} else if (asJson) {
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
