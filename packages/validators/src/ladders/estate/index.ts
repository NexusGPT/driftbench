import { defineLadder, type Ladder } from '../../ladder';
import { BANK_LEVELS, type Family, levelMeasure, QUARANTINED } from './bank/index';

/**
 * The estate validator (docs/validators.md sections 6 and 12): does the estate loop close on estates nobody
 * wrote by hand. A bank of items, each a seeded generator and an exact oracle, in seven levels ordered by the
 * cost of diagnosis; a level passes on a seed when every item of the level passes on it.
 *
 *   1  reader and graph  planted forms of every reader gap found on a real estate (symlinks, registry tables,
 *                        process maps, catalogues, dispatcher commands, compact frontmatter, long references),
 *                        gates, hazards and paths with decoys, pairs of forms, and the generated estates
 *   2  lint              planted defects found exactly; clean estates give no finding
 *   3  plan              the contract, pairwise and three-way coverage against brute force, relevance
 *   4  generation        every class of test complete, valid, distinct and green on the rule follower
 *   5  agent mutants     every atom deleted from the rule follower fails one of its generated tests
 *   6  maintenance       every estate mutant gets the retirements, regenerations and re-approvals it should
 *   7  scale             every stage at 250 to 5000 atoms within its time budget, its result right
 */

export * from './bank/index';
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
  /** The families of each level by level id; tests replace one to plant a fault. */
  families?: Partial<Record<string, () => Family[]>>;
};

export function estateLadder(options: EstateLadderOptions = {}): Ladder {
  return defineLadder({
    component: 'estate',
    // Its CI legs run with --all-levels: the levels above the first failure are reported apart, never as passes.
    beyondApart: true,
    levels: BANK_LEVELS.map((level) => {
      const families =
        options.families?.[level.id] ??
        (() => level.families().filter((family) => !QUARANTINED.includes(family.id)));
      const count = families().reduce((sum, family) => sum + family.items.length, 0);
      return {
        id: level.id,
        name: level.name,
        metric: `items passing / items (${count})`,
        threshold: 1,
        compute: ({ seed }) => levelMeasure(families(), seed),
      };
    }),
  });
}
export { FIXTURE_FOLDER, fixtureName, fixtureText } from './fixture';
