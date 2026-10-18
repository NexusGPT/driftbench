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

/** The one statement a query holds, or undefined when it holds more than one or is not a read. */
export function singleReadStatement(query: string): string | undefined {
  const trimmed = query.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';')) return undefined;
  return READ_ONLY_LEAD.test(trimmed) ? trimmed : undefined;
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
    const agentSql = singleReadStatement(agent);
    const goldenSql = singleReadStatement(entry.golden);
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
      const ordered = /\border\s+by\b/i.test(goldenSql);
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
