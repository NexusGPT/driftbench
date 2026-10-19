import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { type CliResult, need } from '../../blocks/product';
import { type BankItem, fail, type ItemContext, PASS, type Tier } from '../../blocks/types';
import { word } from '../../blocks-breaker/kit';
import { CAUSES, type PlantedCause } from './causes';

/**
 * The kit of the growth lane "plantedbugs": an item whose cause and contract come from this folder's cause table,
 * seeded tokens for every name and value the product reads, files in the item's own folder, and the command line.
 * Every item is a twin: the shape its doc passes beside the shape it fails, so a product that always answers one
 * way fails it. They pass where the behaviour is built and guard against a planted bug: catch items.
 */

export type { BankItem, ItemContext, Tier };

export const FAMILY = 'plantedbugs';
export const CORE = 'packages/core';
export const CLI = 'packages/cli';
export const SANDBOX = 'packages/sandbox';
export const REPORT = 'packages/report';

export type Probe = (ctx: ItemContext) => Promise<ReadonlyArray<string | undefined | false>>;

/** An item of the lane: the first string its probe returns is the failure. */
export function pitem(
  id: string,
  tier: Tier,
  level: number,
  component: string,
  cause: PlantedCause,
  title: string,
  probe: Probe,
): BankItem {
  const entry = CAUSES[cause];
  return {
    id,
    family: FAMILY,
    tier,
    level,
    component,
    title,
    cause: entry.text,
    contract: entry.contract,
    role: 'catch',
    check: async (ctx) => {
      try {
        const first = (await probe(ctx)).find((each): each is string => typeof each === 'string');
        return first === undefined
          ? PASS
          : fail(`${entry.contract.replace('#', ' "')}"; the product answered: ${first}`.slice(0, 700));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('the loader refuses') || message.startsWith('the product has no export'))
          return fail(`${entry.contract}: ${message.slice(0, 300)}`);
        throw error;
      }
    },
  };
}

/** A seeded token of letters only, unique to the item and the slot. */
export const tok = (ctx: ItemContext, tag: string, slot: string, length = 7): string =>
  word(ctx.seed, `pb:${tag}:${slot}`, length);

/** Two seeded tokens that differ. */
export function twoTokens(ctx: ItemContext, tag: string, slot: string, length = 8): [string, string] {
  const one = tok(ctx, tag, `${slot}:1`, length);
  const two = tok(ctx, tag, `${slot}:2`, length);
  return [one, two === one ? `${two}q` : two];
}

export const show = (value: unknown): string => {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
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

export type Issue = { level?: string; code?: string; path?: string; message?: string };
export type CheckEntry = { path?: string; ok?: boolean; errors?: Issue[]; warnings?: Issue[] };

/** The entries of a `spec validate --json` or `spec lint --json` output, or what it printed instead. */
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

/** The loader of a spec file: ok with the spec, or the codes of its errors. */
export async function loadFile(
  ctx: ItemContext,
  path: string,
): Promise<{ ok: boolean; spec?: unknown; codes: string[] }> {
  const loadSpecFile = need<
    (path: string) => Promise<{ ok: boolean; spec?: unknown; errors?: { code?: string }[] }>
  >(ctx.product.core, 'core', 'loadSpecFile');
  const loaded = await loadSpecFile(path);
  return loaded.ok
    ? { ok: true, spec: loaded.spec, codes: [] }
    : { ok: false, codes: (loaded.errors ?? []).map((each) => each.code ?? '') };
}
