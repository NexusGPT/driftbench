import './archive-env';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adaptiveLedger } from './audit-adaptive';
import type { Case, Row } from './generate.mts';
import { rows } from './generate.mts';
import { canCall, panel, parseOutcome, promptFor, requestSha256, type Variant, wilson } from './harness';
import { recordingLines } from './recordings';

const root = fileURLToPath(new URL('./', import.meta.url));
const recording = `${root}calls.jsonl`;
const runtime = `${root}.cache/runtime`;
mkdirSync(runtime, { recursive: true });
// Serialize whole runners across controllers; each runner permits two calls.
// Acquire before reading reservations so another process cannot overwrite them.
const runnerLock = `${root}.cache/runner.lock`;
const startupPause = `${root}.cache/pause-${process.argv[2] === 'all' ? 'qa' : process.argv[2]}-${process.argv[3]}`;
for (;;) {
  if (existsSync(startupPause)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    continue;
  }
  try {
    const descriptor = openSync(runnerLock, 'wx');
    writeFileSync(descriptor, String(process.pid));
    closeSync(descriptor);
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let owner: number;
    try {
      owner = Number(readFileSync(runnerLock, 'utf8'));
    } catch (readError) {
      if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw readError;
    }
    if (owner > 0) {
      try {
        process.kill(owner, 0);
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe;
        throw new Error(`Stale runner lock for PID ${owner}; verify receipts before removing it`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
process.on('exit', () => {
  if (existsSync(runnerLock) && readFileSync(runnerLock, 'utf8') === String(process.pid))
    unlinkSync(runnerLock);
});
const cap = Number(process.env.CAP_USD ?? '8');
const perCall = 0.02;
const concurrency = 2;
const pendingPath = `${root}.cache/pending.json`;
const pending: Record<string, { reserveUsd: number; timestamp: string }> = existsSync(pendingPath)
  ? JSON.parse(readFileSync(pendingPath, 'utf8'))
  : {};
const savePending = () => writeFileSync(pendingPath, `${JSON.stringify(pending, null, 2)}\n`);
// 06:30 Europe/Brussels after this assignment's evening start.
const deadline = Date.parse(process.env.DEADLINE ?? '2026-10-13T06:30:00+02:00');
if (!Number.isFinite(deadline)) throw new Error('Invalid deadline');
const selected = process.argv[2] === 'all' ? rows : [process.argv[2] as Row];
const variant = process.argv[3] as Variant;
const replay = process.argv.includes('--replay');
const deciding = process.argv.includes('--deciding');
const normalized = process.argv.includes('--normalized');
const scoped = process.argv.includes('--scoped');
const compact = process.argv.includes('--compact');
if ([deciding, normalized, scoped, compact].filter(Boolean).length > 1)
  throw new Error('Select one comparison procedure');
const outputRoot = deciding
  ? `${root}deciding/`
  : compact
    ? `${root}compact/`
    : scoped
      ? `${root}scoped/`
      : normalized
        ? `${root}normalized/`
        : root;
mkdirSync(outputRoot, { recursive: true });
const set = deciding ? 'deciding' : process.argv.includes('--heldout') ? 'heldout' : 'hard';
const suffix = set === 'heldout' ? '-heldout' : '';
if (!selected.every((r) => rows.includes(r)) || !['ours', 'theirs', 'audit', 'arch'].includes(variant))
  throw new Error('Usage: run.mts qa|fact|panel|borderline|all ours|theirs|audit [--replay]');
if (normalized && (variant === 'arch' || selected.some((r) => r !== 'panel' && r !== 'borderline')))
  throw new Error('Quote-decoding comparison supports panel or borderline, with ours, theirs or audit');
if (scoped && variant === 'arch') throw new Error('Scope comparison supports ours, theirs or audit');
if (compact && (variant === 'arch' || selected.some((row) => row !== 'qa' && row !== 'fact')))
  throw new Error('Compact factual comparison supports qa or fact, with ours, theirs or audit');
type Call = {
  request_sha256: string;
  row: Row;
  variant: Variant;
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
if (set === 'heldout' || deciding) {
  const frozen = JSON.parse(
    readFileSync(
      `${deciding || normalized || scoped || compact ? outputRoot : root}${deciding || normalized || scoped || compact ? 'freeze.json' : 'heldout-freeze.json'}`,
      'utf8',
    ),
  );
  for (const [name, hash] of Object.entries(frozen.sha256)) {
    if (
      createHash('sha256')
        .update(readFileSync(`${root}${name}`))
        .digest('hex') !== hash
    )
      throw new Error(`Frozen candidate or held-out input changed: ${name}`);
  }
}
const arch =
  variant === 'arch' ? (deciding ? await import('./arch-deciding') : await import('./arch')) : undefined;
const main = variant === 'ours' ? await import('./main-deciding') : undefined;
const normalizedAudit = normalized && variant === 'audit' ? await import('./audit-normalized') : undefined;
const scopedAudit = scoped && variant === 'audit' ? await import('./audit-scoped') : undefined;
const compactAudit = compact && variant === 'audit' ? await import('./audit-compact') : undefined;
const saved: Call[] = recordingLines(new URL('./', import.meta.url)).map((s) => {
  const record = JSON.parse(s);
  const digest = record.request_sha256 ?? record.key;
  delete record.key;
  return { ...record, request_sha256: digest };
});
const cache = new Map(saved.map((c) => [c.request_sha256, c]));
for (const recorded of saved) delete pending[recorded.request_sha256];
savePending();
const interruptions = existsSync(`${root}interrupted.jsonl`)
  ? readFileSync(`${root}interrupted.jsonl`, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { reserveUsd: number })
  : [];
let spent =
  saved.reduce((s, c) => s + c.reservedUsd, 0) +
  interruptions.reduce((s, c) => s + c.reserveUsd, 0) +
  Object.values(pending).reduce((s, p) => s + p.reserveUsd, 0);
let fresh = 0,
  freshCost = 0;
async function call(c: Case, row: Row, repeat: number): Promise<Call | undefined> {
  const prompt = arch
    ? arch.archPrompt(c)
    : main
      ? main.mainPrompt(c)
      : compactAudit
        ? compactAudit.compactPrompt(c)
        : scopedAudit
          ? scopedAudit.scopedPrompt(c)
          : promptFor(c, row, variant);
  const request_sha256 = requestSha256(prompt, repeat);
  const old = cache.get(request_sha256);
  if (old) return old;
  while (existsSync(`${root}.cache/pause-model-calls`) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 500));
  if (replay || Date.now() >= deadline || !canCall(spent, perCall, cap)) return undefined;
  if (pending[request_sha256])
    throw new Error(`Unresolved prior call reservation ${request_sha256}; inspect it before retrying`);
  pending[request_sha256] = { reserveUsd: perCall, timestamp: new Date().toISOString() };
  savePending();
  spent += perCall;
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
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
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
  let text = '',
    costUsd = 0,
    error: string | null = null,
    modelUsage: unknown = null,
    knownCost = false;
  try {
    const parsed = JSON.parse(ran.stdout);
    knownCost =
      typeof parsed.total_cost_usd === 'number' &&
      Number.isFinite(parsed.total_cost_usd) &&
      parsed.total_cost_usd >= 0;
    costUsd = knownCost ? parsed.total_cost_usd : 0;
    text = String(parsed.result ?? '');
    modelUsage = parsed.modelUsage ?? parsed.usage;
    if (ran.code !== 0 || parsed.is_error || !text)
      error = JSON.stringify({
        code: ran.code,
        result: parsed.result,
        errors: parsed.errors,
        stderr: ran.stderr,
      });
  } catch {
    error = JSON.stringify({ code: ran.code, stdout: ran.stdout, stderr: ran.stderr });
  }
  const reservedUsd = knownCost ? costUsd : perCall;
  const answer: Call = {
    request_sha256,
    row,
    variant,
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
  appendFileSync(recording, `${JSON.stringify(answer)}\n`);
  delete pending[request_sha256];
  savePending();
  cache.set(request_sha256, answer);
  spent += reservedUsd - perCall;
  fresh++;
  freshCost += reservedUsd;
  if (error) throw new Error(`Call recorded with error; inspect ${request_sha256}: ${error}`);
  return answer;
}
for (const row of selected) {
  const inputRoot = (normalized || scoped || compact) && set === 'hard' ? root : outputRoot;
  const body = readFileSync(`${inputRoot}${row}${suffix}.json`, 'utf8');
  const cases = JSON.parse(body) as Case[];
  const repeats = compactAudit || row === 'panel' || row === 'borderline' ? 3 : 1;
  const results = [];
  for (let start = 0; start < cases.length; start += concurrency) {
    const batch = await Promise.allSettled(
      cases.slice(start, start + concurrency).map(async (c) => {
        const calls = [];
        for (let rep = 0; rep < repeats; rep++) {
          const answer = await call(c, row, rep);
          if (answer) calls.push(answer);
          if (
            compactAudit &&
            (!answer ||
              (!answer.error && compactAudit.parseCompactAudit(answer.text, c.submission) !== 'inconclusive'))
          )
            break;
        }
        const votes = calls.map((a) =>
          a.error
            ? ('inconclusive' as const)
            : arch
              ? arch.parseArch(a.text, c)
              : main
                ? main.parseMain(a.text)
                : compactAudit
                  ? compactAudit.parseCompactAudit(a.text, c.submission)
                  : normalizedAudit
                    ? normalizedAudit.parseNormalizedAudit(a.text, c.submission)
                    : scopedAudit
                      ? scopedAudit.parseScopedAudit(a.text, c.submission)
                      : parseOutcome(a.text, variant, c.submission),
        );
        const adaptive = compactAudit ? adaptiveLedger(votes, 3) : undefined;
        const outcome = adaptive
          ? adaptive.outcome
          : calls.length !== repeats
            ? 'inconclusive'
            : repeats === 1
              ? (votes[0] ?? 'inconclusive')
              : panel(votes);
        return {
          id: c.id,
          family: c.family,
          label: c.label,
          outcome,
          complete: adaptive ? adaptive.complete : calls.length === repeats,
          request_sha256: calls.map((a) => a.request_sha256),
          votes,
          costUsd: calls.reduce((s, a) => s + a.costUsd, 0),
        };
      }),
    );
    const failed = batch.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    for (const result of batch) if (result.status === 'fulfilled') results.push(result.value);
    if (results.length % 10 === 0)
      console.log(
        JSON.stringify({
          row,
          variant,
          items: results.length,
          right: results.filter((r) => r.outcome === r.label).length,
          fresh,
          spentUsd: spent,
        }),
      );
  }
  const right = results.filter((r) => r.outcome === r.label).length;
  const summary = {
    row,
    set,
    variant,
    ...(compact
      ? {
          procedureLabel:
            variant === 'audit'
              ? 'Compact ledger with bounded retry: not yet the shipped default'
              : variant === 'ours'
                ? 'Shipped baseline (pinned main source)'
                : 'Inspect default',
        }
      : {}),
    ...(scoped
      ? {
          procedureLabel:
            variant === 'audit'
              ? 'Candidate with explicit scope rules: not yet the shipped default'
              : variant === 'ours'
                ? 'Shipped baseline (pinned main source)'
                : 'Inspect default',
        }
      : {}),
    ...(normalized
      ? {
          procedureLabel:
            variant === 'audit'
              ? 'Quote-decoding candidate: not yet the shipped default'
              : variant === 'ours'
                ? 'Shipped baseline (pinned main source)'
                : 'Inspect default',
        }
      : {}),
    model: 'haiku',
    ...(arch
      ? { sourceCommit: arch.ARCH_COMMIT, procedureLabel: 'PR 115 default (under review)' }
      : deciding && variant === 'ours'
        ? { sourceCommit: '40aab09551e1b8702d576d3f28b63b12848cf572', procedureLabel: "Main's shipped judge" }
        : {}),
    date: new Date().toISOString(),
    setSha256: createHash('sha256').update(body).digest('hex'),
    items: cases.length,
    complete: results.filter((r) => r.complete).length,
    right,
    wrong: results.filter((r) => r.outcome !== 'inconclusive' && r.outcome !== r.label).length,
    inconclusive: results.filter((r) => r.complete && r.outcome === 'inconclusive').length,
    unrun: results.filter((r) => r.request_sha256.length === 0).length,
    partial: results.filter((r) => !r.complete && r.request_sha256.length > 0).length,
    coverage: results.filter((r) => r.complete).length / cases.length,
    accuracy: right / (results.filter((r) => r.complete).length || 1),
    ci95: wilson(right, results.filter((r) => r.complete).length),
    costUsd: results.reduce((s, r) => s + r.costUsd, 0),
    freshCalls: fresh,
    freshReservedUsd: freshCost,
    taskReservedUsd: spent,
    results,
  };
  writeFileSync(`${outputRoot}${row}${suffix}-${variant}.json`, `${JSON.stringify(summary, null, 2)}\n`);
  const ledger = process.env.SPEND_LEDGER;
  if (ledger)
    appendFileSync(
      ledger,
      `| ${new Date().toISOString()} | hard-inspect ${set} row ${row}, ${variant}, ${deciding ? 'deciding' : compact ? 'compact ledger with bounded retry' : scoped ? 'explicit scope' : normalized ? 'decoded quotes' : 'original'}, ${replay ? 'replay' : 'run with at most 2 concurrent calls'}, ${summary.complete}/${cases.length} cases | haiku | ${fresh} fresh | task cap ${cap} | ${freshCost.toFixed(8)} | task reserved ${spent.toFixed(8)} of 8 USD |\n`,
    );
  console.log(JSON.stringify({ ...summary, results: undefined }));
  fresh = 0;
  freshCost = 0;
}
