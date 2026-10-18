import type { DatabaseSync as Handle } from 'node:sqlite';

/**
 * Loads `node:sqlite` at call time through the runtime, not as an import: a bundler does not know the module and
 * rewrites its name, so the built package would fail to load it.
 */
export function sqliteModule(): typeof import('node:sqlite') {
  const loaded =
    typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule('node:sqlite') : undefined;
  if (loaded === undefined)
    throw new Error('node:sqlite is not available: the SQL check needs Node.js 22.5 or later');
  return loaded as typeof import('node:sqlite');
}

import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';

/**
 * `expect.sql`: the SQL the agent ran, read from the input of its call to `tool` (the input's `query` field),
 * must return the same rows as `golden` on the SQLite database at `database`.
 *
 * Both queries run on a read-only handle, and only one read statement is accepted: a write is refused before it
 * runs. The rows compare as a multiset, so row order does not matter, unless the golden query orders its rows.
 * Column names do not compare; values do.
 */

export const READ_ONLY_LEAD = /^(select|with)\b/i;

/** One statement of an SQL text: `text` without its comments, `code` the same with literal contents emptied. */
export type SqlStatement = { text: string; code: string };

const CLOSER: Record<string, string> = { "'": "'", '"': '"', '`': '`', '[': ']' };

/**
 * Splits an SQL text into its statements the way SQLite reads it: a semicolon inside a string literal, a quoted
 * identifier (`"x"`, `` `x` `` or `[x]`) or a comment is text and ends nothing; a `--` comment runs to the end
 * of its line and a block comment to its closing mark. Comments are dropped from `text` and `code`. A statement
 * left empty, such as the one a doubled final semicolon leaves, is not a statement.
 */
export function sqlStatements(text: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  let raw = '';
  let code = '';
  const flush = () => {
    if (raw.trim() !== '') out.push({ text: raw.trim(), code: code.trim() });
    raw = '';
    code = '';
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    const closer = CLOSER[char];
    if (closer !== undefined) {
      let end = i + 1;
      while (end < text.length && text[end] !== closer) end++;
      const literal = text.slice(i, Math.min(end + 1, text.length));
      raw += literal;
      code += `${char}${closer}`;
      i += literal.length;
    } else if (char === '-' && text[i + 1] === '-') {
      let end = i + 2;
      while (end < text.length && text[end] !== '\n') end++;
      raw += ' ';
      code += ' ';
      i = end;
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      raw += ' ';
      code += ' ';
      i = end < 0 ? text.length : end + 2;
    } else if (char === ';') {
      flush();
      i++;
    } else {
      raw += char;
      code += char;
      i++;
    }
  }
  flush();
  return out;
}

/** The one statement a query holds, or undefined when it holds more than one or is not a read. */
export function singleReadStatement(query: string): string | undefined {
  return singleRead(query)?.text;
}

function singleRead(query: string): SqlStatement | undefined {
  const statements = sqlStatements(query);
  const only = statements[0];
  if (statements.length !== 1 || only === undefined) return undefined;
  return READ_ONLY_LEAD.test(only.text) ? only : undefined;
}

function rowsOf(handle: Handle, sql: string): string[] {
  const statement = handle.prepare(sql);
  return (statement.all() as Record<string, unknown>[]).map((row) =>
    JSON.stringify(Object.values(row), (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((row, index) => row === sortedB[index]);
}

export const sqlEquivalence: Check = {
  name: 'sql',
  applies: (ctx) => ctx.expect.sql !== undefined,
  evaluate(ctx) {
    const entry = ctx.expect.sql;
    if (entry === undefined) return [];
    const call = [...ctx.observed.toolCalls].reverse().find((item) => item.label === entry.tool);
    if (call === undefined) {
      return [
        machineVerdict('sql', '0', 'fail', `no call to ${entry.tool} in the block, so no query to compare`),
      ];
    }
    const input = call.input;
    const agent =
      typeof input === 'object' && input !== null && 'query' in input
        ? (input as { query: unknown }).query
        : undefined;
    if (typeof agent !== 'string') {
      return [machineVerdict('sql', '0', 'fail', `the ${entry.tool} call has no query text in its input`)];
    }
    const agentRead = singleRead(agent);
    const goldenRead = singleRead(entry.golden);
    const agentSql = agentRead?.text;
    const goldenSql = goldenRead?.text;
    if (agentSql === undefined) {
      return [machineVerdict('sql', '0', 'fail', `not a read-only query: ${JSON.stringify(agent)}`)];
    }
    if (goldenSql === undefined) {
      return [machineVerdict('sql', '0', 'inconclusive', 'the golden query is not one read statement')];
    }
    let handle: Handle;
    try {
      handle = new (sqliteModule().DatabaseSync)(entry.database, { readOnly: true });
    } catch (cause) {
      return [machineVerdict('sql', '0', 'inconclusive', `the database cannot be opened: ${message(cause)}`)];
    }
    try {
      let expected: string[];
      try {
        expected = rowsOf(handle, goldenSql);
      } catch (cause) {
        return [machineVerdict('sql', '0', 'inconclusive', `the golden query fails: ${message(cause)}`)];
      }
      let found: string[];
      try {
        found = rowsOf(handle, agentSql);
      } catch (cause) {
        return [machineVerdict('sql', '0', 'fail', `the query fails: ${message(cause)}`)];
      }
      const ordered = /\border\s+by\b/i.test(goldenRead?.code ?? goldenSql);
      const same = ordered
        ? found.length === expected.length && found.every((row, i) => row === expected[i])
        : sameMultiset(found, expected);
      if (same) return [machineVerdict('sql', '0', 'pass', `the rows match: ${found.length} row(s)`)];
      const detail =
        found.length !== expected.length
          ? `returns ${found.length} rows, the golden returns ${expected.length}`
          : `the rows differ at the same count of ${found.length}`;
      return [machineVerdict('sql', '0', 'fail', detail) as Verdict];
    } finally {
      handle.close();
    }
  },
};

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
