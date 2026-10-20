import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * The provenance of a bank item from the TypeScript syntax tree. An item is its runner entry (the property of the
 * family file's `...Runs` object) and its spec row (the `row(...)` call of the specs file, the cause tag aside).
 * Its code is that entry plus every top-level declaration of the family file or of the kit that the entry reaches
 * through identifiers, followed to any depth. Each piece is printed from the tree without comments and without
 * the original white space, and the pieces are hashed in name order. Two trees give the same fingerprint for an
 * item exactly when the executable text its runner reaches is the same.
 */
const FAMILY_FILES: Record<string, string> = { 're-anchoring': 'reanchoring' };
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

type Parsed = { file: ts.SourceFile; decls: Map<string, ts.Statement[]> };

function parse(path: string): Parsed {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ESNext, true);
  const decls = new Map<string, ts.Statement[]>();
  const add = (name: string, statement: ts.Statement) =>
    decls.set(name, [...(decls.get(name) ?? []), statement]);
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) add(statement.name.text, statement);
    else if (ts.isClassDeclaration(statement) && statement.name) add(statement.name.text, statement);
    else if (ts.isVariableStatement(statement))
      for (const d of statement.declarationList.declarations)
        if (ts.isIdentifier(d.name)) add(d.name.text, statement);
  }
  return { file, decls };
}

const show = (node: ts.Node, file: ts.SourceFile): string =>
  printer.printNode(ts.EmitHint.Unspecified, node, file);
const sha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

function tsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => join(dir, name));
}

function entryOf(file: ts.SourceFile, key: string): ts.Node | undefined {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const d of statement.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !/Runs$/.test(d.name.text)) continue;
      const init = d.initializer;
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      for (const property of init.properties) {
        const id = property.name;
        if (id && (ts.isIdentifier(id) || ts.isStringLiteral(id)) && id.text === key) return property;
      }
    }
  }
  return undefined;
}

function specOf(file: ts.SourceFile, key: string): string {
  let found = '';
  const visit = (node: ts.Node) => {
    if (
      !found &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'row' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === key
    ) {
      // Arguments: key, tier, title, generator, oracle, cause, options. The cause names the repair, not the item.
      found = node.arguments
        .filter((_a, at) => at !== 5)
        .map((a) => show(a, file))
        .join('\u0001');
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
  noLib: false,
  types: [],
};

/**
 * Declarations whose change was read and found not to move a pass condition: `compose` gained a record of the units
 * it wrote (`written`, read back by `truthOf`); its output is the same. They are left out of the fingerprint, and
 * the reason is written here so that adding a name is a decision.
 */
const READ_AND_UNCHANGED = new Set(['compose', 'written', 'truthOf']);

type Reach = { entry: ts.Node; file: ts.SourceFile; pieces: Map<string, string> };

/**
 * The entry of an item and the top-level declarations of the family file or the kit it reaches, resolved with the
 * compiler's own symbol table (a local variable that shares a helper's name does not reach the helper).
 */
function reach(root: string, id: string, program: ts.Program, keepExcluded = false): Reach | undefined {
  const dot = id.indexOf('.');
  const family = id.slice(0, dot);
  const key = id.slice(dot + 1);
  const file = FAMILY_FILES[family] ?? family;
  const source = program.getSourceFile(join(root, 'bank/families', `${file}.ts`));
  if (!source) return undefined;
  const entry = entryOf(source, key);
  if (!entry) return undefined;
  const checker = program.getTypeChecker();
  const inScope = (declaration: ts.Node): boolean => {
    const path = declaration.getSourceFile().fileName;
    return path.startsWith(join(root, 'kit')) || path === source.fileName;
  };
  const topLevel = (declaration: ts.Node): ts.Statement | undefined => {
    let node: ts.Node | undefined = declaration;
    while (node && !(node.parent && ts.isSourceFile(node.parent))) node = node.parent;
    return node as ts.Statement | undefined;
  };
  const pieces = new Map<string, string>();
  const seen = new Set<ts.Node>();
  const queue: ts.Node[] = [entry];
  while (queue.length > 0) {
    const node = queue.pop() as ts.Node;
    const walk = (child: ts.Node) => {
      if (ts.isIdentifier(child)) {
        let symbol = checker.getSymbolAtLocation(child);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        for (const declaration of symbol?.declarations ?? []) {
          if (!inScope(declaration)) continue;
          // Only a declared function, class or variable is followed: never a member of an object, such as an entry.
          const declared =
            ts.isFunctionDeclaration(declaration) ||
            ts.isClassDeclaration(declaration) ||
            (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name));
          if (!declared) continue;
          // And only at the top level of its file: a local of the same name is not the helper.
          const statementOf = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration;
          if (!statementOf.parent || !ts.isSourceFile(statementOf.parent)) continue;
          const statement = topLevel(declaration);
          if (!statement || seen.has(statement)) continue;
          if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
          seen.add(statement);
          if (!keepExcluded && declarationNames(statement).some((n) => READ_AND_UNCHANGED.has(n))) continue;
          const name = `${statement.getSourceFile().fileName.split('/').pop()}:${statement.getStart()}`;
          pieces.set(name, show(statement, statement.getSourceFile()));
          queue.push(statement);
        }
      }
      ts.forEachChild(child, walk);
    };
    ts.forEachChild(node, walk);
  }
  return { entry, file: source, pieces };
}

function declarationNames(statement: ts.Statement): string[] {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name)
    return [statement.name.text];
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.flatMap((d) =>
      ts.isIdentifier(d.name) ? [d.name.text] : [],
    );
  return [];
}

