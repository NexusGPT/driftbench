/** Full stats ladder, including every item beyond the first failing level. */
import { runLadder } from '../../packages/validators/src/ladder';
import { statsLadder } from '../../packages/validators/src/ladders/stats/index';

const first = Number(process.argv[2] ?? 1);
const last = Number(process.argv[3] ?? 200);
for (let seed = first; seed <= last; seed++) {
  const run = await runLadder(statsLadder({ inProcess: true }), {
    seed,
    root: process.cwd(),
    full: true,
  });
  console.log(
    JSON.stringify({
      seed,
      level: run.level,
      failures: run.rows.flatMap((row) => row.items ?? []),
    }),
  );
}
