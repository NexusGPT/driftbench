import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BANK_LEVELS,
  type BankItem,
  type BlocksProduct,
  bankProblems,
  blocksBank,
  blocksLadder,
  CHEATERS,
  realProduct,
} from '../src/ladders/blocks/index';
import { registeredLadders } from '../src/ladders/index';

/**
 * The blocks validator (docs/validators.md section 13). Every item must fail on a product that takes a
 * shortcut (the cheaters of its level) and pass on a correct one. The levels on main today (verdicts, tool
 * history, blast radius) pass on this repository; the others are checked against their pull requests' heads
 * when they change, and fail here until those land.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SEED = 1;
const bank = blocksBank();
const scratches: string[] = [];

afterAll(() => {
  for (const path of scratches) rmSync(path, { recursive: true, force: true });
});

/** Runs one item on one product in a scratch folder of its own, so no run sees another's files. */
async function passes(item: BankItem, product: BlocksProduct): Promise<boolean> {
  const scratch = mkdtempSync(join(tmpdir(), 'blocks-test-'));
  scratches.push(scratch);
  try {
    return (await item.check({ seed: SEED, root: ROOT, scratch, product })).pass;
  } catch {
    return false;
  }
}

describe('the blocks bank', () => {
  it('holds the section 12.1 minimum: 300 items, no family under 20, every tier, every level, unique ids', () => {
    expect(bankProblems(bank)).toEqual([]);
    expect(bank.length).toBeGreaterThanOrEqual(300);
  });

  it('is registered as the blocks validator with one level per capability', () => {
    const ladder = registeredLadders().blocks;
    expect(ladder?.component).toBe('blocks');
    expect(ladder?.levels.map((level) => level.id)).toEqual(BANK_LEVELS.map((level) => level.id));
    expect(blocksLadder().levels).toHaveLength(10);
  });

  it('gives every level at least one cheater, and every cheater a level', () => {
    for (const level of BANK_LEVELS) expect(CHEATERS.some((c) => c.levels.includes(level.level))).toBe(true);
    for (const cheater of CHEATERS) expect(cheater.levels.length).toBeGreaterThan(0);
  });
});

describe('every item fails on a cheating product', () => {
  const real = realProduct();
  it.for(BANK_LEVELS.map((level) => level.level))('level %i', { timeout: 600_000 }, async (level) => {
    const cheaters = CHEATERS.filter((cheater) => cheater.levels.includes(level)).map((cheater) =>
      cheater.make(real),
    );
    const survivors: string[] = [];
    for (const item of bank.filter((each) => each.level === level)) {
      let caught = false;
      for (const cheater of cheaters) {
        if (!(await passes(item, cheater))) {
          caught = true;
          break;
        }
      }
      if (!caught) survivors.push(item.id);
    }
    expect(survivors).toEqual([]);
  });

  it.for(CHEATERS.map((cheater) => cheater.name))(
    'the cheater %s fails at least one item',
    { timeout: 600_000 },
    async (name) => {
      const cheater = CHEATERS.find((each) => each.name === name);
      if (!cheater) throw new Error(`no cheater ${name}`);
      const product = cheater.make(real);
      let failed = 0;
      for (const item of bank.filter((each) => cheater.levels.includes(each.level))) {
        if (!(await passes(item, product))) failed += 1;
        if (failed > 0) break;
      }
      expect(failed).toBeGreaterThan(0);
    },
  );
});

describe('the levels on main pass on a correct product', () => {
  const real = realProduct();
  // Verdicts (PR 428), tool history (phase 3) and the blast radius are merged; their items are the truth of main.
  it.for([1, 2, 9])('level %i passes item by item on seed 1', { timeout: 600_000 }, async (level) => {
    const failing: string[] = [];
    for (const item of bank.filter((each) => each.level === level))
      if (!(await passes(item, real))) failing.push(item.id);
    expect(failing).toEqual([]);
  });
});
