import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { here } from './runner.mts';

const ledger = process.env.HARD_SPEND_LEDGER ?? '';
if (!ledger) throw new Error('Set the authorized spend ledger path');
const records = () =>
  readFileSync(join(here, 'recorded/calls.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
function assertFrozen() {
  const frozen = JSON.parse(readFileSync(join(here, 'frozen.json'), 'utf8'));
  for (const [path, digest] of Object.entries({ ...frozen.sourceHashes, ...frozen.fixtureHashes })) {
    if (
      createHash('sha256')
        .update(readFileSync(join(here, path)))
        .digest('hex') !== digest
    )
      throw new Error(`Frozen source/input changed: ${path}`);
  }
}
async function stage(script: string, args: string[]) {
  if (args.includes('--heldout') || script === 'pairwise.mts') assertFrozen();
  const before = records();
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        'exec',
        'tsx',
        ...(script.startsWith('pr115') || (script === 'criteria-v2.mts' && args[0] === 'pr115')
          ? ['--tsconfig', join(here, '.pr115-source/tsconfig.json')]
          : []),
        join(here, script),
        ...args,
      ],
      { stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('close', resolve);
  });
  const after = records();
  const spent = after.reduce((s, c) => s + c.costUsd, 0);
  const delta = spent - before.reduce((s, c) => s + c.costUsd, 0);
  appendFileSync(
    ledger,
    `| ${new Date().toISOString()} | codex hard/heldout ${script} ${args.join(' ')} | haiku | ${after.length - before.length} fresh calls, serial | task cap 8.00 | ${delta.toFixed(8)} | cumulative ${spent.toFixed(8)} USD; exit ${code} |\n`,
  );
  if (code !== 0) throw new Error(`Failed stage ${script} ${args.join(' ')}`);
}

for (const name of [
  'pairwise-pr115.json',
  'pairwise-pr115-heldout.json',
  'judges-pr115.json',
  'judges-pr115-heldout.json',
]) {
  const record = JSON.parse(readFileSync(join(here, 'recorded', name), 'utf8'));
  if (!record.complete) throw new Error('PR115 priority measurements are unfinished');
}
assertFrozen();
for (const long of [false, true])
  for (const variant of ['ours', 'audit', 'theirs', 'compliance', 'pr115'])
    await stage('criteria-v2.mts', [variant, ...(long ? ['--longtrace-v2'] : [])]);
await stage('injection-attempt.mts', ['attempt']);
await stage('injection-attempt.mts', ['ours', '--heldout-v2']);
await stage('injection-attempt.mts', ['attempt', '--heldout-v2']);
console.log('All preregistered additional studies complete.');
