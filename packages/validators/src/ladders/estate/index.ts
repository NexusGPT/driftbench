import { defineLadder, type Ladder } from '../../ladder';
import type { Profile } from './hidden';
import {
  agentMutantLevel,
  atomLevel,
  estateMutantLevel,
  holdoutLevel,
  lintLevel,
  MUTATION_SCORE,
  planLevel,
  specLevel,
} from './levels';
import { type EstateRun, estateRun } from './pipeline';

/**
 * The estate validator (docs/validators.md section 6): does the estate loop close on an estate nobody wrote
 * by hand. A seeded generator writes a fictional estate from a hidden specification; the scanner, the lint,
 * the plan, the generator, replay and maintenance run on it; a rule follower written from the same
 * specification plays the agent. Seven levels:
 *
 *   1  atoms and edges   every planted atom found and nothing else, by kind; every edge of the design found
 *   2  lint              every planted defect found and no other finding
 *   3  plan              every allowed pair in a row; every approved atom has its mandatory rows
 *   4  specs             every generated spec validates strictly, is complete, asks a distinct phrase where k
 *                        asks are planned, and passes on the rule follower
 *   5  agent mutants     an atom deleted from the follower fails one of its tests; score per kind >= 0.9
 *   6  estate mutants    an atom deleted from the estate retires exactly its tests; a re-wrap changes none
 *   7  hidden seed       levels 1 to 6 hold on the holdout estate, whose forms the visible seeds never use
 */

export {
  componentOfKind,
  componentOfMarker,
  ESTATE_COMPONENTS,
} from './components';
export { type FollowerSession, follow } from './follower';
export { drawEstate, type HiddenEstate, type Profile, TOPICS } from './hidden';
export { RUNTIME } from './layout';
export * from './levels';
export { type EstateMutant, estateMutants } from './mutants';
export {
  approvedPlan,
  asksOf,
  type EstateRun,
  estateRun,
  matchAtoms,
  replayChecks,
  replayOnFollower,
  runEstate,
  scanRendered,
  writeEstate,
} from './pipeline';
export { type ExpectedAtom, type Rendered, renderEstate } from './render';
export { phraseBank, sessionIndex, situationsOf } from './situations';

export type EstateLadderOptions = {
  /** The run of a seed and profile; tests replace it to plant a fault in one component. */
  run?: (seed: number, profile: Profile) => Promise<EstateRun>;
};

export function estateLadder(options: EstateLadderOptions = {}): Ladder {
  const run = options.run ?? estateRun;
  return defineLadder({
    component: 'estate',
    levels: [
      {
        id: 'atoms-and-edges',
        name: 'atoms and edges',
        metric: 'atoms matched / planted and / found, lowest by kind; edges found / designed',
        threshold: 1,
        compute: async ({ seed }) => atomLevel(await run(seed, 'visible')),
      },
      {
        id: 'lint',
        name: 'lint',
        metric: 'planted defects found / (defects planted + findings not planted)',
        threshold: 1,
        compute: async ({ seed }) => lintLevel(await run(seed, 'visible')),
      },
      {
        id: 'plan',
        name: 'plan',
        metric: 'allowed pairs in a row / allowed pairs, and mandatory rows / required, the lower',
        threshold: 1,
        compute: async ({ seed }) => planLevel(await run(seed, 'visible')),
      },
      {
        id: 'specs',
        name: 'generated specs',
        metric: 'specs valid, complete, distinct and green on the rule follower / specs generated',
        threshold: 1,
        compute: async ({ seed }) => specLevel(await run(seed, 'visible')),
      },
      {
        id: 'agent-mutants',
        name: 'agent mutants',
        metric: 'atoms deleted from the agent that fail a test / atoms deleted, lowest by kind',
        threshold: MUTATION_SCORE,
        compute: async ({ seed }) => agentMutantLevel(await run(seed, 'visible')),
      },
      {
        id: 'estate-mutants',
        name: 'estate mutants',
        metric: 'tests maintenance decides right / tests judged, over the estate mutants',
        threshold: 1,
        compute: async ({ seed }) => estateMutantLevel(await run(seed, 'visible')),
      },
      {
        id: 'hidden-seed',
        name: 'holdout estate',
        metric: 'levels 1 to 6 held on the holdout estate / 6',
        threshold: 1,
        compute: async ({ seed }) => holdoutLevel(await run(seed, 'holdout')),
      },
    ],
  });
}
export { FIXTURE_FOLDER, fixtureName, fixtureText } from './fixture';
