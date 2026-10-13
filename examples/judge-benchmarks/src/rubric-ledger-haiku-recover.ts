import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildDialectRequest, createDialectTransport, type DialectTransport, type RubricItem } from '@agent-nexus/driftbench-judges';
import { CLAUDE_JUDGE_FLAGS, runClaudeCommand } from '../../../packages/judges/src/clients/claude-cli';
import { loadBenchmark, type PairItem } from './data';
import { appendRecording, readRecordingRows } from './recording-files';
import { LedgerCalls } from './rubric-ledger-calls';
import { NetworkLedgerCalls } from './rubric-ledger-network-calls';
import { DIRECTORY, SETTINGS, classifyProviderBlock, decisionKey, evaluate, latestDecisions, scheduleModels, sha, type DecisionRow } from './rubric-ledger-live';
import { sonnetCompletion } from './rubric-ledger-added-transports';
import { report } from './rubric-ledger-report';

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required; missing-only Haiku recovery');
  const amendmentPath = `${DIRECTORY}/network-runtime-amendment.json`, amendmentText = await readFile(amendmentPath, 'utf8');
  if (execFileSync('git', ['show', `HEAD:${amendmentPath}`], { encoding: 'utf8' }) !== amendmentText) throw new Error('Network amendment not committed');
  const amendment = JSON.parse(amendmentText);
  for (const [path, hash] of Object.entries(amendment.runtimeHashes ?? {}))
    if (sha(await readFile(path, 'utf8')) !== hash) throw new Error(`Runtime source changed: ${path}`);
  const model = 'claude-haiku-5-5';
  const calls = await new NetworkLedgerCalls(`${DIRECTORY}/live`, 45, model, 'anthropic').load();
  if (calls.uncertainKeys.length) throw new Error('Unfinished prior call');
  process.env.DRIFTBENCH_BENCH_CACHE = resolve('.cache/ledger-rb/data');
  process.env.RB_EXECUTION_ROOT = resolve('.cache/ledger-rb/execution');
  process.env.TMPDIR = resolve('.cache/ledger-rb/tmp'); await mkdir(process.env.TMPDIR, { recursive: true });
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY',
    'OPENAI_BASE_URL', 'GOOGLE_BASE_URL', 'ANTHROPIC_BASE_URL', 'CLAUDECODE', 'CLAUDE_CODE_RETRY_WATCHDOG']) delete env[key];
  env.CLAUDE_JUDGE_MODEL = model; env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';
  env.CLAUDE_CODE_MAX_RETRIES = '0'; env.CLAUDE_CODE_NONSTREAMING_TIMEOUT_RETRIES = '0';
  const original = createDialectTransport({ provider: 'claude-cli', model, env,
    maxTokens: SETTINGS.maxTokens, timeoutMs: SETTINGS.timeoutMs, maxRetries: 0, maxBudgetUsd: SETTINGS.reserveUsd });
  const folder = mkdtempSync(join(tmpdir(), 'driftbench-haiku-recovery-'));
  const receiptDir = `${DIRECTORY}/network-recovery-receipts`; await mkdir(receiptDir, { recursive: true });
  const raw: DialectTransport = { ...original, async complete(request) {
    const built = buildDialectRequest('claude-cli', request);
    const ran = await runClaudeCommand('claude', ['-p', '--output-format', 'json', '--model', model,
      '--system-prompt', request.system, ...CLAUDE_JUDGE_FLAGS, '--max-budget-usd', String(SETTINGS.reserveUsd)],
      built.payload.user as string, { cwd: folder, env, timeoutMs: SETTINGS.timeoutMs });
    let value: any;
    try { value = JSON.parse(ran.stdout); }
    catch { throw Object.assign(new Error(`claude exited ${ran.code} without a JSON result: ${ran.stderr}`), { retryable: true }); }
    await writeFile(`${receiptDir}/${sha(ran.stdout)}.json`, `${JSON.stringify(value, null, 2)}\n`);
    const identity = { dialect: raw.dialect, fingerprint: sha(JSON.stringify({ transport: raw.fingerprint, request: built.fingerprint })) };
    try { return { ...sonnetCompletion(value), ...identity }; }
    catch {
      const errorText = JSON.stringify(value.errors ?? value.result ?? value.subtype);
      const status = Number(errorText.match(/\b(402|429|50[0-9]|529)\b/)?.[1]) || undefined;
      const receipt = { text: '', raw: ran.stdout, fingerprint: identity.fingerprint, costUsd: value.total_cost_usd,
        usage: { input: value.usage?.input_tokens, output: value.usage?.output_tokens }, finishReason: value.subtype };
      throw Object.assign(new Error(`Native CLI reported no answer: ${errorText}`), {
        retryable: /network|connect|timeout|fetch|socket|502|503|504|529|overload/i.test(errorText), status, completion: receipt });
    }
  } };
  const pool = new Map(((await loadBenchmark('rubricbench')).items as PairItem[]).map((item) => [item.id, item]));
  const manifest: { id: string; requirements: RubricItem[] }[] = JSON.parse(await readFile(`${DIRECTORY}/requirements.json`, 'utf8'));
  const reqs = new Map(manifest.map((r) => [r.id, r.requirements]));
  const path = `${DIRECTORY}/decisions-test.jsonl`;
  const prior = latestDecisions(await readRecordingRows<DecisionRow>(path));
  const answered = new Set(calls.rows.filter((r) => r.status === 'ok').map((r) => JSON.stringify([r.identity.model, r.identity.phase, r.item, r.contestant, r.identity.sample, r.identity.ordinal])));
  const missing = new Set(calls.rows.filter((r) => r.model === model && r.identity.phase === 'test' && r.status === 'error' &&
    !answered.has(JSON.stringify([r.identity.model, r.identity.phase, r.item, r.contestant, r.identity.sample, r.identity.ordinal])))
    .map((r) => JSON.stringify([r.item, r.contestant, r.identity.sample])));
  const ids: string[] = JSON.parse(await readFile(`${DIRECTORY}/test-ids.json`, 'utf8'));
  const rank = new Map([...ids].sort((a, b) => sha(SETTINGS.testOrderSeed + a).localeCompare(sha(SETTINGS.testOrderSeed + b))).map((id, i) => [id, i]));
  const todo = prior.filter((r) => r.model === model && missing.has(JSON.stringify([r.id, r.contestant, r.sample])))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)! || Number(a.contestant === 'promptfoo') - Number(b.contestant === 'promptfoo'));
  await calls.waitForNetwork();
  await scheduleModels(todo, { [model]: 2 }, async (job) => {
    const result = await evaluate(pool.get(job.id)!, reqs.get(job.id)!, model, 'test', job.sample,
      job.contestant as 'pair-ledger' | 'promptfoo', raw, calls as unknown as LedgerCalls, true);
    result.callKeys = calls.rows.filter((r) => r.model === model && r.identity.phase === 'test' && r.item === job.id &&
      r.contestant === job.contestant && r.identity.sample === job.sample).map((r) => r.key);
    await appendRecording(path, classifyProviderBlock(result, calls.rows));
    console.log(JSON.stringify({ id: result.id, contestant: result.contestant, status: result.status, chargedUsd: calls.chargedUsd }));
  });
  await report();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
