import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A code is set where an error is raised. No function of the pointer reader may read a message to find its code.
 *
 * The check reads the TypeScript source of `src/pointer` and is conservative. It reports:
 * - a function named like `answerCode` (a name that ends in `Code`, or starts `codeOf`, `codeFor`, `codeFrom`) that
 *   takes a message, text or string parameter and applies a string method, a comparison, a lookup or a `switch` to it;
 * - a `code:` property, a `.code =` assignment or a `code` field whose value applies a string method to a message;
 * - a call of a function named like `answerCode` with a message as argument;
 * - a `code` value that calls a function of the same file which reads its text parameter in one of those ways.
 */

type Finding = { file: string; line: number; reason: string };
type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration;

const TEXT_NAMES = /^(message|msg|text|reason|detail|description)$/i;
const CODE_NAME = /(?:^|[a-z])Code(?:Of|For|From|By)?$|^code(?:Of|For|From|By)\w*$/;
const TEXT_METHODS = new Set([
  'startsWith',
  'endsWith',
  'includes',
  'indexOf',
  'lastIndexOf',
  'test',
  'match',
  'matchAll',
  'search',
  'exec',
]);
const LOOKUP_METHODS = new Set(['get', 'has']);
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

const isFunction = (node: ts.Node): node is FunctionNode =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node);

/** The expression one step toward the root of a chain such as `message.trim().startsWith`. */
function inward(node: ts.Node): ts.Node | undefined {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return node.expression;
  if (ts.isCallExpression(node) || ts.isParenthesizedExpression(node)) return node.expression;
  if (ts.isNonNullExpression(node) || ts.isAsExpression(node)) return node.expression;
  return undefined;
}

/** True when the chain starts at one of the text parameters, or passes through a property named like a text. */
function isText(node: ts.Node, params: ReadonlySet<string>): boolean {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    if (ts.isIdentifier(current)) return params.has(current.text);
    if (ts.isPropertyAccessExpression(current) && TEXT_NAMES.test(current.name.text)) return true;
    current = inward(current);
  }
  return false;
}

function nameOf(fn: FunctionNode): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) {
    return ts.isIdentifier(fn.name) ? fn.name.text : undefined;
  }
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
    return ts.isIdentifier(parent.name) ? parent.name.text : undefined;
  }
  return undefined;
}

/** The parameters that hold a message: named like one, or typed `string`. */
function textParams(fn: FunctionNode): Set<string> {
  const names = new Set<string>();
  for (const parameter of fn.parameters) {
    if (!ts.isIdentifier(parameter.name)) continue;
    const typed = parameter.type?.kind === ts.SyntaxKind.StringKeyword;
    if (typed || TEXT_NAMES.test(parameter.name.text)) names.add(parameter.name.text);
  }
  return names;
}

/** The text parameters of every function around a node: a closure reads the parameters of its parents. */
function enclosingParams(node: ts.Node): Set<string> {
  const names = new Set<string>();
  for (let up: ts.Node | undefined = node.parent; up !== undefined; up = up.parent) {
    if (isFunction(up)) for (const name of textParams(up)) names.add(name);
  }
  return names;
}

/** The first place that applies a string method (or, in a code function, a comparison or lookup) to a text. */
function findTextUse(
  root: ts.Node,
  isTextNode: (node: ts.Node) => boolean,
  inCodeFunction: boolean,
): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const onText = isTextNode(node.expression.expression);
      const withText = node.arguments.some((argument) => isTextNode(argument));
      if (TEXT_METHODS.has(method) && (onText || withText)) found = node;
      if (inCodeFunction && LOOKUP_METHODS.has(method) && withText) found = node;
    } else if (ts.isSwitchStatement(node) && isTextNode(node.expression)) {
      found = node;
    } else if (inCodeFunction && ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind)) {
      if (isTextNode(node.left) || isTextNode(node.right)) found = node;
    } else if (inCodeFunction && ts.isElementAccessExpression(node)) {
      if (isTextNode(node.argumentExpression)) found = node;
    }
    if (found === undefined) ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** The value of a `code:` property, a `code` field or a `.code =` assignment. */
function codeValue(node: ts.Node): ts.Expression | undefined {
  if (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
    const name = node.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
      return name.text === 'code' ? node.initializer : undefined;
    }
    return undefined;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = node.left;
    return ts.isPropertyAccessExpression(left) && left.name.text === 'code' ? node.right : undefined;
  }
  return undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

