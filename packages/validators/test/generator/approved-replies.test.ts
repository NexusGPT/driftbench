import { blockOutcome, runOnce } from '@agent-nexus/driftbench-generate';
import { beforeAll, describe, expect, it } from 'vitest';
import { faultFamily } from '../../src/ladders/generator/faults';
import { createFollower } from '../../src/ladders/generator/follower';
import { followerAdapter, generation, runContext } from '../../src/ladders/generator/measure';

const classes = [
  'X1.field-extra',
  'X2.fact-flip',
  'X2.fact-invent',
  'X3.no-report',
  'X4.no-question',
  'X4.narrate',
];

describe('the approved input, stage and reply contract', () => {
  let generated: Awaited<ReturnType<typeof generation>>;
  beforeAll(async () => {
    generated = await generation(1);
  }, 60_000);

  it('keeps the reference green and kills each of the six formerly unchecked classes', async () => {
    expect(generated.refused).toBeUndefined();
    const suite = generated.complete.filter(({ spec }) => spec.id.startsWith('gen-graph-'));
    expect(suite.length).toBeGreaterThan(0);
    for (const { spec } of suite) {
      const reference = await runOnce(
        spec,
        followerAdapter(createFollower(generated.hidden)),
        1,
        runContext(),
      );
      expect(
        spec.blocks.every((_, index) => blockOutcome(reference, index) === 'pass'),
        spec.id,
      ).toBe(true);
    }
    for (const cls of classes) {
      const fault = faultFamily(generated.hidden).find(
        (entry) => entry.class === cls && entry.where === 'any' && entry.rate === 1,
      );
      if (!fault) throw new Error(`missing ${cls}`);
      const outcomes = [];
      for (const { spec } of suite) {
        const run = await runOnce(
          spec,
          followerAdapter(createFollower(generated.hidden, fault.mutation)),
          1,
          runContext(),
        );
        outcomes.push(spec.blocks.every((_, index) => blockOutcome(run, index) === 'pass'));
      }
      expect(
        outcomes.some((pass) => !pass),
        cls,
      ).toBe(true);
    }
  }, 60_000);

  it('varies the bound tool answers and asserts the same values in the reply', () => {
    const values = new Set<string>();
    for (const { spec } of generated.complete) {
      const patterns = spec.blocks.flatMap((block) => block.expect?.must ?? []);
      if (patterns.some((pattern) => pattern.includes('found is true'))) values.add('true');
      if (patterns.some((pattern) => pattern.includes('found is false'))) values.add('false');
    }
    expect([...values].sort()).toEqual(['false', 'true']);
  });
});
