import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseJudgeText } from '../../../../packages/judges/src/assessment';
import { buildPrompt } from '../../../../packages/judges/src/prompt';
import type { Case, Row } from '../generate.mts';
import { canCall, type Outcome, panel, parseGrade, promptFor, requestSha256, wilson } from '../harness';
import { recordingLines } from '../recordings';
import { type Config, requestFor } from './request';

// Scores the judge this checkout ships against the verbatim Inspect templates.
// Usage: run.mts <qa|fact|panel|borderline> <audit|default|theirs> --set <file under hard/> --out <dir under hard/> [--replay]
// audit and default are the two driftbench procedures (see request.ts); theirs is Inspect.
const hard = fileURLToPath(new URL('../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const row = process.argv[2] as Row;
const procedure = process.argv[3] as Config | 'theirs';
const side = procedure === 'theirs' ? 'theirs' : 'ours';
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const setPath = flag('--set');
const outDir = flag('--out');
const replay = process.argv.includes('--replay');
if (
  !['qa', 'fact', 'panel', 'borderline'].includes(row) ||
  !['audit', 'default', 'theirs'].includes(procedure) ||
  !setPath ||
  !outDir
)
  throw new Error('Usage: run.mts <row> <audit|default|theirs> --set <file> --out <dir> [--replay]');
// A frozen held-out set runs only against the exact judge, templates and runner named in its manifest.
if (setPath.startsWith('shipped/heldout/')) {
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const frozen = JSON.parse(readFileSync(`${here}heldout/freeze.json`, 'utf8')) as {
    sha256: Record<string, string>;
  };
  for (const [path, hash] of Object.entries(frozen.sha256))
    if (
      createHash('sha256')
        .update(readFileSync(`${repo}${path}`))
        .digest('hex') !== hash
    )
      throw new Error(`Frozen judge, harness or held-out input changed: ${path}`);
}
const cap = Number(process.env.CAP_USD ?? '0');
const perCall = 0.02;
const concurrency = Number(process.env.CONCURRENCY ?? '2');
const recording = `${here}calls.jsonl`;
const runtime = `${here}.cache/runtime`;
mkdirSync(runtime, { recursive: true });
mkdirSync(`${hard}${outDir}`, { recursive: true });

type Call = {
  request_sha256: string;
  row: Row;
  side: string;
  id: string;
  repeat: number;
  prompt: { system: string; user: string };
  text: string;
  costUsd: number;
  reservedUsd: number;
  error: string | null;
  modelUsage: unknown;
  timestamp: string;
};
// Earlier Inspect recordings replay for free: the request digest binds model, both prompt texts and repeat.
// This runner's own recordings: immutable parts under calls/, then the active file.
const own: Call[] = recordingLines(new URL('./', import.meta.url)).map((line) => JSON.parse(line));
const cache = new Map<string, Call>();
for (const line of recordingLines(new URL('../', import.meta.url))) {
  const record = JSON.parse(line);
  cache.set(record.request_sha256 ?? record.key, record);
}
for (const record of own) cache.set(record.request_sha256, record);
let spent = own.reduce((sum, call) => sum + call.reservedUsd, 0);
let fresh = 0;

async function ask(
  c: Case,
  prompt: { system: string; user: string },
  repeat: number,
): Promise<Call | undefined> {
  const request_sha256 = requestSha256(prompt, repeat);
  const old = cache.get(request_sha256);
  if (old) return old;
  // A transport failure (timeout, no result) is retried twice. A model answer is never retried here.
  for (let tries = 0; tries < 3; tries++) {
    const call = await attempt(c, prompt, repeat, request_sha256);
    if (call) return call;
  }
  return undefined;
}
async function attempt(
  c: Case,
  prompt: { system: string; user: string },
  repeat: number,
  request_sha256: string,
): Promise<Call | undefined> {
  if (replay || !canCall(spent, perCall, cap)) return undefined;
  spent += perCall;
  // The flags of packages/judges/src/clients/claude-cli.ts, on both sides.
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    'haiku',
    '--system-prompt',
    prompt.system,
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    '1',
    '--max-budget-usd',
    String(perCall),
  ];
  const ran = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, {
      cwd: runtime,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), Number(process.env.CALL_TIMEOUT_MS ?? '90000'));
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (e) => {
      stderr += e.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(prompt.user);
  });
  let text = '';
  let costUsd = 0;
  let error: string | null = null;
  let modelUsage: unknown = null;
  let known = false;
  try {
    const parsed = JSON.parse(ran.stdout);
    known = typeof parsed.total_cost_usd === 'number' && parsed.total_cost_usd >= 0;
    costUsd = known ? parsed.total_cost_usd : 0;
    text = String(parsed.result ?? '');
    modelUsage = parsed.modelUsage ?? parsed.usage;
    if (ran.code !== 0 || parsed.is_error || !text)
      error = JSON.stringify({ code: ran.code, result: parsed.result, stderr: ran.stderr.slice(0, 500) });
  } catch {
    error = JSON.stringify({
      code: ran.code,
      stdout: ran.stdout.slice(0, 500),
      stderr: ran.stderr.slice(0, 500),
    });
  }
  const reservedUsd = known ? costUsd : perCall;
  spent += reservedUsd - perCall;
  const answer: Call = {
    request_sha256,
    row,
    side,
    id: c.id,
    repeat,
    prompt,
    text,
    costUsd,
    reservedUsd,
    error,
    modelUsage,
    timestamp: new Date().toISOString(),
  };
  // A failed call is never cached: it is reported and the case stays incomplete.
  if (error) {
    appendFileSync(`${here}.cache/errors.jsonl`, `${JSON.stringify(answer)}\n`);
    return undefined;
  }
  appendFileSync(recording, `${JSON.stringify(answer)}\n`);
  cache.set(request_sha256, answer);
  fresh++;
  return answer;
}

