import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runLadder } from '../../src/index';
import {
  BANK_LEVELS,
  type BankItem,
  bankProblems,
  countBy,
  fail,
  levelMeasure,
  MIN_BANK,
  MIN_FAMILY,
  PASS,
  scratchFolder,
  systemBank,
} from '../../src/ladders/system/bank/index';
import { reachOracle } from '../../src/ladders/system/bank/reach';
import { behavioursFor, plantedFlow, runScenario } from '../../src/ladders/system/bank/world';
import { loadFamily, OPERATORS, wrongCode } from '../../src/ladders/system/family';
import { systemLadder } from '../../src/ladders/system/index';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL('../../fixtures/system/bank-manifest.json', import.meta.url), 'utf8'),
) as {
  items: Array<Pick<BankItem, 'id' | 'family' | 'tier' | 'level' | 'source' | 'component' | 'cause'>>;
};

describe('the system bank (docs/validators.md section 12)', () => {
  const bank = systemBank();

  it('meets the shape rules: unique ids, at least 300 items, no family under 20, every tier, every level', () => {
    expect(bankProblems(bank)).toEqual([]);
    expect(bank.length).toBeGreaterThanOrEqual(MIN_BANK);
    for (const [, count] of countBy(bank, (item) => item.family))
      expect(count).toBeGreaterThanOrEqual(MIN_FAMILY);
    expect([...countBy(bank, (item) => item.tier).keys()].sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('matches its manifest, so a change to the bank shows in a diff', () => {
    expect(
      bank.map(({ id, family, tier, level, source, component, cause }) => ({
        id,
        family,
        tier,
        level,
        source,
        component,
        cause,
      })),
    ).toEqual(manifest.items);
  });

  it('names the shape problems it refuses', () => {
    const one = bank[0] as BankItem;
    const problems = bankProblems([one, one]);
    expect(problems).toContain(`the id ${one.id} appears twice`);
    expect(problems.some((problem) => /holds 2 items, under 300/.test(problem))).toBe(true);
    expect(problems.some((problem) => /no item of tier/.test(problem))).toBe(true);
  });

  it('builds one ladder level per bank level, in order, each with threshold 1', () => {
    const ladder = systemLadder();
    expect(ladder.levels.map((level) => level.id)).toEqual(BANK_LEVELS.map((level) => level.id));
    expect(ladder.levels.every((level) => level.threshold === 1)).toBe(true);
    expect(ladder.version).toBe(5);
  });
});

describe('a level of the bank', () => {
  const passing: BankItem = {
    id: 'probe/pass',
    family: 'probe',
    tier: 1,
    level: 1,
    component: 'a.ts',
    source: 'contract',
    title: 'passes',
    cause: 'probe a',
    check: async () => PASS,
  };
  const failing: BankItem = {
    id: 'probe/fail',
    family: 'probe',
    tier: 3,
    level: 2,
    component: 'b.ts',
    source: 'contract',
    title: 'fails',
    cause: 'probe b',
    check: async () => fail('planted reason'),
  };
  const throwing: BankItem = {
    id: 'probe/throw',
    family: 'probe',
    tier: 2,
    level: 2,
    component: 'c.ts',
    source: 'contract',
    title: 'throws',
    cause: 'probe c',
    check: async () => {
      throw new Error('planted throw');
    },
  };

  it('scores the share of its items that pass and names the others with family, tier and component', async () => {
    const measure = await levelMeasure([passing, failing, throwing], 1, ROOT);
    expect(measure.value).toBeCloseTo(1 / 3);
    expect(measure.items).toEqual([
      {
        id: 'probe/fail',
        component: 'b.ts',
        family: 'probe',
        tier: 3,
        cause: 'probe b',
        detail: 'asks: fails. found: planted reason',
      },
      {
        id: 'probe/throw',
        component: 'c.ts',
        family: 'probe',
        tier: 2,
        cause: 'probe c',
        detail: 'asks: throws. found: the item threw: planted throw',
      },
    ]);
    expect(measure.bank?.map((entry) => entry.pass)).toEqual([true, false, false]);
  });

  it('stops the ladder at the first level holding a failing item', async () => {
    const run = await runLadder(systemLadder({ bank: [passing, failing] }), { seed: 1, root: ROOT });
    expect(run.level).toBe(1);
    expect(run.failing?.id).toBe('fault-reach');
    expect(run.rows[2]?.pass).toBeNull();
  });
});

describe('the scenario harness and its oracles', () => {
  it('reads the function:acme-sales faults of the family, and has an operator for each fault class', async () => {
    const family = await loadFamily(ROOT);
    expect(family.map((fault) => fault.id)).toContain('x1-invents-price');
    for (const fault of family)
      if (fault.kind !== 'control') expect(OPERATORS[fault.class], fault.id).toBeDefined();
  });

  it('gives a wrong code of the same shape, never the code itself', () => {
    for (const code of ['R-1000', 'R-7888', 'R-7889', 'R-9999']) {
      expect(wrongCode(code)).toMatch(/^R-[1-9]\d{3}$/);
      expect(wrongCode(code)).not.toBe(code);
    }
  });

  it('plants a flow that is the same on a repeat of a seed and different on another seed', () => {
    expect(plantedFlow(1, 'probe').spec).toEqual(plantedFlow(1, 'probe').spec);
    expect(plantedFlow(2, 'probe').spec).not.toEqual(plantedFlow(1, 'probe').spec);
  });

  it('runs the rule follower clean: every block passes', async () => {
    const planted = plantedFlow(3, 'probe-clean');
    const run = await runScenario(planted.spec, behavioursFor(planted));
    expect(run.blocks.map((block) => block.pass)).toEqual(planted.truths.map(() => true));
  });

  it('reachOracle fails when the planted map names another block than the one the operator broke', async () => {
    const planted = plantedFlow(4, 'probe-oracle');
    const run = await runScenario(planted.spec, behavioursFor(planted, new Map([[2, ['X1_local']]])));
    expect(reachOracle(run, new Map([[2, ['X1_local']]]))).toEqual(PASS);
    expect(reachOracle(run, new Map([[3, ['X1_local']]])).pass).toBe(false);
    expect(reachOracle(run, new Map([[2, ['X5_tool']]])).pass).toBe(false);
  });
});

describe('items of every family on the current code', () => {
  const bank = systemBank();
  const scratch = scratchFolder();
  afterAll(() => scratch.remove());
  // One item per family that holds on main at the bank's measurement.
  const holds = [
    'store/round-trip/plain',
    'resume/half/c1',
    'reach/x1-local/middle/F',
    'reach-adapter/x5-tool/http-flaky/F',
    'reach-multi/x1-local+x2-contradiction',
    'reach-perturbed/x3-flow/after',
    'clean/tools-count-range/F',
    'hostile/homoglyph-code',
    'failure/agent-throws-at-2',
    'class/x4-format/T',
    'fields/succession/alternate',
    'recovery/d1/immediate',
    'version/compare/x1-local/first',
    'variance/icc/10x3/seeded',
    'version/paired/x1-local/last/4',
    'replay/one-fault/P/http-flaky',
    'cli/run/planted-fail',
    'cli/run/failing-list',
    'scale/tool-calls/x10',
  ];
  for (const id of holds) {
    it(`holds: ${id}`, async () => {
      const item = bank.find((each) => each.id === id) as BankItem;
      expect(item, id).toBeDefined();
      await expect(item.check({ seed: 5, root: ROOT, scratch: scratch.path })).resolves.toEqual(PASS);
    }, 60_000);
  }
});
