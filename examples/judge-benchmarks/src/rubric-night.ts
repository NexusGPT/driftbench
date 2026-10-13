import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readRecordingRows } from './recording-files';
import type { RunReport } from './run';

/** Own the owner's freeze and single-test schedule even if the foreground session reconnects. */
async function main(): Promise<void> {
  const [directory, ledger, reportPath] = process.argv.slice(2);
  if (!directory || !ledger || !reportPath)
    throw new Error('Pass result directory, ledger and authorized report');
  const began = Date.now();
  await writeFile(
    '.cache/rb/night-driver-start.json',
    JSON.stringify({ began, directory, ledger, reportPath }),
    { flag: 'wx' },
  );
  const command = (file: string, args: string[]) =>
    execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const run = (file: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(file, args, { stdio: ['ignore', 'inherit', 'inherit'] });
      child.once('error', reject);
      child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`))));
    });
  // The campaign stops accepting calls before 04:28, leaving time to record its freeze.
  while (true) {
    try {
      const stoppedAt = (await stat(join(directory, 'campaign-stop.json'))).mtimeMs;
      if (stoppedAt >= began) break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (command('git', ['branch', '--show-current']).trim() !== 'codex/rb-judge')
    throw new Error('Unexpected branch');
  await run('pnpm', ['exec', 'tsx', 'examples/judge-benchmarks/src/rubric-audit.ts']);
  await run('pnpm', ['exec', 'tsx', 'examples/judge-benchmarks/src/rubric-quote-audit.ts']);
  await run('pnpm', ['exec', 'tsx', 'examples/judge-benchmarks/src/rubric-report.ts', reportPath]);
  await run('pnpm', [
    'exec',
    'tsx',
    'examples/judge-benchmarks/src/guard-allow.ts',
    '--bench',
    'rubricbench',
    '--report',
    join(directory, 'guard-verification.json'),
  ]);
  const paths = command('git', ['status', '--porcelain']).split('\n').filter(Boolean);
  if (paths.some((line) => !line.slice(3).startsWith('examples/judge-benchmarks/')))
    throw new Error('Out-of-scope change');
  command('git', ['diff', '--check']);
  command('git', [
    'add',
    'examples/judge-benchmarks/src',
    'examples/judge-benchmarks/test',
    'examples/judge-benchmarks/experiments/rb',
    'examples/judge-benchmarks/recordings',
  ]);
  command('git', [
    'commit',
    '-m',
    'Freeze RubricBench dev design for the scheduled confirmation',
    '-m',
    'Co-Authored-By: GPT-6.1 Sol (Codex) <noreply@openai.com>', // guard:allow owner-required technical authorship address
  ]);
  const commit = command('git', ['rev-parse', 'HEAD']).trim();
  const frozenAt = new Date().toISOString();
  const configText = await readFile(join(directory, 'best-config.json'), 'utf8');
  const config = JSON.parse(configText) as { contestant: string; devScore: number; usdPer100: number };
  let uniqueCalls: number | undefined;
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.json') || file.startsWith('official-test')) continue;
    const result = JSON.parse(await readFile(join(directory, file), 'utf8')) as Partial<RunReport>;
    if (result.items !== 357 || result.split === 'test') continue;
    const row = result.contestants?.find(
      (row) =>
        row.contestant === config.contestant &&
        (row.summary.missing === 0 || (!result.stopped && result.failedCalls === 0)),
    );
    if (row) uniqueCalls = row.uniqueCalls ?? row.calls;
  }
  if (uniqueCalls === undefined) throw new Error('Frozen full-dev call count missing');
  const rows = await readRecordingRows('examples/judge-benchmarks/recordings/rubricbench/haiku.jsonl');
  const taskCalls = rows.filter(
    (row) => row.contestant?.startsWith('driftbench-rb-') || row.contestant === 'driftbench-checklist',
  ).length;
  const start = JSON.parse(await readFile('.cache/rb/throughput-start.json', 'utf8')) as {
    observedAt: string;
    recordedCalls: number;
  };
  const elapsedSeconds = (Date.now() - Date.parse(start.observedAt)) / 1000;
  const measuredNewCalls = taskCalls - start.recordedCalls;
  if (measuredNewCalls <= 0) throw new Error('No observed throughput for the official test projection');
  const secondsPerCall = elapsedSeconds / measuredNewCalls;
  const freeze = {
    commit,
    frozenAt,
    frozenBy0430: Date.parse(frozenAt) <= new Date('2026-10-13T04:30:00+02:00').getTime(),
    configSha256: createHash('sha256').update(configText).digest('hex'),
    contestant: config.contestant,
    devScore: config.devScore,
    usdPer100: config.usdPer100,
    uniqueCalls,
    devItems: 357,
    throughput: {
      start,
      measuredAt: new Date().toISOString(),
      measuredNewCalls,
      elapsedSeconds,
      secondsPerCall,
    },
  };
  await writeFile(join(directory, 'frozen-design.json'), `${JSON.stringify(freeze, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'design frozen', ...freeze }));
  await run('git', ['push', 'origin', 'codex/rb-judge']);
  await run('pnpm', [
    'exec',
    'tsx',
    'examples/judge-benchmarks/src/rubric-official-test.ts',
    directory,
    ledger,
    String(secondsPerCall),
  ]);
  if (
    command('git', [
      'diff',
      commit,
      '--',
      'examples/judge-benchmarks/src',
      'examples/judge-benchmarks/test',
    ]).trim()
  )
    throw new Error('Design changed after freeze');
  await run('pnpm', [
    'exec',
    'tsx',
    'examples/judge-benchmarks/src/guard-allow.ts',
    '--bench',
    'rubricbench',
    '--report',
    join(directory, 'guard-verification.json'),
  ]);
  await run('pnpm', ['exec', 'tsx', 'examples/judge-benchmarks/src/rubric-quote-audit.ts']);
  await run('pnpm', [
    'exec',
    'tsx',
    'examples/judge-benchmarks/src/rubric-report.ts',
    reportPath,
    '--frozen',
  ]);
  command('git', ['diff', '--check']);
  command('git', ['add', 'examples/judge-benchmarks/experiments/rb', 'examples/judge-benchmarks/recordings']);
  command('git', [
    'commit',
    '-m',
    'Record the frozen RubricBench official test and domain results',
    '-m',
    'Co-Authored-By: GPT-6.1 Sol (Codex) <noreply@openai.com>', // guard:allow owner-required technical authorship address
  ]);
  const head = command('git', ['rev-parse', 'HEAD']).trim();
  await run('git', ['push', 'origin', 'codex/rb-judge']);
  const origin = command('git', ['log', 'origin/codex/rb-judge', '-1', '--format=%H']).trim();
  if (origin !== head) throw new Error('Origin head differs from local head');
  const report = await readFile(reportPath, 'utf8');
  await writeFile(reportPath, report.replace(/Head: [a-f0-9]{40}\./, `Head: ${head}.`));
  const official = JSON.parse(await readFile(join(directory, 'official-test.json'), 'utf8'));
  await writeFile(
    '.cache/rb/night-done.json',
    JSON.stringify({ reportPath, head, frozenCommit: commit, dev: config, official }),
  );
  console.log(JSON.stringify({ event: 'night schedule ended', head, dev: config }));
}

main().catch(async (error) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  console.error(message);
  await writeFile(
    '.cache/rb/night-error.json',
    JSON.stringify({ at: new Date().toISOString(), error: message }),
  );
  process.exitCode = 1;
});
