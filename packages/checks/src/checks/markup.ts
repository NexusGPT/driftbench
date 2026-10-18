import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { visibleText } from '../support/text';
import { sqliteModule, sqlStatements } from './sql';

/**
 * `expect.markup`: the customer-visible text is well-formed XML or HTML. A tag scanner walks the opening and
 * closing tags and checks that each close matches the open element beneath it. Comments, declarations and
 * self-closing tags are skipped. HTML void elements (br, img, input and the rest of the list) need no close
 * tag. The check reads structure only: it does not validate a schema or an element's attributes.
 */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * The first SQL syntax error, as SQLite reports it, or undefined. A statement that names a table or a column that
 * is not in a schema is valid syntax here: the check reads syntax only, with no database.
 */
export function sqlProblem(text: string): string | undefined {
  const db = new (sqliteModule().DatabaseSync)(':memory:');
  try {
    for (const { text: statement } of sqlStatements(text)) {
      try {
        db.prepare(statement);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (/syntax error/i.test(message)) return message;
      }
    }
    return undefined;
  } finally {
    db.close();
  }
}

export function markupProblem(text: string, kind: 'xml' | 'html'): string | undefined {
  const stack: string[] = [];
  const tag = /<!--[\s\S]*?-->|<![^>]*>|<\?[\s\S]*?\?>|<\s*(\/?)\s*([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  for (const match of text.matchAll(tag)) {
    if (match[2] === undefined) continue;
    const name = kind === 'html' ? match[2].toLowerCase() : match[2];
    const closing = match[1] === '/';
    const selfClosing = match[4] === '/';
    if (closing) {
      const open = stack.pop();
      if (open === undefined) return `</${match[2]}> closes nothing`;
      if (open !== name) return `</${match[2]}> closes while <${open}> is open`;
    } else if (!selfClosing && !(kind === 'html' && VOID.has(name))) {
      stack.push(name);
    }
  }
  const unclosed = stack.pop();
  return unclosed === undefined ? undefined : `<${unclosed}> is never closed`;
}

export const markup: Check = {
  name: 'markup',
  applies: (ctx) => ctx.expect.markup !== undefined,
  evaluate(ctx) {
    const kind = ctx.expect.markup;
    if (!kind) return [];
    const text = visibleText(ctx.observed);
    if (kind === 'sql') {
      const problem = sqlProblem(text);
      return [
        problem === undefined
          ? machineVerdict('markup', 'valid', 'pass', 'the reply is well-formed SQL (syntax only)')
          : machineVerdict('markup', 'valid', 'fail', `the reply is not well-formed SQL: ${problem}`),
      ];
    }
    const problem = markupProblem(text, kind);
    const verdicts: Verdict[] = [
      problem === undefined
        ? machineVerdict('markup', 'valid', 'pass', `the reply is well-formed ${kind.toUpperCase()}`)
        : machineVerdict(
            'markup',
            'valid',
            'fail',
            `the reply is not well-formed ${kind.toUpperCase()}: ${problem}`,
          ),
    ];
    return verdicts;
  },
};
