import type { Labeller } from '@agent-nexus/driftbench-judges';
import { describe, expect, it } from 'vitest';
import {
  buildLabellerFixture,
  judgesV3Bank,
  labellerBank,
  scriptedLabeller,
} from '../../../src/ladders/judges/v3';

// A labeller that routes by the digits of the text never reads the predicates. The fictional serial of every unit
// carries digits, and the numeric-token cheater of the cheater audit turns the first digit run into a route.
// Seed 663204596 is the seed a release cluster's tree drew: the cheater met the lowest tier's bars on it.
const numericToken = (): Labeller => ({
  id: 'numeric-token',
  label: (request) => {
    const labels = request.labelSet.labels;
    return labels[Number(request.text.match(/\d+/)?.[0] ?? 1) % labels.length]?.name ?? null;
  },
});

describe('digit-run shortcuts on the labeller bank', () => {
  it('the numeric-token cheater passes no item at seed 663204596', async () => {
    const passing: string[] = [];
    for (const item of judgesV3Bank()) {
      const result = await item.run(663204596, () => numericToken());
      if (result.pass) passing.push(item.id);
    }
    expect(passing).toEqual([]);
  });

  it('the scripted honest labeller still passes every labeller item at seed 663204596', async () => {
    for (const item of labellerBank()) {
      const result = await item.run(663204596);
      expect(result.pass, `${item.id}: ${result.detail}`).toBe(true);
    }
  });

  it('every labeller fixture draws without exhausting its redraws on seeds 1 to 60', () => {
    for (let seed = 1; seed <= 60; seed += 1)
      for (const item of labellerBank())
        expect(buildLabellerFixture(item, seed).units.length).toBeGreaterThan(1);
  });

  it('an agreement item needs the recorded answer of every unit, not a global bar', async () => {
    const item = labellerBank().find((entry) => entry.id === 'labeller/agreement/direct/tier-1');
    if (!item) throw new Error('missing agreement item');
    const fixture = buildLabellerFixture(item, 71);
    const honest = scriptedLabeller(fixture);
    // One wrong answer in forty units keeps raw agreement above the 0.9 bar and must still fail.
    let wrongAt = 0;
    const result = await item.run(71, () => ({
      id: honest.id,
      label(request) {
        const answer = honest.label(request) as string;
        wrongAt += 1;
        if (wrongAt !== 3) return answer;
        return request.labelSet.labels.find((entry) => entry.name !== answer)?.name ?? 'none';
      },
    }));
    expect(result.metrics?.agreement).toBeGreaterThanOrEqual(0.9);
    expect(result.pass, result.detail).toBe(false);
    expect(result.detail).toContain('paired answer mismatch');
  });
});

// Opt-in sweep for the audit: DRIFTBENCH_CHEATER_SWEEP="1-1000" prints the cheater's pass count and the honest
// labeller's failures over those seeds.
const sweep = process.env.DRIFTBENCH_CHEATER_SWEEP?.match(/^(\d+)-(\d+)$/);
describe.skipIf(!sweep)('numeric-token sweep', () => {
  it('the cheater passes nothing and the honest labeller fails nothing', async () => {
    const [from, to] = [Number(sweep?.[1]), Number(sweep?.[2])];
    const cheaterPasses: string[] = [];
    const honestFailures: string[] = [];
    for (let seed = from; seed <= to; seed += 1) {
      for (const item of labellerBank()) {
        if ((await item.run(seed, () => numericToken())).pass) cheaterPasses.push(`${item.id} @ ${seed}`);
        const honest = await item.run(seed);
        if (!honest.pass) honestFailures.push(`${item.id} @ ${seed}: ${honest.detail}`);
      }
    }
    console.log(
      `SWEEP ${from}-${to}: cheater passes ${cheaterPasses.length}; honest failures ${honestFailures.length}`,
    );
    expect(cheaterPasses).toEqual([]);
    expect(honestFailures).toEqual([]);
  }, 3_600_000);
});
