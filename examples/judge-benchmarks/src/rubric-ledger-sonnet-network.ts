/** Sonnet continuation under the owner-approved USD 60 cap; starts only after Sol finishes. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RubricItem } from '@agent-nexus/driftbench-judges';
import { loadBenchmark, type PairItem } from './data';
import { appendRecording, readRecordingRows } from './recording-files';
import { LedgerCalls, LedgerProbeStop } from './rubric-ledger-calls';
import { NetworkLedgerCalls } from './rubric-ledger-network-calls';
import { classifyAllProviderBlocks } from './rubric-ledger-native-blocks';
import { classifyProviderBlock, decisionKey, latestDecisions, scheduleModels, sha, type DecisionRow } from './rubric-ledger-live';
import { liteJobs } from './rubric-ledger-flash-lite';
import { report } from './rubric-ledger-report';
import { evaluateAdded } from './rubric-ledger-added-evaluate';
import { addedDirectory, addedSettings } from './rubric-ledger-added-models';
import { sonnetEnvironment, sonnetTransport, type AddedModel } from './rubric-ledger-added-transports';

async function main() {
  if (process.argv.includes('--help')) { console.log('Usage: rubric-ledger-sonnet-network.ts --model claude-sonnet-5-5 --phase pilot|fixtures|noise|validity|report|seal-test|test [--execute]. Two calls, one model cell, provider connectivity gate; never resend answers.'); return; }
  const model = process.argv[process.argv.indexOf('--model') + 1] as AddedModel;
  const phase = process.argv[process.argv.indexOf('--phase') + 1];
  if (model !== 'claude-sonnet-5-5' || !['pilot', 'fixtures', 'noise', 'validity', 'report', 'seal-test', 'test'].includes(phase ?? '')) throw new Error('Use --help');
  const directory = addedDirectory(model), amendmentPath = `${directory}/network-cell-amendment.json`;
  const amendmentText = await readFile(amendmentPath, 'utf8'), amendment = JSON.parse(amendmentText);
  if (execFileSync('git', ['show', `HEAD:${amendmentPath}`], { encoding: 'utf8' }) !== amendmentText) throw new Error('Cell runtime amendment not committed');
  for (const [path, hash] of Object.entries(amendment.hashes)) if (sha(await readFile(path, 'utf8')) !== hash) throw new Error(`Runtime source changed: ${path}`);
  const freezePath = `${directory}/contestant-freeze.json`, freezeText = await readFile(freezePath, 'utf8'), freeze = JSON.parse(freezeText);
  for (const [path, hash] of Object.entries(freeze.hashes)) if (sha(await readFile(path, 'utf8')) !== hash) throw new Error(`Original frozen source changed: ${path}`);
  if (amendment.originalFreezeSha256 !== sha(freezeText)) throw new Error('Original freeze identity changed');
  const settings = { ...addedSettings(model), capUsd: amendment.capUsd as number, concurrency: 2,
    transportTries: 'unlimited missing-only for no-answer transport failures',
    pacing: 'Two concurrent paid calls, one model cell at a time',
    retryPolicy: 'Never resend a returned answer. No-answer transport failures retry missing-only without limit; three consecutive connection failures pause ten minutes and repeat the ten-probe gate. Preserve receipts and unknown-cost holds.',
    budgetPolicy: `USD ${amendment.capUsd} hard stop including holds; owner-approved runtime amendment supersedes the initial USD 25 gate.`,
    winPolicy: 'RubricBench is preregistered TIE-only; report observed advantages without promoting them to registered WIN. Loss tests remain uncorrected at 0.05.',
    network: 'Ten healthy provider probes 30 seconds apart; three consecutive connection failures pause ten minutes and repeat gate. Missing-only no-answer retries without limit. One model cell at a time.',
    DISABLE_PROMPT_CACHING: '1' };
  if (settings.capUsd !== 60 || amendment.ownerApproval !== 'Sonner on RubricBench, ok') throw new Error('Sonnet USD 60 owner approval missing');
  if (model === 'claude-sonnet-5-5') {
    const projection = JSON.parse(await readFile(`${directory}/cache-off-projection.json`, 'utf8'));
    if (projection.projectedUsd > 60) throw new Error('Sonnet projection exceeds the amended USD 60 cap');
  }
  let stopped = false, writes = Promise.resolve();
  process.once('SIGUSR2', () => { stopped = true; console.error('Owner pause: drain answers and start no new paid call'); });
  const calls = await new NetworkLedgerCalls(`${directory}/live`, settings.capUsd, model,
    'anthropic', Infinity,
    () => { if (stopped) throw new LedgerProbeStop('Owner pause before next paid request'); }).load();
  if (phase === 'report' || phase === 'seal-test') {
    const result = await report({ directory, models: [model], capUsd: settings.capUsd, settings });
    for (const cell of result.cells) {
      cell.verdict = !cell.coverage.complete ? 'PENDING: incomplete' : cell.stats!.difference < 0 && cell.stats!.gameMcNemarP < .05 ? 'LOSS' : 'TIE-only preregistered';
      cell.providerBlockExcluded.status = 'Shared unblocked intersection; headline retains every sealed item; Holm pending complete amended matrix.';
    }
    const logical = (r: typeof calls.rows[number]) => JSON.stringify([r.model, r.identity.phase, r.item, r.contestant, r.identity.sample, r.identity.ordinal]);
    const answered = new Set(calls.rows.filter((r) => r.status === 'ok').map(logical));
    const missing = [...new Set(calls.rows.filter((r) => !answered.has(logical(r))).map(logical))];
    await writeFile(`${directory}/live-summary.json`, `${JSON.stringify({ ...result, transportMissingRequests: missing.length,
      final: result.cells[0]!.coverage.complete && missing.length === 0 && !calls.uncertainKeys.length }, null, 2)}\n`);
    if (phase === 'seal-test') {
      const cell = result.cells[0]!;
      const projectedTotalUsd = calls.chargedUsd + Object.values(cell.gates.pilot).reduce((s, p) => s + (p.projected790Usd ?? Infinity), 0);
      if (!cell.gates.allowTest || calls.uncertainKeys.length || missing.length || projectedTotalUsd > settings.capUsd) throw new Error(`Pre-TEST gate: allow=${cell.gates.allowTest}, missing=${missing.length}, projected USD ${projectedTotalUsd}`);
      const gatePath = `${directory}/test-run-seal.json`;
      await writeFile(`${directory}/pretest-summary.json`, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
      const recordPrefixes: Record<string, { bytes: number; sha256: string }> = {};
      for (const path of [...(await readdir(`${directory}/live`)).map((p) => `${directory}/live/${p}`), `${directory}/pretest-summary.json`]) {
        const bytes = await readFile(path); recordPrefixes[path] = { bytes: bytes.length, sha256: sha(bytes.toString('utf8')) };
      }
      await writeFile(gatePath, `${JSON.stringify({ at: new Date().toISOString(), model, freezeSha256: sha(freezeText),
        runtimeAmendmentSha256: sha(amendmentText), allowTest: true, projectedTotalUsd, capUsd: settings.capUsd,
        recordPrefixes, gate: cell.gates, plannedPairs: 790, order: settings.testOrderSeed }, null, 2)}\n`, { flag: 'wx' });
    }
    return;
  }
  if (!process.argv.includes('--execute')) throw new Error('Explicit execution required');
  const sol = JSON.parse(await readFile(`${addedDirectory('gpt-6.1-sol')}/live-summary.json`, 'utf8'));
  if (!sol.final || !sol.cells[0]?.coverage?.complete || sol.transportMissingRequests || sol.uncertainCalls) throw new Error('Sol must finish before any Sonnet continuation call');
  if (calls.uncertainKeys.length) throw new Error('Unfinished reservation from prior runner');
  if (phase === 'test') {
    const path = `${directory}/test-run-seal.json`, text = await readFile(path, 'utf8'), gate = JSON.parse(text);
    if (execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' }) !== text || !gate.allowTest ||
      gate.freezeSha256 !== sha(freezeText) || gate.runtimeAmendmentSha256 !== sha(amendmentText)) throw new Error('TEST seal missing, changed or not committed');
  }
  process.env.DRIFTBENCH_BENCH_CACHE = resolve('.cache/ledger-rb/data');
  process.env.RB_EXECUTION_ROOT = resolve('.cache/ledger-rb/execution');
  process.env.TMPDIR = resolve('.cache/ledger-rb/tmp'); await mkdir(process.env.TMPDIR, { recursive: true });
  const raw = sonnetTransport({ ...sonnetEnvironment(process.env), DISABLE_PROMPT_CACHING: '1' });
  const pool = new Map(((await loadBenchmark('rubricbench')).items as PairItem[]).map((item) => [item.id, item]));
  const plan = JSON.parse(await readFile(`${directory}/development-plan.json`, 'utf8'));
  const ids = JSON.parse(await readFile(`${directory}/test-ids.json`, 'utf8'));
  const manifest: { id: string; requirements: RubricItem[] }[] = JSON.parse(await readFile(`${directory}/requirements.json`, 'utf8'));
  const requirements = new Map(manifest.map((r) => [r.id, r.requirements]));
  const jobs = liteJobs(phase!, pool, plan, ids).map((j) => ({ ...j, model })), path = `${directory}/decisions-${phase}.jsonl`;
  const done = new Set(latestDecisions(await readRecordingRows<DecisionRow>(path)).filter((r) => r.status !== 'transport-error').map(decisionKey));
  let added = 0;
  await calls.waitForNetwork();
  await scheduleModels(jobs.filter((j) => !done.has(decisionKey({ ...j, id: j.item.id }))), { [model]: 2 }, async (job) => {
    try {
      const row = await evaluateAdded(job.item, requirements.get(job.item.id) ?? [{ name: 'rb_1', rubric: job.item.criterion! }], model,
        job.phase, job.sample, job.contestant, raw, calls as unknown as LedgerCalls, true, undefined, undefined, undefined,
        { price: () => undefined });
      row.callKeys = calls.rows.filter((r) => r.model === model && r.identity.phase === job.phase && r.item === job.item.id &&
        r.contestant === job.contestant && r.identity.sample === job.sample).map((r) => r.key);
      writes = writes.then(() => appendRecording(path, classifyAllProviderBlocks(row as unknown as DecisionRow, calls.rows)));
      await writes; added++;
      console.log(JSON.stringify({ model, phase, completed: done.size + added, target: jobs.length, chargedUsd: calls.chargedUsd, status: row.status }));
      if (row.status === 'transport-error') throw new Error('Unresolved non-connection failure; inspect before further calls');
    } catch (error) { stopped = true; console.error(error instanceof Error ? error.message : String(error)); }
  }, () => stopped);
  await writes;
  const recorded = new Map(latestDecisions(await readRecordingRows<DecisionRow>(path)).map((r) => [decisionKey(r), r]));
  await writeFile(`${directory}/ordered-${phase}.json`, `${JSON.stringify(jobs.flatMap((j, recordIndex) => {
    const row = recorded.get(decisionKey({ ...j, id: j.item.id }));
    return row ? [{ model: row.model, phase: row.phase, id: row.id, contestant: row.contestant, sample: row.sample, recordIndex }] : [];
  }), null, 2)}\n`);
  console.log(JSON.stringify({ model, phase, complete: !stopped, added, target: jobs.length, chargedUsd: calls.chargedUsd }));
  if (stopped) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
