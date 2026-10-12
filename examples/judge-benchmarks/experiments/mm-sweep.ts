import { spawn } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunReport } from '../src/run';

const RESULTS = 'examples/judge-benchmarks/experiments/mm-results';
const arg = (key: string) => {
  const i = process.argv.indexOf(`--${key}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const ledger = arg('ledger');
const deadline = arg('deadline');
if (!ledger || !deadline || !Number.isFinite(Date.parse(deadline)))
  throw new Error('--ledger and ISO --deadline are required');
const deadlineMs = Date.parse(deadline);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function exists(file: string) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}
async function spend() {
  const rows = (await readFile('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((x) => JSON.parse(x));
  return rows
    .filter((x) => String(x.contestant).startsWith('driftbench-mm-'))
    .reduce((sum, x) => sum + x.costUsd, 0);
}
async function run(
  phase: string,
  tag: string,
  contestants: string[],
  cap: number,
  replay = false,
): Promise<RunReport | undefined> {
  const file = join(RESULTS, `${tag}.json`);
  if (await exists(file)) return JSON.parse(await readFile(file, 'utf8'));
  const remaining = Math.max(0, 7.9 - (await spend()));
  if ((!replay && remaining < 0.02) || Date.now() >= deadlineMs) return undefined;
  const limit = replay ? 0 : Math.min(cap, remaining);
  const args = [
    '--import',
    'tsx',
    'examples/judge-benchmarks/experiments/mm-dev.ts',
    '--phase',
    phase,
    '--tag',
    tag,
    '--contestants',
    contestants.join(','),
    '--cap-usd',
    String(limit),
    '--ledger',
    ledger!,
    '--deadline',
    deadline!,
  ];
  if (replay) args.push('--replay-only');
  console.log(`Start ${tag}: cap ${limit.toFixed(4)}, spent ${(await spend()).toFixed(4)}`);
  let out = '';
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (x) => {
      out += x;
    });
    child.stderr.on('data', (x) => {
      out += x;
    });
    child.on('error', reject);
    child.on('close', resolve);
  });
  await writeFile(join(RESULTS, `${tag}.log`), out);
  if (!(await exists(file))) throw new Error(`${tag} exits ${code} without a report: ${out.slice(-1000)}`);
  const report = JSON.parse(await readFile(file, 'utf8')) as RunReport;
  console.log(
    `Finish ${tag}: new ${report.newSpendUsd.toFixed(4)}, ${report.contestants.map((c) => `${c.contestant}=${(c.summary.value.estimate * 100).toFixed(2)} missing=${c.summary.missing}`).join(', ')}`,
  );
  return report;
}
async function main() {
  // One producer. Wait for the existing pilot to finish before making another model call.
  while (!(await exists(join(RESULTS, 'pilot-candidates.json')))) {
    if (Date.now() >= deadlineMs) throw new Error('Deadline while waiting for pilot');
    await sleep(10_000);
  }
  // A live replay earlier captured spend that the pilot's own final row also records.
  const journal = join(RESULTS, 'runs.jsonl');
  const rows = (await readFile(journal, 'utf8'))
    .trim()
    .split('\n')
    .map((x) => JSON.parse(x));
  const counted = rows.reduce((sum, x) => sum + x.newSpendUsd, 0);
  const actual = await spend();
  if (counted > actual + 1e-9) {
    const correction = actual - counted;
    await appendFile(
      journal,
      `${JSON.stringify({ tag: 'reconcile-live-replay-overlap', newSpendUsd: correction, newCalls: 0, time: new Date().toISOString() })}\n`,
    );
    await appendFile(
      ledger!,
      `| reconcile | codex-mm live replay accounting overlap corrected against unique recorded calls | haiku | 0 | 0 | ${correction.toFixed(7)} | codex-mm total ${actual.toFixed(7)} of 8.00 |\n`,
    );
  }
  const contracts = await run(
    'pilot',
    'pilot-contracts',
    ['driftbench-mm-direct-contract', 'driftbench-mm-language-contract', 'driftbench-mm-rubric-contract'],
    0,
    true,
  );
  if (!contracts || contracts.stopped || contracts.contestants.some((c) => c.summary.missing))
    throw new Error('Pilot contract replay incomplete');
  const codePilot = await run(
    'pilot',
    'pilot-code',
    ['driftbench-mm-language-code', 'driftbench-mm-language-safety-code'],
    1.2,
  );
  const integrityPilot = await run('pilot', 'pilot-integrity', ['driftbench-mm-integrity-code'], 0.8);
  const pilotChoices = [
    ...contracts.contestants,
    ...(codePilot?.contestants ?? []),
    ...(integrityPilot?.contestants ?? []),
  ].filter((c) => c.summary.missing === 0);
  const best = pilotChoices.sort((a, b) => b.summary.value.estimate - a.summary.value.estimate)[0]!
    .contestant;
  await writeFile(
    join(RESULTS, 'frozen-pilot-choice.json'),
    JSON.stringify(
      {
        chosen: best,
        time: new Date().toISOString(),
        rule: 'Largest macro score on the balanced 100-item pilot, before viewing confirmation results.',
      },
      null,
      2,
    ) + '\n',
  );
  const confirm = await run('confirm', 'confirm-single', [best, 'driftbench', 'deepeval', 'promptfoo'], 1.5);
  if (
    confirm &&
    !confirm.stopped &&
    confirm.contestants[0]!.summary.missing === 0 &&
    confirm.contestants[0]!.summary.value.estimate >= 0.95
  )
    return;
  for (const [id, name] of [
    ['driftbench-mm-code-adaptive', 'code-adaptive'],
    ['driftbench-mm-adaptive', 'adaptive'],
    ['driftbench-mm-majref', 'majref'],
    ['driftbench-mm-vote5', 'vote5'],
  ]) {
    const pilot = await run('pilot', `pilot-${name}`, [id!], 1.2);
    if (!pilot || pilot.stopped) break;
    const confirmation = await run('confirm', `confirm-${name}`, [id!], 3.0);
    if (!confirmation || confirmation.stopped) break;
    if (
      confirmation.contestants[0]!.summary.missing === 0 &&
      confirmation.contestants[0]!.summary.value.estimate >= 0.95
    )
      break;
  }
  const finalIds = [
    best,
    'driftbench-mm-code-adaptive',
    'driftbench-mm-adaptive',
    'driftbench-mm-majref',
    'driftbench-mm-vote5',
  ];
  const comparison = await run('common', 'common-final', finalIds, 0, true);
  const finalists = (comparison?.contestants ?? [])
    .filter((c) => c.summary.missing === 0)
    .sort((a, b) => b.summary.value.estimate - a.summary.value.estimate);
  if (
    finalists[0] &&
    finalists[0].summary.value.estimate < 0.95 &&
    Date.now() < deadlineMs &&
    (await spend()) < 7.8
  ) {
    await run('full', 'full-best-dev', [finalists[0].contestant], 7.9 - (await spend()));
  }
  await writeFile(
    join(RESULTS, 'sweep-finished.json'),
    JSON.stringify(
      {
        time: new Date().toISOString(),
        spent: await spend(),
        deadline,
        reason:
          Date.now() >= deadlineMs
            ? 'deadline'
            : (await spend()) >= 7.8
              ? 'budget guard'
              : 'completed planned variants',
      },
      null,
      2,
    ) + '\n',
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
