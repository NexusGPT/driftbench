import type { Labeller } from '@agent-nexus/driftbench-judges';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLadder } from '../../../src/ladder';
import {
  buildLabellerFixture,
  judgesLadderV3,
  judgesV3Bank,
  labellerBank,
  runLabellerItem,
  scriptedLabeller,
  VARIANTS,
} from '../../../src/ladders/judges/v3';
import { hiddenSeed } from '../../../src/seeds';

const bank = labellerBank();
const currentHiddenSeed = hiddenSeed(process.cwd()).seed;
afterEach(() => vi.unstubAllGlobals());

describe('judges version 3 labeller bank', () => {
  it('has 300 named deterministic items: six structural variants in every family and tier', () => {
    expect(bank).toHaveLength(300);
    expect(new Set(bank.map((item) => item.id)).size).toBe(300);
    for (const family of Object.keys(VARIANTS)) {
      expect(bank.filter((item) => item.family === family)).toHaveLength(30);
      for (const tier of [1, 2, 3, 4, 5]) {
        expect(bank.filter((item) => item.family === family && item.tier === tier)).toHaveLength(6);
      }
    }
    expect(new Set(bank.map((item) => item.cause)).size).toBe(10);
  });

  it('passes the independent scripted recordings without any network', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('a deterministic bank must never fetch');
    });
    for (const item of bank) {
      const result = await item.run(71);
      expect(result.pass, `${item.id}: ${result.detail}`).toBe(true);
      expect(result.metrics?.total).toBeGreaterThan(1);
    }
  });

  it.each(['empty', 'constant', 'always-abstain', 'echo-first-label'] as const)(
    '%s passes zero individual items, including replay and key checks',
    async (cheat) => {
      const passes: string[] = [];
      for (const item of bank) {
        const result = await runLabellerItem(
          item,
          3,
          (requests): Labeller => ({
            id: cheat,
            label: (request) =>
              cheat === 'empty'
                ? ''
                : cheat === 'always-abstain'
                  ? null
                  : cheat === 'constant'
                    ? (requests[0]?.labelSet.labels[0]?.name ?? 'route-1')
                    : (request.labelSet.labels[0]?.name ?? 'none'),
          }),
        );
        if (result.pass) passes.push(item.id);
      }
      expect(passes).toEqual([]);
    },
  );

  it.each([1, 2, 647384989])('rejects position-cycle answers on every item for seed %i', async (seed) => {
    const passing: string[] = [];
    for (const item of bank) {
      const result = await runLabellerItem(item, seed, () => {
        let callIndex = 0;
        return {
          id: 'position-cycle',
          label(request) {
            const answer =
              request.labelSet.labels[callIndex % request.labelSet.labels.length]?.name ?? 'none';
            callIndex += 1;
            return answer;
          },
        };
      });
      if (result.pass) passing.push(item.id);
    }
    expect(passing).toEqual([]);
  });

  it.each([
    { seed: 10, variant: 'conjunction' },
    { seed: 18, variant: 'direct' },
  ])('rejects the reviewer pair-cycle on $variant seed $seed', async ({ seed, variant }) => {
    const item = bank.find((entry) => entry.id === `labeller/agreement/${variant}/tier-1`);
    if (!item) throw new Error('missing reviewer counterexample');
    const result = await runLabellerItem(item, seed, () => {
      let index = 0;
      return {
        id: 'pair-cycle',
        label(request) {
          return (
            request.labelSet.labels[Math.floor(index++ / 2) % request.labelSet.labels.length]?.name ?? 'none'
          );
        },
      };
    });
    expect(result.pass, result.detail).toBe(false);
  });

  it.each([...new Set([...Array.from({ length: 20 }, (_, i) => i + 1), 647384989, currentHiddenSeed])])(
    'no period 1..8 or phase offset can reach even the lowest agreement bar on seed %i',
    (seed) => {
      const exploitable: string[] = [];
      for (const item of judgesV3Bank()) {
        const { units } = buildLabellerFixture(item, seed);
        const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
        const labelCount = [...new Set(units.map((unit) => unit.request.labelSet.labels.length))].reduce(
          (period, size) => (period * size) / gcd(period, size),
          1,
        );
        for (let period = 1; period <= 8; period += 1) {
          for (let offset = 0; offset < period * labelCount; offset += 1) {
            let correct = 0;
            for (const [i, unit] of units.entries()) {
              const labels = unit.request.labelSet.labels;
              const prediction = labels[Math.floor((i + offset) / period) % labels.length]?.name;
              if (prediction === unit.gold) correct += 1;
            }
            // Raw agreement < .9 proves zero passing items independently of kappa and paired checks.
            if (correct / units.length >= 0.9)
              exploitable.push(`${item.id}: period=${period}, offset=${offset}`);
          }
        }
      }
      expect(exploitable).toEqual([]);
    },
  );

  it('regenerates the exact same fixtures but changes construction across seeds', () => {
    for (const item of bank) {
      const first = buildLabellerFixture(item, 17);
      expect(buildLabellerFixture(item, 17)).toEqual(first);
      expect(buildLabellerFixture(item, 18)).not.toEqual(first);
      expect(new Set(first.units.map((unit) => unit.gold)).size).toBeGreaterThan(1);
    }
  });

  it('passes only request fields to the candidate and counts abstention against agreement', async () => {
    const item = bank.find((entry) => entry.family === 'abstain' && entry.tier === 5);
    expect(item).toBeDefined();
    if (!item) return;
    const result = await runLabellerItem(item, 11, (requests) => {
      for (const request of requests) expect(Object.keys(request).sort()).toEqual(['labelSet', 'text']);
      const recorded = scriptedLabeller(buildLabellerFixture(item, 11));
      return {
        id: recorded.id,
        label(request) {
          expect(Object.keys(request).sort()).toEqual(['labelSet', 'text']);
          return recorded.label(request);
        },
      };
    });
    expect(result.pass, result.detail).toBe(true);
    expect(result.metrics?.abstentions).toBe(1);
    expect(result.metrics?.agreement).toBeLessThan(1);
    expect(result.detail).toContain('abstentions=1');
  });

  it('reports a throwing labeller as failures, without abandoning the bank', async () => {
    const item = bank[0];
    if (!item) throw new Error('missing bank item');
    const result = await runLabellerItem(item, 1, () => ({
      id: 'broken',
      label() {
        throw new Error('scripted failure');
      },
    }));
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('scripted failure');
    expect(result.metrics?.invalid).toBe(result.metrics?.total);
  });

  it('reports metrics on every passing ladder entry and is repeatable', async () => {
    const first = await runLadder(judgesLadderV3({ bank }), { seed: 3, full: true });
    const second = await runLadder(judgesLadderV3({ bank }), { seed: 3, full: true });
    expect(first).toEqual(second);
    expect(first.level).toBe(5);
    expect(first.rows.flatMap((row) => row.bank ?? [])).toHaveLength(300);
    for (const row of first.rows)
      for (const entry of row.bank ?? []) expect(entry.detail).toContain('kappa=');
  });

  it('catches a stateful wrong answer on fifth-repeat and interleaved replay fixtures', async () => {
    const items = bank.filter((item) => item.family === 'replay' && [2, 3].includes(item.variant));
    for (const item of items) {
      const result = await runLabellerItem(item, 5, () => {
        const good = scriptedLabeller(buildLabellerFixture(item, 5));
        let n = 0;
        return {
          id: good.id,
          label(request) {
            n += 1;
            return n % 5 === 0 ? 'none' : good.label(request);
          },
        };
      });
      expect(result.pass, item.id).toBe(false);
      expect(result.detail).toContain('paired answer mismatch');
    }
  });
});
