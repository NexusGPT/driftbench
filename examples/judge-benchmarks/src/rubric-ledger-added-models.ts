import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { homedir, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RubricItem } from '@agent-nexus/driftbench-judges';
import { loadBenchmark, type PairItem } from './data';
import { appendRecording, readRecordingRows } from './recording-files';
import { LedgerCalls, LedgerProbeStop, type LedgerCall } from './rubric-ledger-calls';
import { DIRECTORY, SETTINGS, classifyProviderBlock, decisionKey, hasUnresolvedPrepayment,
  latestDecisions, scheduleModels, sha, sourcePaths, validityFixtures, variants, type DecisionRow } from './rubric-ledger-live';
import { liteJobs } from './rubric-ledger-flash-lite';
import { HaikuPacing } from './rubric-ledger-pacing';
import { report } from './rubric-ledger-report';
import { evaluateAdded } from './rubric-ledger-added-evaluate';
import { ADDED_MODELS, ADDED_LIMITS, OPENAI_PRICE, responsesPrice, responsesTransport,
  sonnetTransport, type AddedModel } from './rubric-ledger-added-transports';

export const addedDirectory = (model: AddedModel) => `${DIRECTORY}/${model}`;
export const addedSettings = (model: AddedModel) => ({ model, capUsd: ADDED_LIMITS.capUsd,
  reasoning: 'medium', maxTokens: ADDED_LIMITS.maxOutputTokens, timeoutMs: ADDED_LIMITS.timeoutMs,
  reserveUsd: ADDED_LIMITS.reserveUsd, transportTries: 3, concurrency: model === 'gpt-6.1-sol' ? 8 : 4,
  rateLimitWaitMs: SETTINGS.rateLimitWaitMs, testOrderSeed: SETTINGS.testOrderSeed, coreCommit: SETTINGS.coreCommit,
  price: model === 'gpt-6.1-sol' ? OPENAI_PRICE : { basis: 'Native CLI total_cost_usd, measured on the first five calls before continuation' },
  route: model === 'gpt-6.1-sol' ? 'OpenAI Responses API, no temperature, standard service_tier default' : 'Native Claude CLI alias sonnet, empty folder, existing lean flags, replacing system prompt',
  tokenPolicy: '8192 total thinking plus visible output tokens. Sonnet uses CLAUDE_CODE_MAX_OUTPUT_TOKENS=8192 with medium adaptive effort. MAX_THINKING_TOKENS is unset because its positive value is ignored on adaptive models. No returned answer is retried; token-limited items remain scored and are separately reported.',
  tokenSources: ['https://code.claude.com/docs/en/env-vars', 'https://developers.openai.com/api/reference/python/resources/responses/methods/create'],
  pacing: model === 'gpt-6.1-sol' ? 'Eight HTTP calls' : SETTINGS.haikuPacing,
  retryPolicy: SETTINGS.retryPolicy, providerBlockPolicy: SETTINGS.providerBlockPolicy,
  prepaymentPolicy: SETTINGS.prepaymentPolicy, seatPolicy: SETTINGS.seatPolicy, validityScope: SETTINGS.validityScope,
  cellPolicy: 'Independent cell, both contestants, original 790 TEST ids and sealed outcome-blind order. Gemini 3.8 stays parked. Begin only after Haiku completes.',
  winPolicy: 'Higher score and Holm-adjusted McNemar p below 0.05 for WIN; lower score and raw p below 0.05 for LOSS; otherwise TIE. Holm remains pending the complete amended matrix.',
  budgetPolicy: 'First five new calls measured before continuation. Stop before full-cell continuation if projected total exceeds USD 25. Recheck at completed pilot and before TEST. No silent cap increase.' });

const extensionPaths = ['rubric-ledger-added-transports.ts', 'rubric-ledger-added-evaluate.ts', 'rubric-ledger-added-models.ts', 'rubric-ledger-flash-lite.ts']
  .map((p) => `examples/judge-benchmarks/src/${p}`);

