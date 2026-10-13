import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { makeRecordingClient, SpendBudget } from '../../benchmarks/record';
import { comparePaired } from '../../benchmarks/run';
import { buildPrompt, PROMPT_FINGERPRINT, requestKey } from '../../packages/judges/src/index';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const root = '.experiment';
const phase = process.argv[2];
if (!['tuning', 'validation', 'gate'].includes(phase)) throw Error('phase required');
const split = read(`${root}/split.json`);
const output = `${root}/v2`;
mkdirSync(output, { recursive: true });
const fingerprintFile = `${output}/fingerprint.txt`;
if (existsSync(fingerprintFile) && readFileSync(fingerprintFile, 'utf8') !== PROMPT_FINGERPRINT)
  throw Error('Frozen fingerprint changed');
writeFileSync(fingerprintFile, PROMPT_FINGERPRINT);
const scope = new AsyncLocalStorage<any>();
const ledger = `${root}/spend.jsonl`;
const history = existsSync(ledger)
  ? readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  : [];
const budget = new SpendBudget(6);
budget.spent = history.reduce((n, r) => n + r.chargedUsd, 0);
const append = (p: string, v: unknown) => appendFileSync(p, `${JSON.stringify(v)}\n`);
const calls = `${output}/calls.jsonl`,
  outcomes = `${output}/outcomes.jsonl`;
