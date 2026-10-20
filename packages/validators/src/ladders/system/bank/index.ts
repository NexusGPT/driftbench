import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BankEntry, bankMeasure, type Measure } from '../../../ladder';
import { adaptersItems } from './claims/adapters';
import { breakerItems } from './claims/breaker';
import { breaker2Items } from './claims/breaker2';
import { checksItems } from './claims/checks';
import { cliItems as cliClaimItems } from './claims/cli';
import { conceptsItems } from './claims/concepts';
import { exitItems } from './claims/exits';
import { reportItems } from './claims/report';
import { robustItems } from './claims/robust';
import { specItems } from './claims/spec';
import { cliItems } from './cli';
import { comboItems } from './combos';
import { fieldItems } from './fields';
import { linkItems } from './links';
import { auditItems } from './links-audit';
import { linkChainItems } from './links-chain';
import { precisionItems } from './precision';
import { reachItems } from './reach';
import { recordItems } from './records';
import { replayItems } from './replay';
import { scaleItems } from './scale';
import { BANK_LEVELS, type BankItem, type ItemResult } from './types';
import { varianceItems } from './variance';
import { verdictItems } from './verdicts';
import { versionItems } from './version';

export * from './types';

/** Section 12.1: the bank at merge holds at least this many items, no family under the second number. */
export const MIN_BANK = 300;
export const MIN_FAMILY = 20;

/** Every item of the system bank, in level order. Generated: no item is written twice. */
export function systemBank(): BankItem[] {
  const items = [
    ...recordItems(),
    ...comboItems(),
    ...reachItems(),
    ...precisionItems(),
    ...fieldItems(),
    ...varianceItems(),
    ...versionItems(),
    ...reportItems(),
    ...checksItems(),
    ...specItems(),
    ...conceptsItems(),
    ...cliClaimItems(),
    ...adaptersItems(),
    ...breakerItems(),
    ...breaker2Items(),
    ...robustItems(),
    ...exitItems(),
    ...replayItems(),
    ...cliItems(),
    ...scaleItems(),
    ...linkItems(),
    ...linkChainItems(),
    ...auditItems(),
    ...verdictItems(),
  ];
  return items.sort((a, b) => a.level - b.level);
}

/** The shape rules of section 12.1, as problems: unique ids, sizes, every tier, every level. */
export function bankProblems(items: readonly BankItem[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) problems.push(`the id ${item.id} appears twice`);
    ids.add(item.id);
  }
  if (items.length < MIN_BANK) problems.push(`the bank holds ${items.length} items, under ${MIN_BANK}`);
  for (const [family, count] of countBy(items, (item) => item.family)) {
    if (count < MIN_FAMILY) problems.push(`the family ${family} holds ${count} items, under ${MIN_FAMILY}`);
  }
  for (const item of items) if (item.cause.trim() === '') problems.push(`the item ${item.id} names no cause`);
  for (const tier of [1, 2, 3, 4, 5])
    if (!items.some((item) => item.tier === tier)) problems.push(`no item of tier ${tier}`);
  for (const level of BANK_LEVELS)
    if (!items.some((item) => item.level === level.level)) problems.push(`level ${level.id} holds no item`);
  return problems;
}

export function countBy<T>(items: readonly T[], key: (item: T) => string | number): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(String(key(item)), (out.get(String(key(item))) ?? 0) + 1);
  return out;
}

/** Runs one item: a throw is a failure that names the error. */
/**
 * The seed an item sees. The visible seeds (1 to 20) pass as they are; the hidden seed (about 10 to the 9)
 * is folded into 1000 to 9999, still one value per commit, so an item that sizes its input from the seed
 * stays bounded.
 */
export function itemSeed(seed: number): number {
  return seed > 1000 ? 1000 + (seed % 9000) : seed;
}

export async function runItem(
  item: BankItem,
  seed: number,
  root: string,
  scratch: string,
): Promise<ItemResult> {
  try {
    return await item.check({ seed: itemSeed(seed), root, scratch });
  } catch (cause) {
    return {
      pass: false,
      detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/** A scratch folder for one run of items, removed by the returned function. */
export function scratchFolder(): { path: string; remove(): void } {
  const path = mkdtempSync(join(tmpdir(), 'driftbench-system-bank-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

/**
 * A level's measure: every item of the level run on this seed, as the frame's bank (docs/validators.md section
 * 12.1). A failing item's detail says what the item asks for and what it found, so an executor can act on it
 * without reading the validator: "asks: <capability>. found: <what came back>".
 */
export async function levelMeasure(items: readonly BankItem[], seed: number, root: string): Promise<Measure> {
  const scratch = scratchFolder();
  // Holds the event loop open while items run: a timer an item waits on may not (an aborted fetch's).
  const hold = setInterval(() => undefined, 60_000);
  try {
    const entries: BankEntry[] = [];
    for (const item of items) {
      const result = await runItem(item, seed, root, scratch.path);
      entries.push({
        id: item.id,
        component: item.component,
        family: item.family,
        tier: item.tier,
        cause: item.cause,
        pass: result.pass,
        ...(result.pass ? {} : { detail: `asks: ${item.title}. found: ${result.detail}` }),
      });
    }
    return bankMeasure(entries, 'system');
  } finally {
    clearInterval(hold);
    scratch.remove();
  }
}
