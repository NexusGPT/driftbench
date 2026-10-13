import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDialectTransport, type RubricItem } from '@agent-nexus/driftbench-judges';
import { loadBenchmark, type PairItem } from './data';
import { appendRecording, readRecordingRows } from './recording-files';
import { LedgerCalls, LedgerProbeStop, type LedgerCompletion } from './rubric-ledger-calls';
import { DIRECTORY, SETTINGS, classifyProviderBlock, decisionKey, evaluate, hasUnresolvedPrepayment,
  latestDecisions, scheduleModels, sha, sourcePaths, validityFixtures, variants, type DecisionRow } from './rubric-ledger-live';
import { report } from './rubric-ledger-report';

export const LITE_MODEL = 'gemini-3.5-flash-lite' as const;
export const LITE_DIRECTORY = `${DIRECTORY}/flash-lite`;
export const LITE_SETTINGS = {
  model: LITE_MODEL, reasoning: 'medium', reasoningFallback: 'Only an explicit unsupported-setting rejection permits the model default, recorded before continuation. Returned answers never permit a setting change.',
  pricePerMillion: { input: 0.30, outputIncludingThinking: 2.50 },
  priceSource: 'https://ai.google.dev/gemini-api/docs/pricing', priceReadUtc: '2026-10-13',
  reasoningSource: 'https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6',
  capUsd: 8, concurrency: 8, rateLimitWaitMs: [20000, 60000, 180000],
  timeoutMs: 300000, transportTries: 3, maxTokens: 8192, reserveUsd: 0.10,
  testOrderSeed: SETTINGS.testOrderSeed, coreCommit: SETTINGS.coreCommit,
  providerBlockPolicy: SETTINGS.providerBlockPolicy, prepaymentPolicy: SETTINGS.prepaymentPolicy,
  seatPolicy: SETTINGS.seatPolicy, validityScope: SETTINGS.validityScope,
  retryPolicy: 'Three ordinary transport tries only; 429 waits 20, 60, 180 seconds and remains no answer. HTTP 402 opens the circuit immediately. Never resubmit a returned answer, including an unparsed answer or provider block. Zero content re-asks.',
  cellPolicy: 'New independent cell. No Gemini 3.8 recording is reused or pooled. Original three-model record indices remain fixed. Both contestants use the same model and reasoning. Same 790 TEST ids and outcome-blind order.',
  winPolicy: 'Higher score and Holm-adjusted McNemar p below 0.05 for WIN; lower score and uncorrected p below 0.05 for LOSS; otherwise TIE. Holm remains pending the complete matrix, including the newly authorized cells. RubricBench remains preregistered TIE-only on available power.',
} as const;

export function litePrice(completion: LedgerCompletion): number | undefined {
  const { input, output } = completion.usage ?? {};
  return input === undefined || output === undefined ? undefined :
    (input * LITE_SETTINGS.pricePerMillion.input + output * LITE_SETTINGS.pricePerMillion.outputIncludingThinking) / 1e6;
}

export type LiteJob = { item: PairItem; phase: string; sample: number; contestant: 'pair-ledger' | 'promptfoo' | 'seat'; model: typeof LITE_MODEL };
export function liteJobs(phase: string, pool: Map<string, PairItem>, plan: {
  pilotIds: string[]; noiseIds: string[]; fixtures: { availableDevPairs: number; ids: string[] }[];
}, testIds: readonly string[]): LiteJob[] {
  const jobs: LiteJob[] = [];
  const add = (item: PairItem, sample: number, contestants: LiteJob['contestant'][], subphase = phase) => {
    for (const contestant of contestants) jobs.push({ item, phase: subphase, sample, contestant, model: LITE_MODEL });
  };
  if (phase === 'pilot') for (const id of plan.pilotIds) add(pool.get(id)!, 0, ['pair-ledger', 'promptfoo']);
  if (phase === 'fixtures') for (const fixture of plan.fixtures) if (fixture.availableDevPairs >= 6)
    for (const id of fixture.ids) for (let sample = 0; sample < 3; sample++) add(pool.get(id)!, sample, ['seat']);
  if (phase === 'noise') for (const id of plan.noiseIds) for (let sample = 0; sample < 3; sample++) add(pool.get(id)!, sample, ['pair-ledger']);
  if (phase === 'validity') for (const item of validityFixtures()) for (const [name, variant] of Object.entries(variants(item))) add(variant, 0, ['pair-ledger'], `validity-${name}`);
  if (phase === 'provider-probe') add(pool.get(SETTINGS.providerBlockProbe.id)!, 0, ['promptfoo']);
  if (phase === 'test') for (const id of [...testIds].sort((a, b) => sha(SETTINGS.testOrderSeed + a).localeCompare(sha(SETTINGS.testOrderSeed + b)))) add(pool.get(id)!, 0, ['pair-ledger', 'promptfoo']);
  return jobs;
}