export function projectAddedCost(calls: readonly LedgerCall[]) {
  const good = calls.filter((r) => r.status === 'ok');
  const costs = Object.fromEntries(['pair-ledger', 'promptfoo'].map((contestant) => {
    const rows = good.filter((r) => r.contestant === contestant || (contestant === 'pair-ledger' && r.contestant === 'seat'));
    return [contestant, { calls: rows.length, meanRequestUsd: rows.length ? rows.reduce((s, r) => s + r.costUsd, 0) / rows.length : null }];
  }));
  const ours = costs['pair-ledger']!.meanRequestUsd, peer = costs.promptfoo!.meanRequestUsd;
  const firstReads = good.filter((r) => r.contestant === 'pair-ledger' && r.identity.ordinal === 0).length;
  const thirdReads = good.filter((r) => r.contestant === 'pair-ledger' && r.identity.ordinal === 2).length;
  const thirdRate = firstReads ? thirdReads / firstReads : 0;
  const unknown = calls.filter((r) => r.costBasis === 'reservation').reduce((s, r) => s + r.costUsd, 0);
  const projectedUsd = ours === null || peer === null ? null : ours * (2198 + 1000 * thirdRate) + peer * 1620 + unknown;
  return { at: new Date().toISOString(), costs, thirdRate, minimumRequests: 3818, maximumRequestsBeforeTransportRetries: 4818,
    projectedUsd, allThirdReadsUsd: ours === null || peer === null ? null : ours * 3198 + peer * 1620 + unknown,
    method: 'Per-contestant observed mean cost per request times fixed full-cell calls, including all pre-TEST work, plus observed third-read rate and retained unknown holds. Five-call estimate is preliminary.',
    mayContinue: projectedUsd !== null && projectedUsd <= ADDED_LIMITS.capUsd };
}