/** One vote of the shipped single judge: one call, and one more after an invalid ledger (packages/judges/src/single.ts). */
async function oursVote(c: Case, vote: number) {
  const request = requestFor(c, row, procedure as Config);
  const prompt = buildPrompt(request);
  const calls: Call[] = [];
  let outcome: Outcome = 'inconclusive';
  let complete = false;
  for (const attempt of [0, 1]) {
    const call = await ask(c, prompt, vote * 10 + attempt);
    if (!call) break;
    calls.push(call);
    const result = parseJudgeText(call.text, request);
    outcome = result.unparsed ? 'inconclusive' : result.answer.outcome;
    complete = true;
    const retry =
      result.unparsed &&
      (result.answer.reasoning.startsWith('invalid criterion ledger:') ||
        result.answer.reasoning.startsWith('answer breaks the assessment contract:'));
    if (!retry) break;
    complete = attempt === 1;
  }
  return { outcome, calls, complete };
}
async function theirsVote(c: Case, vote: number) {
  const call = await ask(c, promptFor(c, row, 'theirs'), vote);
  return {
    outcome: call ? parseGrade(call.text) : ('inconclusive' as Outcome),
    calls: call ? [call] : [],
    complete: !!call,
  };
}

const body = readFileSync(`${hard}${setPath}`, 'utf8');
const cases = JSON.parse(body) as Case[];
const votesPerCase = row === 'panel' || row === 'borderline' ? 3 : 1;
const results: {
  id: string;
  family: string;
  label: string;
  outcome: Outcome;
  complete: boolean;
  votes: Outcome[];
  request_sha256: string[];
  costUsd: number;
}[] = new Array(cases.length);
let next = 0;
async function worker() {
  for (;;) {
    const index = next++;
    if (index >= cases.length) return;
    const c = cases[index] as Case;
    const votes = [];
    for (let v = 0; v < votesPerCase; v++)
      votes.push(await (side === 'ours' ? oursVote(c, v) : theirsVote(c, v)));
    const complete = votes.every((v) => v.complete);
    const outcomes = votes.map((v) => v.outcome);
    results[index] = {
      id: c.id,
      family: c.family,
      label: c.label,
      outcome: !complete ? 'inconclusive' : votesPerCase === 1 ? (outcomes[0] as Outcome) : panel(outcomes),
      complete,
      votes: outcomes,
      request_sha256: votes.flatMap((v) => v.calls.map((call) => call.request_sha256)),
      costUsd: votes.reduce((sum, v) => sum + v.calls.reduce((s, call) => s + call.costUsd, 0), 0),
    };
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const done = results.filter((r) => r.complete);
const right = done.filter((r) => r.outcome === r.label).length;
const summary = {
  row,
  side,
  variant: procedure,
  procedure:
    side === 'theirs'
      ? `Inspect default ${row === 'fact' ? 'model_graded_fact' : 'model_graded_qa'} template${votesPerCase > 1 ? ', three votes, majority' : ''}`
      : `driftbench ${procedure === 'audit' ? 'answer audit' : 'default judge'}${votesPerCase > 1 ? ', three votes, weighted panel' : ''}`,
  model: 'haiku',
  set: setPath,
  setSha256: createHash('sha256').update(body).digest('hex'),
  items: cases.length,
  complete: done.length,
  right,
  wrong: done.filter((r) => r.outcome !== 'inconclusive' && r.outcome !== r.label).length,
  inconclusive: done.filter((r) => r.outcome === 'inconclusive').length,
  ci95: wilson(right, cases.length),
  costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
  calls: results.reduce((sum, r) => sum + r.request_sha256.length, 0),
  results,
};
writeFileSync(`${hard}${outDir}/${row}-${procedure}.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, results: undefined, fresh, spentUsd: spent }));
