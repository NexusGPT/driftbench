// Splits the test files of the repository into shards of about equal duration, for the `build` job of ci.yml.
//
//   node tools/ci/shard-plan.mjs --count 32 --out shard-plan.json
//
// The files are the ones `vitest list --filesOnly` prints, so the plan follows `vitest.config.ts`. A file's weight is
// its duration in tools/ci/test-durations.json (milliseconds, measured per file in the logs of a full train run on
// ubuntu-latest, two workers); a file with no entry weighs the median. Files go to shards by the longest first rule:
// the heaviest file goes to the shard with the least load. Every listed file lands in exactly one shard, and the
// plan refuses to be written when that does not hold.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** The weight of each file: its measured duration, or the median of the measured ones. */
export function weights(files, durations) {
  const known = files.map((file) => durations[file]).filter((ms) => Number.isFinite(ms) && ms > 0);
  const sorted = [...known].sort((a, b) => a - b);
  const median = sorted.length === 0 ? 1000 : sorted[Math.floor(sorted.length / 2)];
  return new Map(
    files.map((file) => [
      file,
      Number.isFinite(durations[file]) && durations[file] > 0 ? durations[file] : median,
    ]),
  );
}

/** `count` shards of the files, balanced by weight. The result is the same for the same inputs. */
export function plan(files, durations, count) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`the shard count must be a positive integer, got ${count}`);
  const weight = weights(files, durations);
  const ordered = [...files].sort((a, b) => weight.get(b) - weight.get(a) || (a < b ? -1 : a > b ? 1 : 0));
  const shards = Array.from({ length: count }, () => ({ files: [], load: 0 }));
  for (const file of ordered) {
    let target = shards[0];
    for (const shard of shards) if (shard.load < target.load) target = shard;
    target.files.push(file);
    target.load += weight.get(file);
  }
  for (const shard of shards) shard.files.sort();
  const placed = shards.flatMap((shard) => shard.files);
  if (
    placed.length !== files.length ||
    new Set(placed).size !== files.length ||
    files.some((file) => !placed.includes(file))
  ) {
    throw new Error('the plan does not place every test file in exactly one shard');
  }
  return { count, shards: shards.map((shard) => ({ load: shard.load, files: shard.files })) };
}

/** The test files vitest would run, as paths relative to the repository root. */
export function listFiles(run = spawnSync) {
  const result = run('pnpm', ['exec', 'vitest', 'list', '--filesOnly'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`vitest list failed (${result.status}): ${result.stderr}`);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\.test\.(ts|mjs)$/.test(line));
}

function main(argv) {
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  const count = Number(option('--count', '32'));
  const out = option('--out', 'shard-plan.json');
  const durations = JSON.parse(readFileSync(option('--durations', 'tools/ci/test-durations.json'), 'utf8'));
  const files = listFiles();
  if (files.length === 0) throw new Error('vitest lists no test file');
  const result = plan(files, durations, count);
  writeFileSync(out, `${JSON.stringify(result)}\n`);
  const loads = result.shards.map((shard) => Math.round(shard.load / 1000));
  console.log(
    `${files.length} test files in ${count} shards; load per shard (s): max ${Math.max(...loads)}, min ${Math.min(...loads)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
