/** Owner-authorized runtime cache amendment. Exactly five next unanswered DEV calls. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RubricItem } from '@agent-nexus/driftbench-judges';
import { loadBenchmark, type PairItem } from './data';
import { appendRecording, readRecordingRows } from './recording-files';
import { LedgerCalls, LedgerProbeStop } from './rubric-ledger-calls';
import { NetworkLedgerCalls } from './rubric-ledger-network-calls';
import { classifyProviderBlock, decisionKey, latestDecisions, sha, type DecisionRow } from './rubric-ledger-live';
import { liteJobs } from './rubric-ledger-flash-lite';
import { evaluateAdded } from './rubric-ledger-added-evaluate';
import { addedDirectory, projectAddedCost } from './rubric-ledger-added-models';
import { sonnetEnvironment, sonnetTransport } from './rubric-ledger-added-transports';

export async function main() {
  if (process.argv.includes('--help')) { console.log('Usage: rubric-ledger-sonnet-cache-probe.ts --execute. Requires committed cache-runtime-amendment.json. Stops after five next physical DEV calls.'); return; }
  if (!process.argv.includes('--execute')) throw new Error('Explicit execution required');
  const model = 'claude-sonnet-5-5', directory = addedDirectory(model);
  const amendmentPath = `${directory}/cache-runtime-amendment.json`, amendmentText = await readFile(amendmentPath, 'utf8');
  if (execFileSync('git', ['show', `HEAD:${amendmentPath}`], { encoding: 'utf8' }) !== amendmentText) throw new Error('Cache amendment not committed');
  const amendment = JSON.parse(amendmentText);
  if (sha(await readFile('examples/judge-benchmarks/src/rubric-ledger-sonnet-cache-probe.ts', 'utf8')) !== amendment.runnerSha256) throw new Error('Probe source changed');
  for (const [path, hash] of Object.entries(amendment.runtimeHashes ?? {}))
    if (sha(await readFile(path, 'utf8')) !== hash) throw new Error(`Runtime source changed: ${path}`);
  const freeze = JSON.parse(await readFile(`${directory}/contestant-freeze.json`, 'utf8'));
  for (const [path, hash] of Object.entries(freeze.hashes)) if (sha(await readFile(path, 'utf8')) !== hash) throw new Error(`Frozen source changed: ${path}`);
  const calls = await new NetworkLedgerCalls(`${directory}/live`, 25, model, 'anthropic', 5, (identity) => {
    if (identity.model !== model || identity.phase !== 'pilot') throw new Error('Cache probe is DEV-only');
  }).load();
  if (calls.rows.length !== 5 || calls.uncertainKeys.length) throw new Error('Cache probe requires exactly the five original recorded calls and no unfinished call');
  const beforeKeys = new Set(calls.rows.map((r) => r.key));
  process.env.DRIFTBENCH_BENCH_CACHE = resolve('.cache/ledger-rb/data');
  process.env.RB_EXECUTION_ROOT = resolve('.cache/ledger-rb/execution');
  process.env.TMPDIR = resolve('.cache/ledger-rb/tmp'); await mkdir(process.env.TMPDIR, { recursive: true });
  const raw = sonnetTransport({ ...sonnetEnvironment(process.env), DISABLE_PROMPT_CACHING: '1' });
  const pool = new Map(((await loadBenchmark('rubricbench')).items as PairItem[]).map((item) => [item.id, item]));
  const plan = JSON.parse(await readFile(`${directory}/development-plan.json`, 'utf8'));
  const manifest: { id: string; requirements: RubricItem[] }[] = JSON.parse(await readFile(`${directory}/requirements.json`, 'utf8'));
  const requirements = new Map(manifest.map((r) => [r.id, r.requirements]));
  const jobs = liteJobs('pilot', pool, plan, []).map((j) => ({ ...j, model }));
  const path = `${directory}/decisions-pilot.jsonl`;
  const done = new Set(latestDecisions(await readRecordingRows<DecisionRow>(path)).filter((r) => r.status !== 'transport-error').map(decisionKey));
  let stoppedByLimit = false;
  for (const job of jobs) {
    if (done.has(decisionKey({ ...job, id: job.item.id }))) continue;
    try {
      const result = await evaluateAdded(job.item, requirements.get(job.item.id)!, model, job.phase, job.sample, job.contestant,
        raw, calls as unknown as LedgerCalls, true, undefined, undefined, undefined, { price: () => undefined });
      await appendRecording(path, classifyProviderBlock(result as unknown as DecisionRow, calls.rows));
    } catch (error) {
      if (!(error instanceof LedgerProbeStop)) throw error;
      stoppedByLimit = true; break;
    }
  }
  const newCalls = calls.rows.filter((r) => !beforeKeys.has(r.key));
  if (!stoppedByLimit || newCalls.length !== 5 || newCalls.some((r) => r.status !== 'ok')) throw new Error('Inspect the partial cache probe before any continuation');
  const projection = projectAddedCost(newCalls);
  const means = projection.costs;
  const completedOurs = calls.rows.filter((r) => r.status === 'ok' && r.contestant === 'pair-ledger').length;
  const completedPeer = calls.rows.filter((r) => r.status === 'ok' && r.contestant === 'promptfoo').length;
  const remainingLedgerUsd = means['pair-ledger']!.meanRequestUsd! * (2198 + 1000 * projection.thirdRate - completedOurs);
  const remainingPeerUsd = means.promptfoo!.meanRequestUsd! * (1620 - completedPeer);
  const projectedUsd = calls.chargedUsd + remainingLedgerUsd + remainingPeerUsd;
  const result = { ...projection, projectedUsd, remainingLedgerUsd, remainingPeerUsd, chargedAlreadyUsd: calls.chargedUsd,
    projectedLedgerUsd: remainingLedgerUsd + calls.rows.filter((r) => r.contestant === 'pair-ledger').reduce((s, r) => s + r.costUsd, 0),
    projectedPromptfooUsd: remainingPeerUsd + calls.rows.filter((r) => r.contestant === 'promptfoo').reduce((s, r) => s + r.costUsd, 0),
    allThirdReadsUsd: calls.chargedUsd + means['pair-ledger']!.meanRequestUsd! * (3198 - completedOurs) + remainingPeerUsd,
    capUsd: 45, mayContinue: projectedUsd <= 45, status: projectedUsd <= 45 ? 'authorized under USD 45 hard stop including holds' : 'owner budget decision',
    appliedEnvironment: { DISABLE_PROMPT_CACHING: '1' }, newCalls: newCalls.map((r) => r.key),
    newCallsCostUsd: newCalls.reduce((s, r) => s + r.costUsd, 0),
    method: 'Next-five cache-off per-contestant request means times remaining fixed full-cell requests, plus all prior costs and holds. The initial five cache-on calls are retained and never resent. A small-sample projection, not a guarantee.' };
  await writeFile(`${directory}/cache-off-projection.json`, `${JSON.stringify(result, null, 2)}\n`);
  const recorded = new Map(latestDecisions(await readRecordingRows<DecisionRow>(path)).map((r) => [decisionKey(r), r]));
  await writeFile(`${directory}/ordered-pilot.json`, `${JSON.stringify(jobs.flatMap((j, recordIndex) => {
    const row = recorded.get(decisionKey({ ...j, id: j.item.id }));
    return row ? [{ model: row.model, phase: row.phase, id: row.id, contestant: row.contestant, sample: row.sample, recordIndex }] : [];
  }), null, 2)}\n`);
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
