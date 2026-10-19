import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BlocksProduct, CliResult } from '../../blocks/product';
import { type BankItem, fail, type ItemContext, PASS, type Tier } from '../../blocks/types';
import { word } from '../../blocks-breaker/kit';
import { type C2Cause, CAUSES } from './causes';

/**
 * The kit of the growth lane "contracts2": an item maker whose cause gives its sentence and its contract, seeded
 * words of letters, and a project folder of input files for the command line. Every name the product reads is a
 * seeded word: nothing it sees says what an item expects.
 */

export type { BankItem, BlocksProduct, CliResult, ItemContext, Tier };

/** A probe: the conditions of one item, each `undefined` (or false) when it holds, else what the product did. */
export type Probe = (ctx: ItemContext) => Promise<ReadonlyArray<string | undefined | false>>;

/** An item of the lane. A refusal of a documented spec or a missing export is the product's answer. */
export function c2(
  family: string,
  id: string,
  tier: Tier,
  level: number,
  component: string,
  cause: C2Cause,
  title: string,
  probe: Probe,
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
      const heading = entry.contract.replace('#', ' "');
      try {
        const first = (await probe(ctx)).find((each): each is string => typeof each === 'string');
        return first === undefined
          ? PASS
          : fail(`${title} (${heading}"); the product answered: ${first}`.slice(0, 760));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('the loader refuses'))
          return fail(
            `a spec the docs define loads (${heading}"); the product answered: ${message.slice(0, 300)}`,
          );
        if (message.startsWith('the product has no export'))
          return fail(
            `the capability the docs define is exported (${heading}"); the product answered: ${message}`,
          );
        throw error;
      }
    },
  };
}

/** A seeded word of letters only, unique to the item and the slot. */
export const tok = (ctx: ItemContext, tag: string, slot: string, length = 7): string =>
  word(ctx.seed, `c2:${tag}:${slot}`, length);

export const show = (value: unknown): string => {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

/** `undefined` when `holds`, else the message. */
export const unless = (holds: boolean, message: string): string | undefined => (holds ? undefined : message);

/** The text a command printed, out and err. */
export const said = (result: CliResult): string => `${result.out}\n${result.err}`.trim();

/** A project folder of input files under the item's scratch: driftbench.yaml and the files, written as JSON. */
export function projectFolder(
  ctx: ItemContext,
  tag: string,
  files: Record<string, unknown>,
  config: Record<string, unknown> = {},
): string {
  const dir = join(ctx.scratch, `c2-${tok(ctx, tag, 'project', 10)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'driftbench.yaml'), JSON.stringify({ campaign: { repeats: 1 }, ...config }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

/** A command line that has no `object` command answers so; the item then fails on that. */
export const noCommand = (result: CliResult): string | undefined =>
  /unknown command/i.test(said(result))
    ? `the command line has no such command: ${said(result).slice(0, 160)}`
    : undefined;
