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
      ['exec', 'tsx', '--tsconfig', join(here, '.pr115-source/tsconfig.json'), join(here, script), ...args],
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
const required = ['judges', 'simulator'].flatMap((row) =>
  (row === 'judges' ? ['ours', 'audit', 'theirs'] : ['ours', 'checked', 'theirs']).flatMap((v) =>
    ['', '-heldout'].map((tag) => `${row}-${v}${tag}.json`),
  ),
);
while (
  required.some(
    (file) =>
      !existsSync(join(here, 'recorded', file)) ||
      !JSON.parse(readFileSync(join(here, 'recorded', file), 'utf8')).complete,
  ) ||
  existsSync(join(here, '.model-lock'))
)
  await new Promise((resolve) => setTimeout(resolve, 10000));
await stage('pr115.mts', ['--heldout']);
await stage('pr115.mts', []);
await stage('pr115-criteria.mts', []);
await stage('pr115-criteria.mts', ['--heldout']);
console.log('PR 115 pairwise and criterion default frozen cohorts complete.');
