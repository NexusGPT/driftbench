import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { here } from './runner.mts';

// One driver owns every paid subprocess. Stop on a failed stage, never launch calls concurrently.
const ledger = process.env.HARD_SPEND_LEDGER ?? '';
if (!ledger) throw new Error('Set HARD_SPEND_LEDGER to the authorized append-only ledger');
async function stage(script: string, args: string[]) {
  const before = spend();
  const result = await new Promise<number | null>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', join(here, script), ...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', resolve);
  });
  const after = spend();
  appendFileSync(
    ledger,
    `| ${new Date().toISOString()} | codex hard comparison ${script} ${args.join(' ')} | haiku | recorded serial calls | task cap 8.00 | ${(after - before).toFixed(8)} | cumulative ${after.toFixed(8)} USD; exit ${result} |\n`,
  );
  if (result !== 0) throw new Error(`Stage failed: ${script} ${args.join(' ')}`);
}
function spend() {
  return readFileSync(join(here, 'recorded/calls.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .reduce((sum, line) => sum + JSON.parse(line).costUsd, 0);
}
while (!JSON.parse(readFileSync(join(here, 'recorded/injection-ours.json'), 'utf8')).complete)
  await new Promise((resolve) => setTimeout(resolve, 10_000));
await stage('measure.mts', ['pii', 'ours']);
await stage('judges.mts', ['theirs', '--limit', '1']);
const probe = JSON.parse(readFileSync(join(here, 'recorded/judges-theirs.json'), 'utf8'));
if (
  probe.answers.some((answer: { predictions: unknown[] }) =>
    answer.predictions.some((prediction) => prediction === null),
  )
)
  throw new Error('Native schema transport probe did not return verdicts');
await stage('judges.mts', ['theirs']);
await stage('judges.mts', ['ours']);
await stage('simulator.mts', ['theirs']);
await stage('simulator.mts', ['ours']);