async function main() {
  if (process.argv.includes('--help')) { console.log('Usage: rubric-ledger-added-models.ts --model claude-sonnet-5-5|gpt-6.1-sol --phase seal|pilot|fixtures|noise|validity|report|projection|seal-test|test [--execute] [--measure-five]. No Gemini calls.'); return; }
  const model = process.argv[process.argv.indexOf('--model') + 1] as AddedModel;
  const phase = process.argv[process.argv.indexOf('--phase') + 1];
  if (!ADDED_MODELS.includes(model) || !['seal', 'pilot', 'fixtures', 'noise', 'validity', 'report', 'projection', 'seal-test', 'test'].includes(phase ?? '')) throw new Error('Use --help');
  const directory = addedDirectory(model), settings = addedSettings(model);
  const execute = process.argv.includes('--execute'), probe = process.argv.includes('--measure-five');
  if (probe && phase !== 'pilot') throw new Error('Measure only the first five pilot calls');
  process.env.DRIFTBENCH_BENCH_CACHE = resolve('.cache/ledger-rb/data');
  process.env.RB_EXECUTION_ROOT = resolve('.cache/ledger-rb/execution');
  process.env.TMPDIR = resolve('.cache/ledger-rb/tmp');
  await mkdir(directory, { recursive: true }); await mkdir(process.env.TMPDIR, { recursive: true });
  const hashes = Object.fromEntries(await Promise.all([...sourcePaths, ...extensionPaths].map(async (path) => [path, sha(await readFile(path, 'utf8'))])));
  const freezePath = `${directory}/contestant-freeze.json`;
  if (phase === 'seal') {
    for (const name of ['development-plan.json', 'requirements.json', 'test-ids.json'])
      await writeFile(`${directory}/${name}`, await readFile(`${DIRECTORY}/${name}`), { flag: 'wx' });
    await writeFile(freezePath, `${JSON.stringify({ at: new Date().toISOString(), settings, hashes,
      authority: 'Owner: Add two model cells to RubricBench: claude-sonnet-5-5 and gpt-6.1-sol. Finish Haiku first. Measure Sonnet on five calls; stop and report a projection over USD 25 before full continuation. Same validity then sealed TEST once; tune nothing on sealed data.',
      originalSealSha256: sha(await readFile(`${DIRECTORY}/test-run-seal.json`, 'utf8')),
      validityFixtures: validityFixtures().map(variants), phases: ['pilot', 'fixtures', 'noise', 'validity', 'test'] }, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ model, freezeSha256: sha(await readFile(freezePath, 'utf8')) })); return;
  }
  const calls = await new LedgerCalls(`${directory}/live`, settings.capUsd, probe ? 5 : Infinity).load();
  if (phase === 'projection') {
    const projection = projectAddedCost(calls.rows);
    await writeFile(`${directory}/cost-projection.json`, `${JSON.stringify(projection, null, 2)}\n`);
    console.log(JSON.stringify(projection)); return;
  }
  if (phase === 'report' || phase === 'seal-test') {
    const result = await report({ directory, models: [model], capUsd: settings.capUsd, settings });
    for (const cell of result.cells) {
      cell.verdict = !cell.coverage.complete ? 'PENDING: incomplete' : cell.stats!.difference < 0 && cell.stats!.gameMcNemarP < .05 ? 'LOSS' : 'TIE or pending Holm matrix';
      cell.providerBlockExcluded.status = 'Shared unblocked intersection; headline retains every sealed item; Holm pending complete amended matrix.';
    }
    await writeFile(`${directory}/live-summary.json`, `${JSON.stringify(result, null, 2)}\n`);
    if (phase === 'seal-test') {
      const cell = result.cells[0]!;
      const projectedTotalUsd = calls.chargedUsd + Object.values(cell.gates.pilot).reduce((s, p) => s + (p.projected790Usd ?? Infinity), 0);
      if (!cell.gates.allowTest || calls.uncertainKeys.length || projectedTotalUsd > settings.capUsd) throw new Error(`Pre-TEST gate: allow=${cell.gates.allowTest}, projected USD ${projectedTotalUsd}`);
      await writeFile(`${directory}/pretest-summary.json`, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
      const recordPrefixes: Record<string, { bytes: number; sha256: string }> = {};
      for (const path of [...(await readdir(`${directory}/live`)).map((p) => `${directory}/live/${p}`),
        `${directory}/pretest-summary.json`]) {
        const bytes = await readFile(path); recordPrefixes[path] = { bytes: bytes.length, sha256: sha(bytes.toString('utf8')) };
      }
      await writeFile(`${directory}/test-run-seal.json`, `${JSON.stringify({ at: new Date().toISOString(), model,
        freezeSha256: sha(await readFile(freezePath, 'utf8')), allowTest: true, projectedTotalUsd, recordPrefixes,
        gate: cell.gates, plannedPairs: 790, order: settings.testOrderSeed }, null, 2)}\n`, { flag: 'wx' });
    }
    return;
  }
  const freezeText = await readFile(freezePath, 'utf8'), freeze = JSON.parse(freezeText);
  if (JSON.stringify(hashes) !== JSON.stringify(freeze.hashes) || JSON.stringify(settings) !== JSON.stringify(freeze.settings)) throw new Error('Frozen source or settings changed');
  if (execFileSync('git', ['show', `HEAD:${freezePath}`], { encoding: 'utf8' }) !== freezeText) throw new Error('Freeze not committed');
  const original = JSON.parse(await readFile(`${DIRECTORY}/live-summary.json`, 'utf8'));
  if (!original.cells.find((c: any) => c.model === 'claude-haiku-5-5')?.coverage.complete) throw new Error('Haiku must finish before any new-model call');
  if (!probe) {
    const projection = JSON.parse(await readFile(`${directory}/cost-projection.json`, 'utf8'));
    if (!projection.mayContinue || calls.rows.length < 5) throw new Error('Five-call cost gate not passed');
  } else if (calls.rows.length) throw new Error('First-five probe already started; do not resend answered calls');
  if (phase === 'test') {
    const gatePath = `${directory}/test-run-seal.json`, text = await readFile(gatePath, 'utf8');
    if (text !== execFileSync('git', ['show', `HEAD:${gatePath}`], { encoding: 'utf8' })) throw new Error('TEST seal not committed');
    const gate = JSON.parse(text);
    if (!gate.allowTest || gate.freezeSha256 !== sha(freezeText)) throw new Error('TEST gate failed');
  }
  if (calls.uncertainKeys.length) throw new Error(`Unfinished reservations: ${calls.uncertainKeys.length}`);
  const raw = model === 'gpt-6.1-sol' ? responsesTransport(execute ?
    (await readFile(resolve(homedir(), '.nexus-secrets/openai.key'), 'utf8')).trim() : 'offline-placeholder') : sonnetTransport();
  const pool = new Map(((await loadBenchmark('rubricbench')).items as PairItem[]).map((item) => [item.id, item]));
  const plan = JSON.parse(await readFile(`${directory}/development-plan.json`, 'utf8'));
  const ids: string[] = JSON.parse(await readFile(`${directory}/test-ids.json`, 'utf8'));
  const manifest: { id: string; requirements: RubricItem[] }[] = JSON.parse(await readFile(`${directory}/requirements.json`, 'utf8'));
  const requirements = new Map(manifest.map((r) => [r.id, r.requirements]));
  const jobs = liteJobs(phase!, pool, plan, ids).map((j) => ({ ...j, model })), resultPath = `${directory}/decisions-${phase}.jsonl`;
  const prior = latestDecisions(await readRecordingRows<DecisionRow>(resultPath));
  const done = new Set(prior.filter((r) => r.status !== 'transport-error' && !hasUnresolvedPrepayment(r, calls.rows)).map(decisionKey));
  let stopped = false, writes = Promise.resolve(), added = 0, probeStopped = false;
  const pacingPath = `${directory}/runtime-pacing.jsonl`;
  const events = await readRecordingRows<{ limit: 2 | 4 }>(pacingPath);
  const pacing = new HaikuPacing(events.at(-1)?.limit ?? 4);
  process.once('SIGUSR2', () => { stopped = true; console.error('Stop requested; drain in-flight calls'); });
  await scheduleModels(jobs.filter((j) => !done.has(decisionKey({ ...j, id: j.item.id }))), { [model]: probe ? 1 : settings.concurrency }, async (job) => {
    try {
      const reqs = requirements.get(job.item.id) ?? [{ name: 'rb_1', rubric: job.item.criterion! }];
      const result = await evaluateAdded(job.item, reqs, model, job.phase, job.sample, job.contestant,
        raw, calls, execute, undefined, undefined, undefined, { price: model === 'gpt-6.1-sol' ? responsesPrice : () => undefined });
      const row = classifyProviderBlock(result as unknown as DecisionRow, calls.rows);
      writes = writes.then(() => appendRecording(resultPath, row)); await writes; added++;
      console.log(JSON.stringify({ phase, model, completed: done.size + added, target: jobs.length, chargedUsd: calls.chargedUsd, status: row.status }));
    } catch (error) { stopped = true; probeStopped = error instanceof LedgerProbeStop; console.error(error instanceof Error ? error.message : String(error)); }
  }, () => stopped, (_, maximum) => {
    if (model !== 'claude-sonnet-5-5' || probe) return maximum;
    // Only the pacing predicate sees the historical helper's expected model name.
    const result = pacing.update(loadavg()[0]!, calls.rows.map((r) => ({ ...r, model: 'claude-haiku-5-5' })));
    if (result.newlyReduced || result.newlyRestored) writes = writes.then(() => appendRecording(pacingPath,
      { ...result, model, at: new Date().toISOString(), loadOneMinute: loadavg()[0] }));
    return Math.min(maximum, result.limit);
  });
  await writes;
  const recorded = new Map(latestDecisions(await readRecordingRows<DecisionRow>(resultPath)).map((r) => [decisionKey(r), r]));
  await writeFile(`${directory}/ordered-${phase}.json`, `${JSON.stringify(jobs.flatMap((j, recordIndex) => {
    const row = recorded.get(decisionKey({ ...j, id: j.item.id }));
    return row ? [{ model: row.model, phase: row.phase, id: row.id, contestant: row.contestant, sample: row.sample, recordIndex }] : [];
  }), null, 2)}\n`);
  console.log(JSON.stringify({ phase, model, complete: !stopped, probeStopped, added, prior: done.size, target: jobs.length, chargedUsd: calls.chargedUsd }));
  if (stopped) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
