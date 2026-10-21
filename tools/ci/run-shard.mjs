// Runs one shard of the plan that tools/ci/shard-plan.mjs wrote: the shard's test files, and nothing else.
//
//   node tools/ci/run-shard.mjs --plan shard-plan.json --index 3
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { changedSharedDist, sharedDistSnapshot } from './shared-dist.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const plan = JSON.parse(readFileSync(option('--plan', 'shard-plan.json'), 'utf8'));
const index = Number(option('--index'));
if (!Number.isInteger(index) || index < 1 || index > plan.count) {
  console.error(`the shard index must be 1 to ${plan.count}, got ${option('--index')}`);
  process.exit(2);
}
const files = plan.shards[index - 1].files;
if (files.length === 0) {
  console.error(`shard ${index} of ${plan.count} holds no test file`);
  process.exit(2);
}
console.log(`shard ${index} of ${plan.count}: ${files.length} test files`);
const before = sharedDistSnapshot(process.cwd());
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--maxWorkers=2', ...files], { stdio: 'inherit' });
const changed = changedSharedDist(before, sharedDistSnapshot(process.cwd()));
if (changed.length > 0) {
  console.error(`tests modified shared dist; rebuild in a temporary output folder:\n${changed.join('\n')}`);
}
process.exit(result.status === 0 && changed.length > 0 ? 1 : (result.status ?? 1));
