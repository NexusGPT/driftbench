import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { type Call, load, type RunRecord, rngFor, scriptedAdapter } from '../../blocks/harness';
import { type BlocksProduct, type CliResult, constant, need } from '../../blocks/product';
import { type BankItem, fail, type ItemContext, PASS, type Tier } from '../../blocks/types';
import { type BlockDef, behaviour, injecting, type Scenario, scenario, word } from '../../blocks-breaker/kit';
import { CAUSES, type DocgapCause } from './causes';

/**
 * The scenario kit of the growth lane "docgaps": rows of one conversation (what a scripted agent does and what the
 * block expects), a run through the product's own runner in mode T, F or P, readers of the record, spec files in the
 * item's own folder for the command line, and an `item` whose cause and contract come from this folder's cause table.
 * Every name the product reads is a seeded word of letters: nothing it sees says what an item expects.
 */

export type { BankItem, Call, ItemContext, RunRecord, Scenario, Tier };
export { PASS, scenario, word };

export const CHECKS_PKG = 'packages/checks';
export const CORE_PKG = 'packages/core';
export const CLI_PKG = 'packages/cli';
export const ADAPTERS_PKG = 'packages/adapters';

/** One block of a conversation: what the agent does and what the block expects. */
export type Row = {
  text?: string;
  calls?: Call[];
  /** The stage the runtime reports in this block. */
  stage?: string;
  /** Fields that replace fields of the Observed the agent returns (`runtime`, `segments`, `cost`, ...). */
  extra?: Record<string, unknown>;
  expect?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  given?: Record<string, unknown>;
  say?: (marker: string) => string | [string, string];
};

export type Exec = {
  /** Keys added to the spec beside `blocks` (`rules`, `metadata`, `stages`, `perturbations`). */
  spec?: Record<string, unknown>;
  mode?: 'F' | 'T' | 'P';
  /** Mode P: the spec's perturbation the injecting driver adds. */
  perturbationId?: string;
  /** The checks the runner applies: the product's defaults when absent. */
  checks?: (product: BlocksProduct) => unknown;
};

export function sceneOf(
  ctx: ItemContext,
  tag: string,
  rows: readonly Row[],
  spec: Record<string, unknown> = {},
) {
  const defs: BlockDef[] = rows.map((row) => ({
    plan: {
      text: row.text ?? 'Done.',
      calls: row.calls ?? [],
      ...(row.stage ? { stage: row.stage } : {}),
      ...(row.extra ? { extra: row.extra } : {}),
    },
    ...(row.expect ? { expect: row.expect } : {}),
    ...(row.budget ? { budget: row.budget } : {}),
    ...(row.given ? { given: row.given } : {}),
    ...(row.say ? { say: row.say } : {}),
  }));
  return scenario(ctx.seed, tag, defs, spec);
}

/** The record of one run of `rows` through the product's runner. */
export async function exec(ctx: ItemContext, tag: string, rows: readonly Row[], options: Exec = {}) {
  const sc = sceneOf(ctx, tag, rows, options.spec ?? {});
  return execScene(ctx, sc, options);
}

export async function execScene(ctx: ItemContext, sc: Scenario, options: Exec = {}): Promise<RunRecord> {
  const rng = rngFor(ctx.seed, `dg:${sc.raw.id}:agent`);
  const adapter = scriptedAdapter(ctx.product, behaviour(sc, rng));
  const spec = load(ctx.product, sc.raw);
  const runSpec = need<(spec: unknown, options: Record<string, unknown>) => Promise<RunRecord>>(
    ctx.product.core,
    'core',
    'runSpec',
  );
  const createScriptedDriver = need<() => unknown>(ctx.product.users, 'users', 'createScriptedDriver');
  const defaultChecks = need<() => unknown>(ctx.product.checks, 'checks', 'defaultChecks');
  const defaultReaders = need<() => unknown>(ctx.product.artifacts, 'artifacts', 'defaultReaders');
  const mode = options.mode ?? 'F';
  return runSpec(spec, {
    adapter,
    driver:
      mode === 'P' && options.perturbationId
        ? injecting(ctx.product, options.perturbationId)
        : createScriptedDriver(),
    checks: options.checks ? options.checks(ctx.product) : defaultChecks(),
    artifacts: defaultReaders(),
    mode,
    repeat: 0,
    ...(mode === 'P' && options.perturbationId ? { perturbationId: options.perturbationId } : {}),
    retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} },
    now: constant(new Date('2026-10-16T00:00:00.000Z')),
  });
}

export type VerdictRow = {
  id: string;
  outcome: string;
  gating: boolean;
  score?: number;
  evidence?: unknown;
};

export const verdictsOf = (rec: RunRecord, block: number): VerdictRow[] =>
  (rec.blocks[block]?.verdicts ?? []) as VerdictRow[];
export const verdict = (rec: RunRecord, block: number, id: string): VerdictRow | undefined =>
  verdictsOf(rec, block).find((each) => each.id === id);
