import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';
import {
  buildPrompt,
  type JudgeClient,
  type JudgeRequest,
  type JudgeResult,
  judgeAnswerAudit,
  parseJudgeText,
} from '../../packages/judges/src/index';
import { type Item, type Mode, requestFor } from './request';
import { oldItems, oldRequestFor } from './request-old';

// Scores the judge this checkout ships, and the competitor's own default prompt, on frozen held-out rows.
// Usage: run.mts <promptfoo|langfuse|deepeval|langwatch> <row>:<default|audit|theirs>[,...] [--replay] [--limit N] [--max-fresh N]
// Jobs run in order in one process, after one probe gate. deepeval theirs runs in deepeval_run.py.
// Every answered call is recorded once and never sent again.
const here = fileURLToPath(new URL('./', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const competitor = process.argv[2] as string;
const jobs = (process.argv[3] ?? '').split(',').map((job) => job.split(':') as [string, Mode | 'theirs']);
const replay = process.argv.includes('--replay');
const option = (name: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : Number(process.argv[at + 1]);
};
const limit = option('--limit');
const maxFresh = option('--max-fresh');
// --old: the EXISTING held-out sets the README charts show, today's judge only (request-old.ts), capped at 3 USD.
const old = process.argv.includes('--old');
const OLD_CAP_USD = 3;
if (
  !['promptfoo', 'langfuse', 'deepeval', 'langwatch'].includes(competitor) ||
  jobs.some(
    ([r, c]) =>
      !r ||
      !['default', 'audit', 'theirs'].includes(c) ||
      ((competitor === 'deepeval' || old) && c === 'theirs'),
  )
)
  throw new Error(
    'Usage: run.mts <promptfoo|langfuse|deepeval|langwatch> <row>:<default|audit|theirs>[,...] [--replay] [--limit N] [--max-fresh N]',
  );
let row = '';
let contestant: Mode | 'theirs' = 'default';

// Nothing runs against a set, prompt, judge source or runner that differs from the freeze.
const freeze = JSON.parse(readFileSync(`${here}freeze.json`, 'utf8')) as { sha256: Record<string, string> };
for (const [path, hash] of Object.entries(freeze.sha256))
  if (
    createHash('sha256')
      .update(readFileSync(`${repo}${path}`))
      .digest('hex') !== hash
  )
    throw new Error(`Changed after the freeze: ${path}`);

// 25 USD for the first three competitors plus 8 USD added for LangWatch (freeze amendment).
const CAP_USD = 33;
const PER_CALL_USD = 0.05;
const CONCURRENCY = 2;
mkdirSync(`${here}calls`, { recursive: true });
mkdirSync(`${here}results`, { recursive: true });
mkdirSync(`${here}.cache/runtime`, { recursive: true });
const recording = `${here}calls/${old ? 'old-' : ''}${competitor}.jsonl`;

type Call = {
  key: string;
  competitor: string;
  row: string;
  contestant: string;
  id: string;
  attempt: number;
  prompt: Prompt;
  text: string;
  structured?: unknown;
  costUsd: number;
  modelUsage: unknown;
  timestamp: string;
};
const lines = (path: string) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
    : [];
const cache = new Map<string, Call>();
for (const line of lines(recording)) {
  const call = JSON.parse(line) as Call;
  cache.set(call.key, call);
}
/** Spend across every recording of this comparison, both runners: the cap is one budget. */
function spentUsd(): number {
  let total = 0;
  for (const name of readdirSync(`${here}calls`).filter((n) => n.endsWith('.jsonl')))
    for (const line of lines(`${here}calls/${name}`)) {
      const record = JSON.parse(line);
      total += Number((name.startsWith('failures') ? record.reservedUsd : record.costUsd) ?? 0);
    }
  return total;
}
let spent = spentUsd();
let oldSpent = readdirSync(`${here}calls`)
  .filter((n) => n.startsWith('old-'))
  .reduce(
    (s, n) => s + lines(`${here}calls/${n}`).reduce((t, l) => t + Number(JSON.parse(l).costUsd ?? 0), 0),
    0,
  );
let reserved = 0;
let fresh = 0;
let consecutiveFailures = 0;
let gate: Promise<void> | undefined;

/** A competitor prompt may carry a JSON schema: the LangWatch judge answers through structured output. */
type Prompt = { system: string; user: string; schema?: unknown };
const keyOf = (prompt: Prompt, attempt: number) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        'haiku',
        prompt.system,
        prompt.user,
        attempt,
        ...(prompt.schema === undefined ? [] : [prompt.schema]),
      ]),
    )
    .digest('hex');

