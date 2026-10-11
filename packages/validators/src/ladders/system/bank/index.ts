import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Item, Measure } from '../../../ladder';
import { cliItems } from './cli';
import { fieldItems } from './fields';
import { precisionItems } from './precision';
import { reachItems } from './reach';
import { recordItems } from './records';
import { replayItems } from './replay';
import { scaleItems } from './scale';
import { BANK_LEVELS, type BankItem, type ItemResult } from './types';
import { varianceItems } from './variance';
import { versionItems } from './version';

export * from './types';

/** Section 12.1: the bank at merge holds at least this many items, no family under the second number. */
export const MIN_BANK = 300;
export const MIN_FAMILY = 20;

/** Every item of the system bank, in level order. Generated: no item is written twice. */
export function systemBank(): BankItem[] {
  const items = [
    ...recordItems(),
    ...reachItems(),
    ...precisionItems(),
    ...fieldItems(),
    ...varianceItems(),
    ...versionItems(),
    ...replayItems(),
    ...cliItems(),
    ...scaleItems(),
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
export async function runItem(
  item: BankItem,
  seed: number,
  root: string,
  scratch: string,
): Promise<ItemResult> {
  try {
    return await item.check({ seed, root, scratch });
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

/** A level's measure: the share of its items that pass on this seed, and the failing ones as named items. */
export async function levelMeasure(items: readonly BankItem[], seed: number, root: string): Promise<Measure> {
  const scratch = scratchFolder();
  // Holds the event loop open while items run: a timer an item waits on may not (an aborted fetch's).
  const hold = setInterval(() => undefined, 60_000);
  try {
    const failing: Item[] = [];
    for (const item of items) {
      const result = await runItem(item, seed, root, scratch.path);
      if (!result.pass)
        failing.push({
          id: item.id,
          component: item.component,
          detail: `[${item.family}, tier ${item.tier}] ${result.detail}`,
        });
    }
    return { value: items.length === 0 ? 1 : (items.length - failing.length) / items.length, items: failing };
  } finally {
    clearInterval(hold);
    scratch.remove();
  }
}