export const idsAt = (rec: RunRecord, block: number): string[] =>
  verdictsOf(rec, block).map((each) => each.id);
export const evidenceOf = (row: VerdictRow | undefined): string =>
  typeof row?.evidence === 'string' ? row.evidence : JSON.stringify(row?.evidence ?? '');

/** `undefined` when the verdict is as expected, else what was found. */
export function expectV(
  rec: RunRecord,
  block: number,
  id: string,
  outcome: 'pass' | 'fail' | 'inconclusive',
  gating?: boolean,
): string | undefined {
  const found = verdict(rec, block, id);
  if (!found)
    return `block ${block}: no verdict ${id}; the block has ${
      idsAt(rec, block)
        .filter((each) => !each.startsWith('pii.'))
        .join(', ') || 'no other verdict'
    }`;
  if (found.outcome !== outcome)
    return `block ${block}: ${id} should be ${outcome}; it is ${found.outcome} (${evidenceOf(found).slice(0, 120)})`;
  if (gating !== undefined && found.gating !== gating)
    return `block ${block}: ${id} should ${gating ? 'gate' : 'not gate'}; it ${found.gating ? 'gates' : 'does not gate'}`;
  return undefined;
}

/** `undefined` when the block has no verdict whose id is `prefix` or starts with `prefix.`. */
export function expectNone(rec: RunRecord, block: number, prefix: string): string | undefined {
  const found = idsAt(rec, block).filter((id) => id === prefix || id.startsWith(`${prefix}.`));
  return found.length === 0
    ? undefined
    : `block ${block}: no ${prefix} verdict should exist; found ${found.join(', ')}`;
}

export function expectPass(rec: RunRecord, block: number, should: boolean): string | undefined {
  const passed = rec.blocks[block]?.pass === true;
  return passed === should
    ? undefined
    : `block ${block} should ${should ? 'pass' : 'fail'}; it ${passed ? 'passes' : 'fails'} (gating not passing: ${verdictsOf(
        rec,
        block,
      )
        .filter((each) => each.gating && each.outcome !== 'pass')
        .map((each) => each.id)
        .join(', ')})`;
}

export type Probe = (ctx: ItemContext) => Promise<ReadonlyArray<string | undefined | false>>;

/** An item of the lane: its cause gives its text and its contract. */
export function gitem(
  family: string,
  id: string,
  tier: Tier,
  component: string,
  cause: DocgapCause,
  title: string,
  probe: Probe,
  level = 1,
): BankItem {
  const entry = CAUSES[cause];
  return {
    id,
    family,
    tier,
    level,
    component,
    title,
    cause: entry.text,
    contract: entry.contract,
    check: async (ctx) => {
      try {
        const first = (await probe(ctx)).find((each): each is string => typeof each === 'string');
        return first === undefined
          ? PASS
          : fail(
              `${entry.text} (${entry.contract.replace('#', ' "')}"); the product answered: ${first}`.slice(
                0,
                700,
              ),
            );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('the loader refuses'))
          return fail(
            `a spec the docs define loads (${entry.contract}); the product answered: ${message.slice(0, 260)}`,
          );
        if (message.startsWith('the product has no export'))
          return fail(
            `the capability the docs define is exported (${entry.contract}); the product answered: ${message}`,
          );
        throw error;
      }
    },
  };
}

/** A seeded token of letters only, unique to the item and the slot. */
export const tok = (ctx: ItemContext, tag: string, slot: string, length = 7): string =>
  word(ctx.seed, `dg:${tag}:${slot}`, length);

export const show = (value: unknown): string => {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

/** A folder of the item's own scratch space. */
export function folder(ctx: ItemContext, tag: string): string {
  const dir = join(ctx.scratch, tok(ctx, tag, 'dir', 9));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes a file (YAML for a value that is not a string), making its folder; returns its path. */
export function writeAt(path: string, content: unknown): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : stringify(content));
  return path;
}

/** The command line in `cwd`. */
export const cli = (ctx: ItemContext, argv: readonly string[], cwd: string): Promise<CliResult> =>
  ctx.product.cli(argv, cwd);

/** The issues of a `spec validate --json` or `spec lint --json` entry. */
export type Issue = { level?: string; code?: string; path?: string; message?: string };
export type CheckEntry = { path?: string; ok?: boolean; errors?: Issue[]; warnings?: Issue[] };

export function parseEntries(out: string): CheckEntry[] | string {
  try {
    const parsed = JSON.parse(out) as unknown;
    return Array.isArray(parsed) ? (parsed as CheckEntry[]) : `not a JSON array: ${out.slice(0, 120)}`;
  } catch {
    return `not JSON: ${out.slice(0, 160)}`;
  }
}

export const codesOf = (issues: readonly Issue[] | undefined): string[] =>
  (issues ?? []).map((each) => each.code ?? '');
