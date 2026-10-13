/** Measurement only: all prompt and decision logic comes from the shipped package. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJudgeText } from '../../packages/judges/src/assessment';
import type { JudgeRequest } from '../../packages/judges/src/contract';
import { buildPrompt } from '../../packages/judges/src/prompt';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const [phase = 'tuning', mode = 'feature', action = 'replay'] = process.argv.slice(2);
if (
  !['tuning', 'heldout'].includes(phase) ||
  !['feature', 'default'].includes(mode) ||
  !['record', 'replay'].includes(action)
)
  throw new Error('Usage: run.ts tuning|heldout feature|default record|replay');
if (phase === 'heldout' && mode !== 'feature')
  throw new Error('Only the final feature is measured on heldout.');
const reservation = resolve(here, 'pending-reservation.json');
if (existsSync(reservation))
  throw new Error('Unresolved previous call reservation. Reconcile before continuing.');
const lockPath = resolve(here, '.run.lock');
writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
process.on('exit', () => unlinkSync(lockPath));
const corpusPath = resolve(here, `../deepeval/hard/sets${phase === 'heldout' ? '-heldout' : ''}.json`);
type Case = {
  id: string;
  truth: boolean;
  family: string;
  turns: { role: 'user' | 'assistant'; content: string }[];
};
const cases = (JSON.parse(readFileSync(corpusPath, 'utf8')) as { relevancy: Case[] }).relevancy;
const yaml = createRequire(resolve(root, 'packages/core/package.json'))('yaml') as {
  parse: (s: string) => { criterion: JudgeRequest['criterion'] };
};
const criterion = yaml.parse(
  readFileSync(resolve(root, 'examples/criteria/relevancy.yaml'), 'utf8'),
).criterion;
const rendered = cases.map((row) => {
  const request: JudgeRequest = {
    criterion,
    transcript: row.turns.map((turn) => ({
      role: turn.role === 'assistant' ? 'agent' : 'user',
      text: turn.content,
    })),
    ...(mode === 'feature'
      ? { assessment: { kind: 'response-relevance' } as JudgeRequest['assessment'] }
      : {}),
  };
  const prompt = buildPrompt(request);
  return { row, request, prompt, requestSha256: sha(JSON.stringify(['haiku', prompt.system, prompt.user])) };
});
const cliFlags = [
  '-p',
  '--output-format',
  'json',
  '--model',
  'haiku',
  '--tools',
  '',
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--max-turns',
  '1',
  '--max-budget-usd',
  '0.05',
];
const sourceHashes = (folder: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(folder, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry): [string, string][] => {
        const path = resolve(folder, entry.name);
        return entry.isDirectory()
          ? Object.entries(sourceHashes(path))
          : [[path.slice(root.length + 1), sha(readFileSync(path, 'utf8'))]];
      }),
  );
const freeze = {
  corpusSha256: sha(readFileSync(corpusPath, 'utf8')),
  promptsSha256: sha(JSON.stringify(rendered.map(({ prompt }) => prompt))),
  cases: cases.length,
  ...(mode === 'feature'
    ? {
        packageSourceHashes: sourceHashes(resolve(root, 'packages/judges/src')),
        cliFlags,
        cliVersion: spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim(),
      }
    : {}),
};
const freezePath = resolve(here, `${mode}-${phase}-freeze.json`);
if (existsSync(freezePath)) {
  if (JSON.stringify(JSON.parse(readFileSync(freezePath, 'utf8'))) !== JSON.stringify(freeze))
    throw new Error('Frozen corpus or prompts changed. Use a new tuning version; never retune heldout.');
} else {
  if (action !== 'record') throw new Error('No frozen run exists.');
  writeFileSync(freezePath, `${JSON.stringify(freeze, null, 2)}\n`);
}
const callsPath = resolve(here, 'calls.jsonl');
type Call = {
  requestSha256: string;
  phase: string;
  mode: string;
  system: string;
  user: string;
  result: string;
  chargedUsd: number;
  reservation?: boolean;
  envelope?: unknown;
  error?: string;
  rawStdout?: string;
  rawStderr?: string;
};
const calls: Call[] = existsSync(callsPath)
  ? readFileSync(callsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Call)
  : [];
const cache = new Map(calls.map((call) => [call.requestSha256, call]));
if (calls.some((call) => call.reservation))
  throw new Error('A prior call has unresolved cost; reconcile before continuing.');
if (phase === 'heldout' && rendered.some(({ requestSha256 }) => cache.get(requestSha256)?.phase === 'tuning'))
  throw new Error('Heldout input overlaps a tuning recording.');
let spend = calls.reduce((total, call) => total + call.chargedUsd, 0);
let freshUsd = 0;
let freshCalls = 0;
const runtime = resolve(root, '.local/geval/runtime');
mkdirSync(runtime, { recursive: true });
const outputPath = resolve(here, `${mode}-${phase}${action === 'replay' ? '-replay' : ''}.json`);
const completionPath = resolve(here, 'heldout-complete.json');
if (phase === 'heldout' && action === 'record' && existsSync(completionPath))
  throw new Error('Heldout measurement is complete; use free replay.');
const rows: unknown[] = [];
const save = () =>
  writeFileSync(
    outputPath,
    `${JSON.stringify({ phase, mode, ...freeze, freshCalls, freshUsd, totalSpendUsd: spend, rows }, null, 2)}\n`,
  );
for (const { row, request, prompt, requestSha256 } of rendered) {
  let call = cache.get(requestSha256);
  if (!call) {
    if (action !== 'record') throw new Error(`Missing recording ${requestSha256}`);
    const reserve = 0.05;
    if (spend + reserve > 5) throw new Error('Authorized $5 cap reached.');
    writeFileSync(reservation, JSON.stringify({ requestSha256, reserve, phase, mode }), { flag: 'wx' });
    const args = [...cliFlags, '--system-prompt', prompt.system];
    const proc = spawnSync('claude', args, {
      input: prompt.user,
      encoding: 'utf8',
      cwd: runtime,
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    call = { requestSha256, phase, mode, ...prompt, result: '', chargedUsd: reserve, reservation: true };
    try {
      const envelope = JSON.parse(proc.stdout);
      if (
        typeof envelope.total_cost_usd !== 'number' ||
        !Number.isFinite(envelope.total_cost_usd) ||
        envelope.total_cost_usd < 0
      )
        throw new Error('Missing valid cost');
      call.envelope = envelope;
      call.chargedUsd = envelope.total_cost_usd;
      delete call.reservation;
      call.result = String(envelope.result ?? '');
      if (proc.status !== 0 || envelope.is_error || envelope.subtype !== 'success')
        call.error = `Invocation failed: ${envelope.subtype}; ${proc.stderr}`;
    } catch (error) {
      call.error = `${String(error)}; ${String(proc.error ?? '')}; ${proc.stderr}`;
      call.rawStdout = proc.stdout;
      call.rawStderr = proc.stderr;
    }
    appendFileSync(callsPath, `${JSON.stringify(call)}\n`);
    if (call.reservation) throw new Error('Unresolved call cost retained; measurement stopped.');
    unlinkSync(reservation);
    cache.set(requestSha256, call);
    spend += call.chargedUsd;
    freshUsd += call.chargedUsd;
    freshCalls++;
    if (call.chargedUsd > reserve)
      throw new Error('Reported call cost exceeds its reservation; measurement stopped.');
  }
  const result = call.error
    ? { unparsed: true, answer: { outcome: 'inconclusive', reasoning: call.error } }
    : parseJudgeText(call.result, request);
  const prediction =
    result.unparsed || result.answer.outcome === 'inconclusive' ? null : result.answer.outcome === 'pass';
  rows.push({
    id: row.id,
    truth: row.truth,
    prediction,
    correct: prediction === row.truth,
    requestSha256,
    result,
    costUsd: call.chargedUsd,
  });
  save();
  console.log(
    `${phase} ${mode}: ${rows.length}/${cases.length}; fresh=${freshCalls}; cumulative=$${spend.toFixed(6)}`,
  );
}
if (
  mode === 'feature' &&
  JSON.stringify(sourceHashes(resolve(root, 'packages/judges/src'))) !==
    JSON.stringify(freeze.packageSourceHashes)
)
  throw new Error('Package source changed during measurement.');
if (phase === 'heldout' && action === 'record')
  writeFileSync(completionPath, `${JSON.stringify(freeze, null, 2)}\n`, { flag: 'wx' });