export async function liteReport() {
  const result = await report({ directory: LITE_DIRECTORY, models: [LITE_MODEL], capUsd: LITE_SETTINGS.capUsd, settings: LITE_SETTINGS });
  for (const cell of result.cells) {
    cell.verdict = !cell.coverage.complete ? 'PENDING: incomplete' : cell.stats!.difference < 0 && cell.stats!.gameMcNemarP < .05 ? 'LOSS' : 'TIE or pending Holm matrix';
    cell.providerBlockExcluded.status = 'Secondary score excludes the union of blocked items for both contestants on this model. Headline uses all sealed items; Holm awaits the complete amended matrix.';
  }
  await writeFile(`${LITE_DIRECTORY}/live-summary.json`, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: rubric-ledger-flash-lite.ts --phase seal|pilot|fixtures|noise|validity|provider-probe|report|test [--execute] [--probe-one-call]. Separate USD 8 cell; medium; eight calls; no automatic Gemini 3.8 calls.'); return;
  }
  const phase = process.argv[process.argv.indexOf('--phase') + 1];
  if (!['seal', 'pilot', 'fixtures', 'noise', 'validity', 'provider-probe', 'report', 'test'].includes(phase ?? '')) throw new Error('Select a phase');
  const execute = process.argv.includes('--execute'), probe = process.argv.includes('--probe-one-call');
  if (probe && phase !== 'pilot') throw new Error('The setting probe must be the first sealed pilot request');
  process.env.DRIFTBENCH_BENCH_CACHE = resolve('.cache/ledger-rb/data');
  process.env.RB_EXECUTION_ROOT = resolve('.cache/ledger-rb/execution');
  process.env.TMPDIR = resolve('.cache/ledger-rb/tmp');
  await mkdir(LITE_DIRECTORY, { recursive: true }); await mkdir(process.env.TMPDIR, { recursive: true });
  const paths = [...sourcePaths, 'examples/judge-benchmarks/src/rubric-ledger-flash-lite.ts'];
  const hashes = Object.fromEntries(await Promise.all(paths.map(async (p) => [p, sha(await readFile(p, 'utf8'))])));
  const freezePath = `${LITE_DIRECTORY}/contestant-freeze.json`;
  if (phase === 'seal') {
    for (const name of ['development-plan.json', 'requirements.json', 'test-ids.json'])
      await writeFile(`${LITE_DIRECTORY}/${name}`, await readFile(`${DIRECTORY}/${name}`), { flag: 'wx' });
    await writeFile(freezePath, `${JSON.stringify({ createdAt: new Date().toISOString(), settings: LITE_SETTINGS, hashes,
      authority: 'Owner explicitly authorizes the separate Flash-Lite cell, USD 8, same validity checks then full 790 sealed TEST, eight concurrent calls; Haiku continues.',
      originalSealSha256: sha(await readFile(`${DIRECTORY}/test-run-seal.json`, 'utf8')),
      phases: ['pilot', 'fixtures', 'noise', 'validity', 'provider-probe', 'test'],
      validityFixtures: validityFixtures().map(variants),
      testGate: 'All same-model pre-TEST checks pass and cost projection plus pre-TEST hashes are committed before any TEST call.' }, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ phase, freezeSha256: sha(await readFile(freezePath, 'utf8')) })); return;
  }
  if (phase === 'report') { await liteReport(); return; }
  const freezeText = await readFile(freezePath, 'utf8'), freeze = JSON.parse(freezeText);
  if (JSON.stringify(hashes) !== JSON.stringify(freeze.hashes) || JSON.stringify(LITE_SETTINGS) !== JSON.stringify(freeze.settings)) throw new Error('Flash-Lite frozen source/settings changed');
  if (execFileSync('git', ['show', `HEAD:${freezePath}`], { encoding: 'utf8' }) !== freezeText) throw new Error('Flash-Lite freeze not committed');
  if (phase === 'test') {
    const gatePath = `${LITE_DIRECTORY}/test-run-seal.json`, text = await readFile(gatePath, 'utf8');
    if (text !== execFileSync('git', ['show', `HEAD:${gatePath}`], { encoding: 'utf8' })) throw new Error('TEST seal not committed');
    const gate = JSON.parse(text);
    if (!gate.allowTest || gate.freezeSha256 !== sha(freezeText)) throw new Error('TEST validity/freeze gate failed');
  }
  const calls = await new LedgerCalls(`${LITE_DIRECTORY}/live`, LITE_SETTINGS.capUsd, probe ? 1 : Infinity).load();
  if (calls.uncertainKeys.length) throw new Error(`Unfinished reservations: ${calls.uncertainKeys.length}`);
  const env: NodeJS.ProcessEnv = {};
  env.GEMINI_API_KEY = execute ? (await readFile(resolve(homedir(), '.nexus-secrets/gemini-driftbench.key'), 'utf8')).trim() : 'offline-placeholder';
  const raw = createDialectTransport({ provider: 'google', model: LITE_MODEL, env, reasoning: LITE_SETTINGS.reasoning,
    maxTokens: LITE_SETTINGS.maxTokens, timeoutMs: LITE_SETTINGS.timeoutMs, maxRetries: 0 });
  const pool = new Map(((await loadBenchmark('rubricbench')).items as PairItem[]).map((item) => [item.id, item]));
  const plan = JSON.parse(await readFile(`${LITE_DIRECTORY}/development-plan.json`, 'utf8'));
  const ids: string[] = JSON.parse(await readFile(`${LITE_DIRECTORY}/test-ids.json`, 'utf8'));
  const manifest: { id: string; requirements: RubricItem[] }[] = JSON.parse(await readFile(`${LITE_DIRECTORY}/requirements.json`, 'utf8'));
  const requirements = new Map(manifest.map((r) => [r.id, r.requirements]));
  const jobs = liteJobs(phase!, pool, plan, ids), resultPath = `${LITE_DIRECTORY}/decisions-${phase}.jsonl`;
  const prior = latestDecisions(await readRecordingRows<DecisionRow>(resultPath));
  const done = new Set(prior.filter((r) => r.status !== 'transport-error' && !hasUnresolvedPrepayment(r, calls.rows)).map(decisionKey));
  let stopped = false, writes = Promise.resolve(), added = 0, probeStopped = false;
  process.once('SIGUSR2', () => { stopped = true; console.error('Stop requested; drain in-flight work'); });
  await scheduleModels(jobs.filter((j) => !done.has(decisionKey({ ...j, id: j.item.id }))), { [LITE_MODEL]: probe ? 1 : LITE_SETTINGS.concurrency }, async (job) => {
    try {
      const reqs = requirements.get(job.item.id) ?? [{ name: 'rb_1', rubric: job.item.criterion! }];
      const row = classifyProviderBlock(await evaluate(job.item, reqs, LITE_MODEL, job.phase, job.sample, job.contestant,
        raw, calls, execute, undefined, undefined, undefined, { rateLimitWaitMs: LITE_SETTINGS.rateLimitWaitMs, price: litePrice }), calls.rows);
      writes = writes.then(() => appendRecording(resultPath, row)); await writes; added++;
      console.log(JSON.stringify({ phase, model: LITE_MODEL, contestant: job.contestant, completed: done.size + added, target: jobs.length, chargedUsd: calls.chargedUsd, status: row.status }));
    } catch (error) { stopped = true; probeStopped = error instanceof LedgerProbeStop; console.error(error instanceof Error ? error.message : String(error)); }
  }, () => stopped);
  await writes;
  const recorded = new Map(latestDecisions(await readRecordingRows<DecisionRow>(resultPath)).map((r) => [decisionKey(r), r]));
  const ordered = jobs.flatMap((j, recordIndex) => {
    const row = recorded.get(decisionKey({ ...j, id: j.item.id }));
    return row ? [{ model: row.model, phase: row.phase, id: row.id, contestant: row.contestant, sample: row.sample, recordIndex }] : [];
  });
  await writeFile(`${LITE_DIRECTORY}/ordered-${phase}.json`, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(JSON.stringify({ phase, complete: !stopped, probeStopped, added, prior: done.size, target: jobs.length, chargedUsd: calls.chargedUsd }));
  if (stopped) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