function probeOnce(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpsRequest('https://api.anthropic.com/', { method: 'HEAD', timeout: 10_000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}
/** Ten healthy network probes, 30 seconds apart, before paid calls resume. No model call. */
async function probeGate(reason: string) {
  console.log(JSON.stringify({ gate: reason, at: new Date().toISOString() }));
  let healthy = 0;
  while (healthy < 10) {
    healthy = (await probeOnce()) ? healthy + 1 : 0;
    if (healthy < 10) await new Promise((r) => setTimeout(r, 30_000));
  }
  console.log(JSON.stringify({ gate: 'open', at: new Date().toISOString() }));
}
async function waitForGate() {
  while (gate) await gate;
}

function lean(prompt: Prompt, turns = 1) {
  // The flags of packages/judges/src/clients/claude-cli.ts, for both sides, with prompt caching disabled.
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
    String(turns),
    '--max-budget-usd',
    String(PER_CALL_USD),
    ...(prompt.schema === undefined ? [] : ['--json-schema', JSON.stringify(prompt.schema)]),
  ];
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, {
      cwd: `${here}.cache/runtime`,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined, DISABLE_PROMPT_CACHING: '1' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 150_000);
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
}

/** One answered call, from the recording or fresh. Undefined: no model output; the case stays missing. */
async function ask(id: string, prompt: Prompt, attempt: number) {
  const key = keyOf(prompt, attempt);
  const old = cache.get(key);
  if (old) return old;
  if (replay || (maxFresh !== undefined && fresh + reserved / PER_CALL_USD >= maxFresh)) return undefined;
  await waitForGate();
  if (spent + reserved + PER_CALL_USD > CAP_USD) throw new Error(`Budget cap ${CAP_USD} USD reached`);
  if (old && oldSpent + reserved + PER_CALL_USD > OLD_CAP_USD)
    throw new Error(`Old-set cap ${OLD_CAP_USD} USD reached`);
  reserved += PER_CALL_USD;
  let text = '';
  let structured: unknown;
  let costUsd: number | undefined;
  let modelUsage: unknown = null;
  let failure: string | undefined;
  // A structured answer gets two turns, then six once, as the earlier LangWatch harness did; a text answer gets one.
  for (const turns of prompt.schema === undefined ? [1] : [2, 6]) {
    const ran = await lean(prompt, turns);
    failure = undefined;
    try {
      const parsed = JSON.parse(ran.stdout);
      if (typeof parsed.total_cost_usd === 'number' && parsed.total_cost_usd >= 0)
        costUsd = (costUsd ?? 0) + parsed.total_cost_usd;
      text = typeof parsed.result === 'string' ? parsed.result : '';
      structured = parsed.structured_output;
      modelUsage = parsed.modelUsage ?? parsed.usage;
      if (ran.code !== 0 || parsed.is_error || (!text && structured === undefined))
        failure = JSON.stringify({
          code: ran.code,
          subtype: parsed.subtype,
          stderr: ran.stderr.slice(0, 300),
        });
    } catch {
      failure = JSON.stringify({
        code: ran.code,
        stdout: ran.stdout.slice(0, 300),
        stderr: ran.stderr.slice(0, 300),
      });
    }
    if (!failure) break;
  }
  reserved -= PER_CALL_USD;
  if (failure) {
    // No model output: not cached, retried in a later missing-only pass. Its spend is counted as reported, else reserved.
    const reservedUsd = costUsd ?? PER_CALL_USD;
    spent += reservedUsd;
    appendFileSync(
      `${here}calls/failures.jsonl`,
      `${JSON.stringify({ key, competitor, row, contestant, id, attempt, failure, reservedUsd, timestamp: new Date().toISOString() })}\n`,
    );
    consecutiveFailures++;
    if (consecutiveFailures >= 3 && !gate) {
      gate = (async () => {
        await new Promise((r) => setTimeout(r, 600_000));
        await probeGate('three consecutive failures; paused 10 minutes');
        consecutiveFailures = 0;
        gate = undefined;
      })();
    }
    return undefined;
  }
  consecutiveFailures = 0;
  const call: Call = {
    key,
    competitor,
    row,
    contestant,
    id,
    attempt,
    prompt,
    text,
    ...(structured === undefined ? {} : { structured }),
    costUsd: costUsd ?? PER_CALL_USD,
    modelUsage,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(recording, `${JSON.stringify(call)}\n`);
  cache.set(key, call);
  spent += call.costUsd;
  if (old) oldSpent += call.costUsd;
  fresh++;
  return call;
}

class Missing extends Error {}
/** The shipped claude-cli client, judge for judge, with its process replaced by the recorded lean call. */
function client(id: string): JudgeClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    id: 'claude-cli:haiku',
    family: 'anthropic',
    cls: 'system2',
    model: 'haiku',
    cost: 10,
    calls,
    async judge(request: JudgeRequest): Promise<JudgeResult> {
      const call = await ask(id, buildPrompt(request), calls.length);
      if (!call) throw new Missing(id);
      calls.push(call);
      return { ...parseJudgeText(call.text, request), costUsd: call.costUsd };
    },
  };
}
/** Default: one call and one more after an invalid ledger (packages/judges/src/single.ts). Audit: judgeAnswerAudit. */
async function ours(item: Item, mode: Mode) {
  const request = (old ? oldRequestFor : requestFor)(competitor, row, item, mode);
  const judge = client(item.id);
  let result: JudgeResult;
  if (mode === 'audit') result = await judgeAnswerAudit(judge, request);
  else {
    result = await judge.judge(request);
    if (
      result.unparsed &&
      (result.answer.reasoning.startsWith('invalid criterion ledger:') ||
        result.answer.reasoning.startsWith('answer breaks the assessment contract:'))
    )
      result = await judge.judge({ ...request, budget: 'large' });
  }
  return {
    outcome: result.unparsed ? 'inconclusive' : result.answer.outcome,
    unparsed: !!result.unparsed,
    keys: judge.calls.map((c) => c.key),
    costUsd: judge.calls.reduce((s, c) => s + c.costUsd, 0),
  };
}

