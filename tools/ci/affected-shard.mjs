// Runs one shard of the tests a pull request affects, for the `pr affected` jobs of ci.yml and
// pr-affected-retarget.yml.
//
//   node tools/ci/affected-shard.mjs --base origin/release/next --count 8 --index 3
//
// Every shard lists the affected test files itself (`vitest list --filesOnly --changed <base>`, the same selection as
// `vitest run --changed <base>`), adds the files that selection cannot see (ALWAYS), and plans them by measured
// duration with the planner of the full suite (tools/ci/shard-plan.mjs). The list is the same on every shard, so
// every affected file lands in exactly one shard. A shard that holds no file passes.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { plan } from './shard-plan.mjs';

/** Test files that read Markdown the module graph does not see: `--changed` alone cannot select their examples. */
export const ALWAYS = ['packages/cli/test/help-topics.test.ts'];

/** The affected test files: the listed ones and ALWAYS, once each, in a fixed order. */
export function affectedFiles(listed) {
  const tests = listed.map((line) => line.trim()).filter((line) => /\.test\.(ts|mjs)$/.test(line));
  return [...new Set([...tests, ...ALWAYS])].sort();
}

/** The files of shard `index` (1 based) of `count`, balanced by measured duration. */
export function shardOf(files, durations, count, index) {
  if (!Number.isInteger(index) || index < 1 || index > count)
    throw new Error(`the shard index must be 1 to ${count}, got ${index}`);
  return plan(files, durations, count).shards[index - 1].files;
}

/** The arguments of the vitest run of a shard: its files, and nothing else. */
export const vitestArgs = (files) => ['exec', 'vitest', 'run', '--maxWorkers=2', ...files];

function main(argv) {
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  const base = option('--base');
  const count = Number(option('--count'));
  const index = Number(option('--index'));
  if (!base || !Number.isInteger(count) || count < 1) {
    console.error('usage: affected-shard.mjs --base <ref> --count <n> --index <i>');
    process.exit(2);
  }
  if (!Number.isInteger(index) || index < 1 || index > count) {
    console.error(`the shard index must be 1 to ${count}, got ${option('--index')}`);
    process.exit(2);
  }
  const listing = spawnSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly', '--changed', base], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listing.status !== 0) {
    console.error(`vitest list --changed ${base} failed (${listing.status}): ${listing.stderr}`);
    process.exit(1);
  }
  const files = affectedFiles(listing.stdout.split('\n'));
  const durations = JSON.parse(
    readFileSync(option('--durations', new URL('./test-durations.json', import.meta.url)), 'utf8'),
  );
  const mine = shardOf(files, durations, count, index);
  console.log(`${files.length} affected test files; shard ${index} of ${count} holds ${mine.length}`);
  if (mine.length === 0) process.exit(0);
  const result = spawnSync('pnpm', vitestArgs(mine), { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
