import { describe, expect, it } from 'vitest';
import { follow } from '../../src/ladders/estate/follower';
import { drawEstate, type Profile } from '../../src/ladders/estate/hidden';
import { situationsOf } from '../../src/ladders/estate/situations';

// The planted ask of a guard is the request that makes the agent do what the guard watches. Asked of the rule
// follower, it must make the guard's rendered script act: a guard that only answers allow to its own ask
// cannot be told apart from a deleted guard, and a test that keeps the guard's declared verdict fails on it.
describe('every planted guard acts on its own ask', () => {
  const SEEDS = Array.from({ length: 12 }, (_, index) => index + 1);
  const PROFILES: readonly Profile[] = ['visible', 'holdout'];

  it('gives a verdict other than allow, on every seed and profile', () => {
    const silent: string[] = [];
    let guards = 0;
    for (const profile of PROFILES)
      for (const seed of SEEDS) {
        const estate = drawEstate(seed, profile);
        const situations = situationsOf(estate);
        for (const guard of estate.guards) {
          guards += 1;
          const session = follow(estate, situations, [guard.ask]);
          const verdicts = session.decisions
            .split('\n')
            .filter((line) => line.trim() !== '')
            .map((line) => JSON.parse(line) as { check?: string; verdict?: string })
            .filter((decision) => decision.check === guard.name)
            .map((decision) => decision.verdict);
          if (!verdicts.some((verdict) => verdict !== undefined && verdict !== 'allow'))
            silent.push(
              `${profile} seed ${seed}: ${guard.name} on "${guard.ask}" gave ${verdicts.join(', ') || 'no decision'}`,
            );
        }
      }
    expect(guards).toBeGreaterThan(0);
    expect(silent).toEqual([]);
  });
});