if (!replay) await probeGate('start');
for ([row, contestant] of jobs) {
  const items = (
    old
      ? oldItems(competitor, row)
      : (JSON.parse(readFileSync(`${here}sets/${competitor}-${row}.json`, 'utf8')) as Item[])
  ).slice(0, limit);
  const theirs =
    contestant === 'theirs'
      ? (JSON.parse(readFileSync(`${here}prompts/${competitor}-${row}-theirs.json`, 'utf8')) as Record<
          string,
          Prompt
        >)
      : undefined;
  const results: Record<string, unknown>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index] as Item;
      const base = { id: item.id, kind: item.kind, pair: item.pair, truth: item.truth };
      try {
        if (theirs) {
          const call = await ask(item.id, theirs[item.id] as Prompt, 0);
          results[index] = call
            ? { ...base, complete: true, keys: [call.key], costUsd: call.costUsd }
            : { ...base, complete: false };
        } else results[index] = { ...base, complete: true, ...(await ours(item, contestant as Mode)) };
      } catch (error) {
        if (!(error instanceof Missing)) throw error;
        results[index] = { ...base, complete: false };
      }
      if (index % 10 === 9)
        console.log(
          JSON.stringify({
            competitor,
            row,
            contestant,
            done: index + 1,
            fresh,
            spentUsd: +spent.toFixed(4),
          }),
        );
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const complete = results.filter((r) => r.complete).length;
  writeFileSync(
    `${here}results/${old ? 'old-' : ''}${competitor}-${row}-${contestant}.json`,
    `${JSON.stringify({ competitor, row, contestant, model: 'haiku', items: items.length, complete, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({ competitor, row, contestant, items: items.length, complete, fresh, spentUsd: spent }),
  );
}
