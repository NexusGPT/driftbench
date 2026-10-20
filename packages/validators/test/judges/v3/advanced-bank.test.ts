import * as analysis from '@agent-nexus/driftbench-judges';
import { describe, expect, it, vi } from 'vitest';
import { runLadder } from '../../../src/ladder';
import {
  advancedLabellerBank,
  judgesLadderV3,
  judgesV3Bank,
  labellerBank,
} from '../../../src/ladders/judges/v3';

const advanced = advancedLabellerBank();
describe('advanced labeller scoring capability bank', () => {
  it('adds independent capabilities without modifying or replacing the base items', () => {
    expect(advanced).toHaveLength(34);
    expect(judgesV3Bank()).toHaveLength(334);
    expect(new Set(judgesV3Bank().map((item) => item.id)).size).toBe(334);
    expect(
      judgesV3Bank()
        .slice(0, 300)
        .map((item) => item.id),
    ).toEqual(labellerBank().map((item) => item.id));
    expect(new Set(advanced.map((item) => item.cause)).size).toBeLessThan(34);
  });
  it.each(advanced.map((item) => [item.id, item] as const))(
    '%s matches its independent mathematical oracle',
    async (_id, item) => {
      const result = await item.run(71);
      expect(result.pass, result.detail).toBe(true);
    },
  );
  it('the default ladder executes the full combined bank successfully', async () => {
    const run = await runLadder(judgesLadderV3(), { seed: 71, full: true });
    const items = run.rows.flatMap((row) => row.bank ?? []);
    expect(items).toHaveLength(334);
    expect(items.filter((item) => !item.pass)).toEqual([]);
    expect(run.level).toBe(5);
  });
  it.each(['empty', 'constant', 'always-abstain', 'first-label'] as const)(
    '%s passes no advanced item',
    async (cheat) => {
      const passes: string[] = [];
      for (const item of advanced) {
        const result = await item.run(3, (requests) => ({
          id: cheat,
          label(request) {
            return cheat === 'empty'
              ? ''
              : cheat === 'always-abstain'
                ? null
                : cheat === 'constant'
                  ? (requests[0]?.labelSet.labels[0]?.name ?? 'none')
                  : (request.labelSet.labels[0]?.name ?? 'none');
          },
        }));
        if (result.pass) passes.push(item.id);
        expect(result.detail).toContain('advanced=');
      }
      expect(passes).toEqual([]);
    },
  );
  it('an always-throw implementation passes zero advanced items including validation cases', async () => {
    const functions = [
      'labellerKappaInterval',
      'binaryLabellerPabak',
      'weightedLabellerKappa',
      'labellerNominalAlpha',
      'labellerConfusion',
      'labellerCoverageCurve',
      'selectLabellerThreshold',
      'scoreMappedLabeller',
      'planLabellerKappaSample',
      'exactLabellerKappaTest',
    ] as const;
    const mocks = functions.map((name) =>
      vi.spyOn(analysis, name).mockImplementation(() => {
        throw new Error('always throw');
      }),
    );
    try {
      const passes: string[] = [];
      for (const item of advanced) {
        const result = await item.run(71);
        if (result.pass) passes.push(item.id);
        expect(result.detail).toContain('advanced=always throw');
      }
      expect(passes).toEqual([]);
    } finally {
      for (const mock of mocks) mock.mockRestore();
    }
  });
  it('honors explicit bank overrides and executes the selected item callable', async () => {
    let calls = 0;
    const anchor = advanced[0];
    if (!anchor) throw new Error('missing advanced item');
    const run = await runLadder(
      judgesLadderV3({
        bank: [
          {
            ...anchor,
            run: async () => {
              calls += 1;
              return { pass: false, detail: 'independent callable sentinel' };
            },
          },
        ],
      }),
      { seed: 1, full: true },
    );
    expect(calls).toBe(1);
    expect(run.rows.flatMap((row) => row.bank ?? [])).toHaveLength(1);
    expect(run.rows.flatMap((row) => row.bank ?? [])[0]?.detail).toContain('independent callable sentinel');
  });
});
