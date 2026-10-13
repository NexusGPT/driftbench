import { blockOutcome, runOnce, trivialAdapter } from '@agent-nexus/driftbench-generate';
import { beforeAll, describe, expect, it } from 'vitest';
import { cellsOf, generateSuite, measuredCoverage } from '../../../generate/src/enumerate/generate';
import { baselineSpecs } from '../../src/ladders/generator/baseline';
import { CHEATERS, cheaterAdapter, replayCalls } from '../../src/ladders/generator/cheaters';
import { createFollower } from '../../src/ladders/generator/follower';
import { followerAdapter, generateFrom, runContext } from '../../src/ladders/generator/measure';
import { renderMap } from '../../src/ladders/generator/render';
import { scaledSpec } from '../../src/ladders/generator/scale';

// Exact uncovered behaviour-by-opening pairs from the PR 155 handoff, seed 1 at 10x.
const missingBefore = [
  'B-001',
  'B-002',
  'B-003',
  'B-004',
  'B-006',
  'B-1000',
  'B-1001',
  'B-1003',
  'B-1004',
  'B-1006',
  'B-1007',
  'B-1009',
  'B-1010',
  'B-1012',
  'B-1013',
  'B-1016',
  'B-1019',
  'B-1020',
  'B-1021',
  'B-1022',
  'B-1023',
  'B-1024',
  'B-1025',
  'B-1027',
  'B-1028',
  'B-1030',
  'B-1031',
  'B-1034',
  'B-1036',
  'B-1037',
  'B-1039',
  'B-1040',
  'B-1042',
  'B-1043',
  'B-1044',
  'B-1045',
  'B-1046',
  'B-1049',
  'B-1051',
  'B-1052',
  'B-1053',
];

describe('opening recovery contracts at 10x', () => {
  let generated: Awaited<ReturnType<typeof generateFrom>>;
  beforeAll(async () => {
    const hidden = scaledSpec(1, 10);
    generated = await generateFrom(
      hidden,
      renderMap(hidden),
      1,
      {
        generate: (prepared, options) => generateSuite(prepared, { ...options, t: 3 }),
      },
      { once: true },
    );
  }, 120_000);

  it('covers all 41 missing pairs without reducing the 1526-pair denominator', () => {
    if (!generated.prepared) throw new Error('no prepared map');
    const specs = generated.complete.map(({ spec }) => spec);
    const cells = cellsOf(generated.prepared, specs, 2);
    expect(cells).toHaveLength(1526);
    for (const behaviour of missingBefore) {
      const cell = cells.find(
        (entry) => entry.values.behaviour === behaviour && entry.values.stage === 'opening',
      );
      expect(cell?.count, behaviour).toBeGreaterThan(0);
    }
    expect(measuredCoverage(generated.prepared, specs, 2).share).toBe(1);
  });

  it('makes every new opening block pass the follower and fail every cheater', async () => {
    const openings = generated.complete.filter(({ spec }) => spec.blocks[0]?.expect?.stage === 'opening');
    expect(openings.length).toBeGreaterThan(0);
    for (const { spec } of openings) {
      expect(spec.blocks[0]?.expect?.guards?.length, spec.id).toBeGreaterThan(0);
      const reference = await runOnce(
        spec,
        followerAdapter(createFollower(generated.hidden)),
        1,
        runContext(),
      );
      expect(blockOutcome(reference, 0), spec.id).toBe('pass');
      for (const cheater of CHEATERS) {
        const result = await runOnce(
          spec,
          cheaterAdapter(cheater, spec, generated.hidden, replayCalls(baselineSpecs(generated.hidden))),
          1,
          runContext(),
        );
        expect(blockOutcome(result, 0), `${spec.id}: ${cheater}`).toBe('fail');
      }
      const firstTool = await runOnce(spec, trivialAdapter('first-tool', spec), 1, runContext());
      expect(blockOutcome(firstTool, 0), `${spec.id}: first-tool`).toBe('fail');
      const absent = await runOnce(
        spec,
        followerAdapter(() => {
          const follower = createFollower(generated.hidden)();
          return {
            ...follower,
            async respond(messages, world) {
              const observed = await follower.respond(messages, world);
              if (observed.runtime) delete observed.runtime.guards;
              return observed;
            },
          };
        }),
        1,
        runContext(),
      );
      expect(blockOutcome(absent, 0), `${spec.id}: missing policy trace`).toBe('fail');
    }
  }, 120_000);
});
