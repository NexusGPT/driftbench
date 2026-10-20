import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { call } from './exact';
import { type BankItem, fail, ok, show } from './item';

/**
 * Capabilities the statistics package does not have yet, as items. Each group of functions is a fixture,
 * `packages/validators/fixtures/stats/newcaps-<group>.json`, written by `make_newcaps_<group>.py` from exact
 * arithmetic (fractions and 120-digit decimals, standard library only, no driftbench code). The functions are
 * defined on the group's page, docs/statistics/<group>.md. A function gives two items:
 * - `newcap.<fn>.values`: every case gives the expected value within the tolerance of the function;
 * - `newcap.<fn>.domain`: every value case returns and every domain case throws a RangeError.
 * Both share one cause, the absence of the function, so a function is one cause however many cases it has.
 * They are the last level, `capabilities`, so a missing capability never hides a regression in the levels below.
 */

const DIR = 'packages/validators/fixtures/stats';
const FILE = /^newcaps-([a-z0-9-]+)\.json$/;

type Tol = { rel: number; abs: number };
const DEFAULT_TOL: Tol = { rel: 1e-11, abs: 1e-300 };

type FunctionEntry = {
  fn: string;
  module: string;
  doc: string;
  values: Array<{ args: unknown[]; expected: unknown }>;
  domain: Array<{ args: unknown[] }>;
  tol?: Partial<Tol>;
};
type Group = { group: string; functions: FunctionEntry[] };

/** The groups on disk, sorted by name so the bank order never depends on the directory listing. */
export function newcapGroups(root: string): Group[] {
  return readdirSync(join(root, DIR))
    .filter((name) => FILE.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(root, DIR, name), 'utf8')) as Group);
}

function revive(value: unknown): unknown {
  if (value === 'NaN') return Number.NaN;
  if (value === 'Infinity') return Number.POSITIVE_INFINITY;
  if (value === '-Infinity') return Number.NEGATIVE_INFINITY;
  if (Array.isArray(value)) return value.map(revive);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  return value;
}

/** Walks `want` and `got` together; numbers match within the tolerance, everything else exactly. */
function compare(path: string, got: unknown, want: unknown, tol: Tol, out: string[]): void {
  if (typeof want === 'number') {
    if (typeof got !== 'number' || Number.isNaN(got)) {
      out.push(`${path || 'result'}: got ${show(got)}, want ${want}`);
      return;
    }
    if (!Number.isFinite(want)) {
      if (got !== want) out.push(`${path || 'result'}: got ${got}, want ${want}`);
      return;
    }
    if (!(Math.abs(got - want) <= tol.abs + tol.rel * Math.abs(want)))
      out.push(`${path || 'result'}: got ${got}, want ${want}`);
    return;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) {
      out.push(`${path || 'result'}: got ${show(got)}, want ${show(want)}`);
      return;
    }
    want.forEach((w, i) => {
      compare(`${path}[${i}]`, got[i], w, tol, out);
    });
    return;
  }
  if (want !== null && typeof want === 'object') {
    if (got === null || typeof got !== 'object') {
      out.push(`${path || 'result'}: got ${show(got)}, want an object`);
      return;
    }
    for (const [k, w] of Object.entries(want))
      compare(path === '' ? k : `${path}.${k}`, (got as Record<string, unknown>)[k], w, tol, out);
    return;
  }
  if (got !== want) out.push(`${path || 'result'}: got ${show(got)}, want ${show(want)}`);
}

function missing(error: Error): boolean {
  return error.message.includes('is not exported');
}

function itemsOf(group: string, entry: FunctionEntry): BankItem[] {
  const cause = `${entry.fn} is missing from @agent-nexus/driftbench-stats`;
  const component = `packages/stats/src/${entry.module}.ts`;
  const tol: Tol = { ...DEFAULT_TOL, ...entry.tol };
  const where = `${entry.fn} is defined in ${entry.doc}; add it to ${component} and export it from packages/stats/src/index.ts`;
  const values: BankItem = {
    id: `newcap.${entry.fn}.values`,
    family: `newcap-${group}`,
    tier: 3,
    level: 'capabilities',
    component,
    cause,
    check: ({ s }) => {
      const misses: string[] = [];
      for (const [i, c] of entry.values.entries()) {
        let got: unknown;
        try {
          got = call(s, entry.fn, ...(revive(c.args) as unknown[]));
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          if (missing(error)) return fail(`${entry.fn} does not exist in the statistics package. ${where}.`);
          misses.push(`case ${i} ${show(c.args)} threw ${error.name}: ${error.message}`);
          continue;
        }
        const found: string[] = [];
        compare('', got, revive(c.expected), tol, found);
        if (found.length > 0) misses.push(`case ${i} ${show(c.args)}: ${found.slice(0, 2).join('; ')}`);
      }
      return misses.length === 0
        ? ok(`${entry.values.length} cases match`)
        : fail(
            `${entry.fn} differs from the exact reference in ${misses.length} of ${entry.values.length} cases; see ${entry.doc}: ${misses.slice(0, 3).join(' | ')}`,
          );
    },
  };
  const domain: BankItem = {
    id: `newcap.${entry.fn}.domain`,
    family: `newcap-${group}`,
    tier: 2,
    level: 'capabilities',
    component,
    cause,
    check: ({ s }) => {
      // Refusing is checking only when valid input is accepted: a function that throws on everything fails here.
      for (const [i, c] of entry.values.entries()) {
        try {
          call(s, entry.fn, ...(revive(c.args) as unknown[]));
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          if (missing(error)) return fail(`${entry.fn} does not exist in the statistics package. ${where}.`);
          return fail(
            `${entry.fn} throws on valid input, so its refusals check nothing: value case ${i} ${show(c.args)} threw ${error.name}: ${error.message}; see ${entry.doc}`,
          );
        }
      }
      const misses: string[] = [];
      for (const [i, c] of entry.domain.entries()) {
        try {
          const got = call(s, entry.fn, ...(revive(c.args) as unknown[]));
          misses.push(`case ${i} ${show(c.args)} returned ${show(got)} instead of throwing a RangeError`);
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          if (missing(error)) return fail(`${entry.fn} does not exist in the statistics package. ${where}.`);
          if (error.name !== 'RangeError')
            misses.push(
              `case ${i} ${show(c.args)} threw ${error.name} (${error.message}), want a RangeError`,
            );
        }
      }
      return misses.length === 0
        ? ok(`${entry.domain.length} cases throw a RangeError`)
        : fail(
            `${entry.fn} must throw a RangeError on invalid input, as the conventions of docs/statistics/capabilities.md and ${entry.doc} say: ${misses.slice(0, 3).join(' | ')}`,
          );
    },
  };
  return [values, domain];
}

/** The items of every group, or of the groups named (an author checks one group at a time). */
export function newcapItems(root: string, only?: readonly string[]): BankItem[] {
  return newcapGroups(root)
    .filter((g) => only === undefined || only.includes(g.group))
    .flatMap((g) => g.functions.flatMap((entry) => itemsOf(g.group, entry)));
}