/** Every place of one source text where a code is read from a message. */
function findMessageToCode(file: string, source: string): Finding[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const report = (node: ts.Node, reason: string) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    findings.push({ file, line, reason });
  };
  const locals = new Map<string, FunctionNode>();
  const collect = (node: ts.Node): void => {
    if (isFunction(node)) {
      const name = nameOf(node);
      if (name !== undefined) locals.set(name, node);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const readsItsText = (fn: FunctionNode): boolean => {
    const params = textParams(fn);
    if (params.size === 0 || fn.body === undefined) return false;
    return findTextUse(fn.body, (node) => isText(node, params), true) !== undefined;
  };

  const visit = (node: ts.Node): void => {
    if (isFunction(node)) {
      const name = nameOf(node);
      if (name !== undefined && CODE_NAME.test(name) && readsItsText(node)) {
        report(node, `${name} takes a text and finds a code from it`);
      }
    }
    const params = enclosingParams(node);
    const onText = (value: ts.Node) => isText(value, params);
    const value = codeValue(node);
    if (value !== undefined && findTextUse(value, onText, false) !== undefined) {
      report(node, 'a code is found from a text with a string method');
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== undefined && CODE_NAME.test(name) && node.arguments.some(onText)) {
        report(node, `${name} is called with a text to find a code`);
      }
    }
    if (value !== undefined) {
      const calls: ts.CallExpression[] = [];
      const gather = (inner: ts.Node): void => {
        if (ts.isCallExpression(inner)) calls.push(inner);
        ts.forEachChild(inner, gather);
      };
      gather(value);
      for (const call of calls) {
        const local = ts.isIdentifier(call.expression) ? locals.get(call.expression.text) : undefined;
        if (local !== undefined && call.arguments.some(onText) && readsItsText(local)) {
          report(call, 'a code is the result of a function of this file that reads the text');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

describe('no function finds a code from a message', () => {
  it('flags a table of message prefixes that answers with a code', () => {
    const source = `
      const PREFIXES = ['the answer is not JSON', 'the answer is not a JSON object'];
      export const answerCode = (message: string): string | undefined =>
        PREFIXES.find((prefix) => message.startsWith(prefix));
    `;
    expect(findMessageToCode('table.ts', source)).not.toEqual([]);
  });

  it('flags a code function that compares, looks up or switches on its text', () => {
    const compared = `
      const ABSENT = 'the text is not in the unit';
      const spanTextCode = (reason: string): string => (reason === ABSENT ? 'span-text-absent' : 'other');
    `;
    const looked = `
      const TABLE = new Map([['the answer is not JSON', 'answer-not-json']]);
      function answerCode(message: string) { return TABLE.get(message); }
    `;
    const switched = `
      function labelCode(message: string) {
        switch (message) { case 'a': return 'x'; default: return 'y'; }
      }
    `;
    const matched = 'const failureCode = (text: string) => (/json/.test(text) ? "a" : "b");';
    for (const source of [compared, looked, switched, matched]) {
      expect(findMessageToCode('code.ts', source)).not.toEqual([]);
    }
  });

  it('flags a code value taken from a message with a string method', () => {
    const field = `
      class Failure extends Error {
        readonly code: string;
        constructor(message: string) {
          super(message);
          this.code = message.includes('json') ? 'answer-not-json' : 'answer-unreadable';
        }
      }
    `;
    const property = `
      function raise(message: string) {
        return new Failure(message, { code: message.startsWith('the answer') ? 'a' : 'b' });
      }
    `;
    for (const source of [field, property]) {
      expect(findMessageToCode('value.ts', source)).not.toEqual([]);
    }
  });

  it('flags a call that passes a text to a code function, and a local helper that reads it', () => {
    const called = 'function fail(reason: string) { return window(answerCode(reason), reason); }';
    const helper = `
      function classify(message: string) { return /json/.test(message) ? 'a' : 'b'; }
      function raise(message: string) { throw new Failure(message, { code: classify(message) }); }
    `;
    for (const source of [called, helper]) {
      expect(findMessageToCode('call.ts', source)).not.toEqual([]);
    }
  });

  it('does not flag a throw site that passes its code as a literal', () => {
    const source = `
      export function parse(text: string) {
        if (text.trim() === '') {
          throw new LabelerError('the answer is not JSON', { code: 'answer-not-json' });
        }
        return text.startsWith('{') ? JSON.parse(text) : undefined;
      }
    `;
    expect(findMessageToCode('throw.ts', source)).toEqual([]);
  });

  it('does not flag a code that is read from a field, a default, or a record', () => {
    const source = `
      const UNKNOWN_CODE = 'unknown';
      type Recorded = { code?: string; error?: string };
      function describeFailure(message: string) { return message.startsWith('the'); }
      const codeSpanOf = (text: string) => /\`([^\`]+)\`/.exec(text)?.[1];
      export function codeOfAnswer(answer: Recorded): string { return answer.code ?? UNKNOWN_CODE; }
      export function build(code: string, detail: string) { return { code, detail }; }
      export function failure(cause: { code: string }, answer: Recorded) {
        return { code: cause.code, other: answer.code ?? UNKNOWN_CODE };
      }
    `;
    expect(findMessageToCode('fields.ts', source)).toEqual([]);
  });

  it('finds none in the source of the pointer reader', () => {
    const root = fileURLToPath(new URL('../../src/pointer', import.meta.url));
    const names = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .sort();
    expect(names.length).toBeGreaterThan(15);
    const findings = names.flatMap((name) => findMessageToCode(name, readFileSync(join(root, name), 'utf8')));
    expect(findings).toEqual([]);
  });
});
