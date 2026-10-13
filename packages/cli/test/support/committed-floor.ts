import {
  type FloorsFile,
  floorOf,
  type Ladder,
  ladderVersion,
  runLadder,
} from '@agent-nexus/driftbench-validators';

/** A floor guard exercises the applicable floor, not the bank above it. */
export async function committedFloorRun(ladder: Ladder, floors: FloorsFile, root: string) {
  const floor = floorOf(floors, ladder.component, ladderVersion(ladder));
  if (floor === 0) return { floor, run: null };
  const run = await runLadder(ladder, { seed: 1, root, maxLevel: floor });
  return { floor, run };
}