const oldRows = existsSync(outcomes)
  ? readFileSync(outcomes, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  : [];
const done = new Map(oldRows.map((r) => [`${r.model}:${r.id}`, r]));
const previousCalls = existsSync(calls)
  ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  : [];
const answers = new Map(
  previousCalls.filter((r) => r.event === 'answer').map((r) => [`${r.model}:${r.key}`, r.result]),
);
const attempts = new Map<string, number>();
for (const c of previousCalls.filter((r) => r.event === 'submission'))
  attempts.set(`${c.model}:${c.key}`, (attempts.get(`${c.model}:${c.key}`) ?? 0) + 1);
const key = readFileSync(`${homedir()}/.nexus-secrets/openai.key`, 'utf8').trim();
const scrub = (s: string) => s.split(key).join('[redacted]');
const env = { ...process.env, OPENAI_API_KEY: key, ANTHROPIC_API_KEY: undefined, CLAUDECODE: undefined };
const baseFetch: typeof fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body));
  delete body.temperature;
  if (body.model !== 'gpt-6-luna' || body.reasoning_effort !== 'medium')
    throw Error('Unexpected model settings');
  append(calls, { event: 'http-request', ...scope.getStore(), body });
  const response = await fetch(url, { ...init, body: JSON.stringify(body) });
  const text = await response.clone().text();
  append(calls, { event: 'http-response', ...scope.getStore(), status: response.status, body: scrub(text) });
  return response;
};
const pending = new Map<string, Promise<any>>();
const clients = new Map();
function client(model: string) {
  if (!clients.has(model)) {
    const c = makeRecordingClient(
      model,
      budget,
      env,
      (row) => append(ledger, { ...scope.getStore(), ...row }),
      { fetch: baseFetch },
    );
    if (model === 'gpt-6-luna') {
      const settings = JSON.parse(c.settings!);
      delete settings.temperature;
      delete settings.temperatureRetry;
      c.settings = JSON.stringify({ ...settings, temperature: 'omitted' });
    }
    clients.set(model, c);
  }
  return clients.get(model);
}
async function answer(model: string, row: any, set: string) {
  const c = client(model);
  const key = requestKey(row.request, c);
  const cacheKey = `${model}:${key}`;
  if (answers.has(cacheKey)) return { result: answers.get(cacheKey), key, reused: true };
  if (pending.has(cacheKey)) return { result: await pending.get(cacheKey), key, reused: true };
  const promise = (async () => {
    for (;;) {
      const attempt = (attempts.get(cacheKey) ?? 0) + 1;
      if (attempt > 3) throw Error(`Three submissions exhausted: ${row.id}`);
      attempts.set(cacheKey, attempt);
      const meta = {
        at: new Date().toISOString(),
        phase,
        model,
        set,
        id: row.id,
        key,
        attempt,
        fingerprint: PROMPT_FINGERPRINT,
      };
      try {
        const result = await scope.run(meta, async () => {
          append(calls, { event: 'submission', ...meta, prompt: buildPrompt(row.request) });
          return await c.judge(row.request);
        });
        append(calls, { event: 'answer', ...meta, result });
        answers.set(cacheKey, result);
        return result;
      } catch (error) {
        const e = error as any;
        append(calls, {
          event: 'no-answer',
          ...meta,
          error: scrub(String(e)),
          retryable: e.retryable ?? false,
        });
        if (!e.retryable || attempt === 3) throw error;
        await new Promise((r) => setTimeout(r, Math.max(2000 * attempt, e.retryAfterMs ?? 0)));
      }
    }
  })();
  pending.set(cacheKey, promise);
  return { result: await promise, key, reused: false };
}
const manifest = read('benchmarks/manifest.json');
async function run(model: string, names: string[], concurrency: number) {
  const jobs = names
    .flatMap((set) =>
      read(`benchmarks/slices/${set}/1/cases.spec.json`).metadata.bench.map((row) => ({ set, row })),
    )
    .filter(({ row }) => phase === 'gate' || split[phase].includes(row.id));
  let index = 0,
    complete = 0;
  let failure: any;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (!failure) {
        const job = jobs[index++];
        if (!job) break;
        const { set, row } = job;
        if (done.has(`${model}:${row.id}`)) {
          complete++;
          continue;
        }
        try {
          const a = await answer(model, row, set);
          const outcome = a.result.unparsed ? 'inconclusive' : a.result.answer.outcome;
          const record = {
            model,
            set,
            id: row.id,
            family: row.family,
            expected: row.expected,
            outcome,
            correct: outcome === row.expected,
            key: a.key,
            reused: a.reused,
            phase,
          };
          append(outcomes, record);
          done.set(`${model}:${row.id}`, record);
          complete++;
          if (complete % 24 === 0)
            console.log(
              JSON.stringify({ model, phase, complete, total: jobs.length, charged: budget.spent }),
            );
        } catch (e) {
          failure = e;
        }
      }
    }),
  );
  if (failure) throw failure;
  console.log(JSON.stringify({ model, phase, complete, total: jobs.length, charged: budget.spent }));
}
if (phase === 'gate') {
  const other = manifest.slices.map((s) => s.name).filter((s) => s !== 'fresh-reference');
  await Promise.all([
    run('gpt-6-luna', other, 8),
    run('haiku', ['fresh-reference', 'heldout-factuality', 'hard-factuality'], 2),
  ]);
} else await run('gpt-6-luna', ['fresh-reference'], 8);
const tables = [];
for (const model of ['gpt-6-luna', 'haiku'])
  for (const set of manifest.slices.map((s) => s.name)) {
    const results = [...done.values()].filter((r) => r.model === model && r.set === set);
    const baseline = read(`benchmarks/evidence/${set}@1/${model}.json`).report;
    if (results.length === baseline.n)
      tables.push({
        model,
        set,
        n: baseline.n,
        before: baseline.correct,
        after: results.filter((r) => r.correct).length,
        paired: comparePaired(baseline.results, results),
      });
  }
for (const half of ['tuning', 'validation']) {
  const ids = new Set(split[half]);
  const baseline = read('benchmarks/evidence/fresh-reference@1/gpt-6-luna.json').report.results.filter((r) =>
    ids.has(r.id),
  );
  const now = [...done.values()].filter(
    (r) => r.model === 'gpt-6-luna' && r.set === 'fresh-reference' && ids.has(r.id),
  );
  tables.push({
    model: 'gpt-6-luna',
    set: half,
    n: baseline.length,
    measured: now.length,
    before: baseline.filter((r) => r.correct).length,
    after: now.filter((r) => r.correct).length,
  });
}
writeFileSync(
  `${output}/summary.json`,
  JSON.stringify(
    {
      fingerprint: PROMPT_FINGERPRINT,
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      charged: budget.spent,
      tables,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    tables.map(({ paired, ...t }) => ({ ...t, regression: paired?.regression })),
    null,
    2,
  ),
);