const programs = new Map<string, ts.Program>();

function programOf(root: string): ts.Program {
  let program = programs.get(root);
  if (!program) {
    const files = [...tsFiles(join(root, 'kit')), ...tsFiles(join(root, 'bank/families'))];
    program = ts.createProgram(files, OPTIONS);
    programs.set(root, program);
  }
  return program;
}

/** The top-level declarations of the kit, hashed by name (the fingerprint of a helper on its own). */
export function kitHelpers(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of tsFiles(join(root, 'kit'))) {
    const parsed = parse(path);
    for (const [name, statements] of parsed.decls)
      out[name] = sha(statements.map((s) => show(s, parsed.file)).join('\u0001'));
  }
  return out;
}

/** The fingerprint of each item id `family.key` in the tree at `root` (the folder `.../ladders/pointer`). */
export function fingerprints(root: string, ids: readonly string[]): Record<string, string> {
  const program = programOf(root);
  const result: Record<string, string> = {};
  for (const id of ids) {
    const dot = id.indexOf('.');
    const key = id.slice(dot + 1);
    const file = FAMILY_FILES[id.slice(0, dot)] ?? id.slice(0, dot);
    const spec = specOf(parse(join(root, 'bank/specs', `${file}.ts`)).file, key);
    const reached = reach(root, id, program);
    if (!reached) {
      result[id] = sha(`missing:${spec}`);
      continue;
    }
    const pieces = [...reached.pieces.values()].sort();
    result[id] = sha([show(reached.entry, reached.file), spec, ...pieces].join('\u0002'));
  }
  return result;
}

/** The top-level declarations an item reaches, as `file:name`, for the tests that name them. */
export function reachedNames(root: string, id: string): string[] {
  // The excluded declarations are named too: this is how the equivalence test finds the items that reach them.
  const reached = reach(root, id, programOf(root), true);
  if (!reached) return [];
  const names: string[] = [];
  for (const text of reached.pieces.values()) {
    const m = /^(?:export\s+)?(?:async\s+)?(?:function\s+|const\s+|let\s+|class\s+)([A-Za-z0-9_]+)/.exec(
      text.trimStart(),
    );
    if (m) names.push(m[1] as string);
  }
  return names.sort();
}

/** The printed declarations an item reaches, by name (to read what changed between two trees). */
export function reachedText(root: string, id: string): Record<string, string> {
  const reached = reach(root, id, programOf(root));
  if (!reached) return {};
  const out: Record<string, string> = { '@entry': show(reached.entry, reached.file) };
  for (const [name, text] of reached.pieces)
    out[name.split(':')[0] + ':' + text.slice(0, 60).replace(/\s+/g, ' ')] = text;
  return out;
}
