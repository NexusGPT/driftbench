import { describe, expect, it } from 'vitest';
import { bankItems, type SeedData } from '../../src/ladders/generator/bank';
import { baselineSuite } from '../../src/ladders/generator/baseline';
import { faultFamily } from '../../src/ladders/generator/faults';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { type Generation, runAll } from '../../src/ladders/generator/measure';
import { impossiblePairs } from '../../src/ladders/generator/possible';
import { hiddenProposal } from '../../src/ladders/generator/render';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

it('every seeded moving recovery has a nonterminal opportunity that changes the stage', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const hidden = hiddenSpec(seed);
    for (const recovery of hidden.recoveries.filter((entry) => entry.stageAfter !== 'pending')) {
      const stages = hidden.paths
        .filter((path) => recovery.flows.includes(path.flow))
        .flatMap((path) => path.stages.slice(1, -1));
      expect(
        stages.some((stage) => stage !== recovery.stageAfter),
        `seed ${seed}: ${recovery.class}`,
      ).toBe(true);
    }
  }
});

describe('seed 8 goal shift', () => {
  it('has an approved legal probe, and the unchanged fault item rejects a generator probing only at the recovery target', async () => {
    const hidden = hiddenSpec(8);
    const recovery = required(hidden.recoveries.find((entry) => entry.class === 'D2_goal_shift'));
    const path = required(
      hidden.paths.find(
        (path) =>
          recovery.flows.includes(path.flow) &&
          path.stages.slice(1, -1).some((stage) => stage !== recovery.stageAfter),
      ),
    );
    const stage = required(path.stages.slice(1, -1).find((stage) => stage !== recovery.stageAfter));
    expect(
      impossiblePairs(hidden).some(
        (entry) => entry.forbid.stage === stage && entry.forbid.deviation === recovery.class,
      ),
    ).toBe(false);
    expect(
      hiddenProposal(hidden).relations?.some(
        (entry) =>
          entry.kind === 'recovery' && entry.class === recovery.class && entry.flows.includes(path.flow),
      ),
    ).toBe(true);
    const loaded = structuredClone(
      required(baselineSuite(hidden).find((entry) => entry.spec.id === `hand-${path.flow}`)),
    );
    loaded.spec.blocks = loaded.spec.blocks.filter((block) => !('injection' in (block.when ?? {})));
    loaded.spec.blocks = loaded.spec.blocks.slice(
      0,
      loaded.spec.blocks.findIndex((block) => block.expect?.stage === stage) + 1,
    );
    loaded.spec.blocks.push({
      id: 'change-goal',
      when: {
        injection: {
          class: recovery.class,
          user: required(
            hidden.phrases.find(
              (phrase) => phrase.intent.kind === 'deviation' && phrase.intent.class === recovery.class,
            ),
          ).text,
        },
      },
      expect: { stage: recovery.stageAfter, lang: hidden.lang },
    });
    const item = required(bankItems().find((entry) => entry.id === 'fault.D2.ignore'));
    const check = async (specimen: typeof loaded) => {
      const generated: Generation = {
        hidden,
        generatorSeed: 8,
        first: new Map(),
        second: new Map(),
        loaded: [specimen],
        complete: [specimen],
      };
      const runs = await runAll(generated, {
        k: 1,
        cheaters: [],
        faults: (spec) =>
          faultFamily(spec).filter(
            (fault) => fault.class === 'D2.ignore' && fault.where === 'any' && fault.rate === 1,
          ),
      });
      expect(runs.errors).toEqual([]);
      expect(
        runs.blocks
          .filter((block) => !block.reference.every((outcome) => outcome === 'pass'))
          .map((block) => block.referenceFailing),
      ).toEqual([]);
      return item.check({ runs: async () => runs } as SeedData);
    };
    expect((await check(loaded)).pass).toBe(true);
    const mutant = structuredClone(loaded);
    // A generator placing every goal shift at its own target never tests the move.
    mutant.spec.blocks = [required(mutant.spec.blocks[0]), required(mutant.spec.blocks.at(-1))];
    expect((await check(mutant)).pass).toBe(false);
    expect((await check(loaded)).pass).toBe(true);
  });
});
