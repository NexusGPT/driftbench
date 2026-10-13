// Row 19: factuality against a reference. 100 fictional cases (50 correct, 50 contradicting the reference), each graded
// by haiku on both sides: promptfoo's factuality assertion, and our judged criterion factual_against_reference.
// Run from the repository root: npx tsx comparisons/promptfoo/measure-factuality.mts
// Needs the claude command (CLAUDE_BIN overrides it). Spend is capped at HARD_CAP_USD across all calls.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAnswerText } from '../../packages/judges/src/contract';
import { fixtureRequest, loadCriteria } from '../../packages/judges/src/criteria';
import { buildPrompt } from '../../packages/judges/src/prompt';
// @ts-expect-error the installed package ships compiled JavaScript without declarations
import * as pf from './node_modules/promptfoo/dist/src/index.js';
import { type Row, summarise } from './summary.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const MODEL = 'haiku';
const PER_CALL_USD = '0.02';
const HARD_CAP_USD = 1.5;
const CONCURRENCY = 6;
const CRITERIA = join(HERE, '../../examples/acme/factuality');

let spent = 0;
let calls = 0;

function claude(system: string, user: string): Promise<{ result: string; cost: number; error: boolean }> {
  if (spent >= HARD_CAP_USD) return Promise.reject(new Error(`hard cap ${HARD_CAP_USD} USD reached`));
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    MODEL,
    '--system-prompt',
    system,
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    '1',
    '--max-budget-usd',
    PER_CALL_USD,
  ];
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    // A call that does not finish in two minutes is killed and counts as an error, so one hang cannot stall the run.
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', () => {
      clearTimeout(timer);
      calls += 1;
      try {
        const parsed = JSON.parse(stdout);
        const cost = Number(parsed.total_cost_usd ?? 0);
        spent += cost;
        resolve({ result: String(parsed.result ?? ''), cost, error: Boolean(parsed.is_error) });
      } catch {
        resolve({ result: '', cost: 0, error: true });
      }
    });
    child.stdin.end(user);
  });
}

// Fictional cases: a plan, its reference line, a question, and a reply that either repeats the reference or contradicts it.
const PLANS = [
  { name: 'Mobile S', price: 19, data: 10 },
  { name: 'Mobile M', price: 25, data: 40 },
  { name: 'Mobile L', price: 35, data: 80 },
  { name: 'Fiber 100', price: 45, data: 0 },
];

function cases() {
  const out: Array<{ reference: string; question: string; reply: string; truth: boolean }> = [];
  for (let i = 0; i < 100; i++) {
    const plan = PLANS[i % PLANS.length] as (typeof PLANS)[number];
    const reference = `${plan.name}: ${plan.price} USD a month${plan.data > 0 ? `, ${plan.data} GB of data` : ''}.`;
    const question = `What does ${plan.name} cost?`;
    const correct = i % 2 === 0;
    const wrongPrice = plan.price + 6 + (i % 3);
    const reply = correct
      ? `${plan.name} is ${plan.price} USD a month${plan.data > 0 ? ` with ${plan.data} GB of data` : ''}.`
      : `${plan.name} is ${wrongPrice} USD a month${plan.data > 0 ? ` with ${plan.data} GB of data` : ''}.`;
    out.push({ reference, question, reply, truth: correct });
  }
  return out;
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index] as T);
      }
    }),
  );
  return results;
}

const loaded = await loadCriteria(CRITERIA);
const criterion = loaded.criteria.find(
  (c: { def: { name: string } }) => c.def.name === 'factual_against_reference',
);
if (!criterion) throw new Error('factual_against_reference not found');

const theirsProvider = {
  id: () => 'haiku',
  callApi: async (prompt: string) => {
    const r = await claude('You are a grader.', prompt);
    if (r.error) throw new Error('grader call failed');
    return { output: r.result };
  },
};

const list = cases();
let done = 0;
const rows = await pool(list, CONCURRENCY, async (c) => {
  // The grader is ours (haiku through the claude command). Without a grader in test.options promptfoo probes for a default one.
  const theirs = await withTimeout(
    pf.assertions
      .runAssertion({
        assertion: { type: 'factuality', value: c.reference },
        test: { vars: { input: c.question }, assert: [], options: { provider: theirsProvider } },
        providerResponse: { output: c.reply },
        prompt: c.question,
        vars: { input: c.question },
      })
      .then((r: { pass: boolean }) => r.pass === true),
    180_000,
    'promptfoo factuality',
  ).catch(() => false);
  const req = {
    ...fixtureRequest(criterion, 'pass'),
    transcript: [
      { role: 'user', text: c.question },
      { role: 'agent', text: c.reply },
    ],
    inputs: [{ path: 'reference.txt', text: c.reference }],
  } as Parameters<typeof buildPrompt>[0];
  const prompt = buildPrompt(req);
  const r = await claude(prompt.system, prompt.user);
  const ours = r.error ? false : parseAnswerText(r.result).answer.outcome === 'pass';
  done += 1;
  if (done % 10 === 0)
    console.error(`progress ${done}/${list.length} calls ${calls} spent ${spent.toFixed(4)}`);
  return { truth: c.truth, a: theirs, b: ours } as Row;
});

const summary = summarise('19 factuality against a reference (haiku on both sides)', rows, [
  'theirs',
  'ours',
]);
const out = {
  ...summary,
  calls,
  spentUsd: Number(spent.toFixed(4)),
  hardCapUsd: HARD_CAP_USD,
  model: MODEL,
  cases: list.length,
};
await mkdir(join(HERE, 'out'), { recursive: true });
const dir = await mkdtemp(join(tmpdir(), 'pf-fact-'));
await writeFile(join(HERE, 'out', 'factuality.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out));
void dir;
