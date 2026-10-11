import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { type ChainState, loadSpecs, runChain } from '../../src/ladders/system/chain';
import { type FamilyFault, loadFamily, OPERATORS, wrongCode } from '../../src/ladders/system/family';
import { DEFECT_SPECS, plantDefects, plantRecoveries, STAGES } from '../../src/ladders/system/plant';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const golden = JSON.parse(
  readFileSync(new URL('../../fixtures/system/plant-seed-1.json', import.meta.url), 'utf8'),
) as { defects: unknown; recoveries: unknown; specs: string[] };

let family: FamilyFault[];
let chain: ChainState;

beforeAll(async () => {
  family = await loadFamily(ROOT);
  chain = await runChain(1, family);
});

describe('the system plant', () => {
  it('reads the function:acme-sales faults and their control from the family', () => {
    expect(family.map((fault) => fault.id).sort()).toEqual([
      'control-sales-identity',
      'd2-ignores-goal-shift',
      'd4-order-on-loose-yes',
      'd6-obeys-instruction',
      'd8-hides-tool-failure',
      'd9-answers-out-of-scope',
      'x1-invents-price',
      'x2-keeps-first-email',
      'x3-skips-recap',
      'x4-wrong-language',
      'x5-drops-coverage-check',
    ]);
  });

  it('is the same on a repeat of a seed and differs on another seed, and seed 1 matches its fixture', () => {
    const first = plantDefects(1, family);
    expect(plantDefects(1, family).defects).toEqual(first.defects);
    expect(plantDefects(2, family).defects).not.toEqual(first.defects);
    expect(first.defects).toEqual(golden.defects);
    expect(plantRecoveries(1, family).recoveries).toEqual(golden.recoveries);
    expect([...first.specs, ...plantRecoveries(1, family).specs].map((spec) => spec.id)).toEqual(
      golden.specs,
    );
  });

  it('plants every fault of the family on every seed, each at its own block, and the loader accepts every spec', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const plant = plantDefects(seed, family);
      expect(plant.specs).toHaveLength(DEFECT_SPECS);
      expect(new Set(plant.defects.map((defect) => defect.faultId))).toEqual(
        new Set(family.map((fault) => fault.id)),
      );
      const places = plant.defects.map((defect) => `${defect.specId} ${defect.block}`);
      expect(new Set(places).size).toBe(places.length);
      expect(() => loadSpecs(plant.specs)).not.toThrow();
      expect(() => loadSpecs(plantRecoveries(seed, family).specs)).not.toThrow();
    }
  });

  it('refuses a family fault whose class has no operator, naming it', () => {
    const odd: FamilyFault = {
      id: 'odd-fault',
      kind: 'deviation',
      class: 'D7_silence_or_burst',
      target: 'function:acme-sales',
      description: 'a class the operator table lacks',
    };
    expect(() => plantDefects(1, [...family, odd])).toThrow(/odd-fault \(D7_silence_or_burst\)/);
  });

  it('plants one perturbed flow per deviation class, injected before a middle block, with its recovery', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const plant = plantRecoveries(seed, family);
      expect(plant.recoveries.map((entry) => entry.class).sort()).toEqual([
        'D2_goal_shift',
        'D4_loose_confirmation',
        'D6_instruction_in_data',
        'D8_tool_failure',
        'D9_out_of_scope',
      ]);
      for (const entry of plant.recoveries) {
        expect(entry.injectedAt).toBeGreaterThanOrEqual(1);
        expect(entry.injectedAt).toBeLessThanOrEqual(STAGES.length - 2);
        if (entry.turns === undefined) expect(entry.collateral).toBe(0);
        if (entry.turns === 0) expect(entry.unsafe).toBe(false);
      }
    }
  });

  it('gives a wrong code of the same shape, never the code itself', () => {
    for (const code of ['R-1000', 'R-7888', 'R-7889', 'R-9999']) {
      expect(wrongCode(code)).toMatch(/^R-[1-9]\d{3}$/);
      expect(wrongCode(code)).not.toBe(code);
    }
  });
});

describe('the operators through the real runner and checks', () => {
  it('fail the check family the table names on each planted block, and no family outside the table', () => {
    const families = (verdicts: { id: string; gating: boolean; outcome: string }[]) =>
      [
        ...new Set(
          verdicts
            .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
            .map((verdict) => verdict.id.split('.')[0]),
        ),
      ].sort();
    const planted = new Map(
      chain.defects.defects.map((defect) => [`${defect.specId} ${defect.block}`, defect] as const),
    );
    let checked = 0;
    for (const cell of chain.defectCampaign.cells) {
      const run = chain.defectCampaign.stored.get(cell.cellId);
      expect(run?.status).toBe('completed');
      for (const block of run?.blocks ?? []) {
        const defect = planted.get(`${cell.specId} ${block.index}`);
        const operator = defect && defect.kind !== 'control' ? OPERATORS[defect.class] : undefined;
        const seen = families(block.verdicts);
        const where = `${cell.specId} block ${block.index} ${defect?.faultId ?? 'clean'}`;
        if (!operator) expect(seen, where).toEqual([]);
        else {
          expect(seen, where).toContain(operator.check);
          for (const family of seen)
            expect([operator.check, ...(operator.also ?? [])], where).toContain(family);
        }
        checked += 1;
      }
    }
    expect(checked).toBe(DEFECT_SPECS * STAGES.length * 2);
  });
});
