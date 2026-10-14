#!/usr/bin/env node
// Run driftbench's default pair judge or promptfoo select-best on one split of the
// "JudgeBench recipe, fresh pool", missing items only. Peers run through
// examples/all-peers-public with run_peers.py; this file covers the two
// contestants that are not Python graders.
//
//   node --import tsx examples/judgebench-fresh/judge.mjs --split dev --contestant driftbench [--execute]
//
// Every model call goes through the claude command on claude-haiku-5-5 with the
// flags of the ledger cells. An answered request is journaled and replays free.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPrompt, createDialectTransport, judgePairLedger, pairLedgerRequest, pairLedgerSchema,
  parsePairLedgerText, scoreLedger,
} from '../../packages/judges/src/index.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MODEL = 'claude-haiku-5-5';
// The JudgeBench ledger cell's criterion and requirements (examples/ledger-jb/src/harness.mjs on research/ledger-jb).
export const CRITERION = 'The response gives the correct answer to the question. Only objective correctness counts: a correct answer beats a fluent wrong one.';
export const REQUIREMENTS = [
  { name: 'final_correct', description: 'The final answer is objectively correct for the question.', hard: true, weight: 2 },
  { name: 'format_followed', description: 'The reply follows the explicit answer format requested in the question.', hard: false, weight: 1 },
  { name: 'derivation_sound', description: 'The derivation is valid and supports the final answer.', hard: false, weight: 1 },
];
// promptfoo select-best at upstream 8014282, as the recorded promptfoo cell rendered it.
const PROMPTFOO_TEMPLATE = readFileSync(join(ROOT, 'promptfoo-select-best.txt'), 'utf8');
const SETTINGS = { timeoutMs: 300000, maxTokens: 8192, maxBudgetUsd: 0.1, provider: 'claude-cli', dialect: 'scratchpad-json' };

const hash = value => createHash('sha256').update(value).digest('hex');
const readJsonl = path => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

export function itemsFor(split) {
  return readJsonl(join(ROOT, 'pool', `${split}.jsonl`)).map(row => ({
    id: row.pair_id, question: row.question, a: row.response_A, b: row.response_B,
    label: row.label === 'A>B' ? 'A' : 'B', source: row.source,
  }));
}

export function promptfooPrompt(item, order) {
  const a = order === 'AB' ? item.a : item.b, b = order === 'AB' ? item.b : item.a;
  // Callback replacement keeps literal dollar sequences in benchmark text.
  return { system: PROMPTFOO_TEMPLATE.replace('{{criteria}}', () => `${CRITERION} The question: ${item.question}`)
    .replace('{{a}}', () => a).replace('{{b}}', () => b), user: 'Output the index now.' };
}

export function parsePromptfoo(text, order) {
  const index = text.trim().match(/-?\d+/)?.[0];
  if (index !== '0' && index !== '1') return null;
  return (index === '0') === (order === 'AB') ? 'A' : 'B';
}

// examples/ledger-jb/src/core-adapter.mjs judgePair, for the claude command transport.
export async function ledgerPair(item, call, options = {}) {
  let nonRetry = 0, previousOrder, previousResponse;
  const client = { id: `ledger-${MODEL}`, cls: 'system2', family: 'anthropic', model: MODEL, cost: 10, dialect: SETTINGS.dialect,
    async judge(request) {
      const attempt = request.budget === 'large' ? 1 : 0;
      if (attempt && previousResponse?.transportFailure) return { ...parsePairLedgerText(previousResponse.text, request), costUsd: 0 };
      const order = attempt ? previousOrder : ['AB', 'BA', 'canonical'][nonRetry++] ?? `extra${nonRetry}`;
      previousOrder = order;
      const response = await call(buildPrompt(request), { order, attempt, schema: pairLedgerSchema(request) });
      previousResponse = response;
      return { ...parsePairLedgerText(response.text, request), costUsd: response.costUsd };
    },
  };
  const request = pairLedgerRequest({ name: 'objective_correctness', rubric: CRITERION, scope: 'block' },
    [{ role: 'user', text: item.question }], item.a, item.b,
    { requirements: REQUIREMENTS.map(({ description, ...r }) => ({ ...r, rubric: description })) });
  const result = await judgePairLedger(client, request, { stage0: { correctness: true }, tiePolicy: 'canonical', ...options });
  const decision = result.choice === 'first' ? 'A' : result.choice === 'second' ? 'B' : result.status === 'tie' ? 'tie' : null;
  const rawGames = result.reads.filter(x => x.order !== 'canonical').map(read => {
    if (!read.result.pairLedger) return null;
    const sign = scoreLedger(read.result.pairLedger, request.assessment.items).sign * (read.order === 'swapped' ? -1 : 1);
    return sign > 0 ? 'A' : sign < 0 ? 'B' : 'tie';
  });
  return { games: [decision, decision], decision, rawGames, status: result.status, calls: result.reads.length,
    graderErrors: result.reads.filter(x => x.result.unparsed).length };
}

export const CONTESTANTS = {
  async driftbench(item, call) { return ledgerPair(item, call); },
  async promptfoo(item, call) {
    const games = []; let graderErrors = 0;
    for (const order of ['AB', 'BA']) {
      const response = await call(promptfooPrompt(item, order), { order });
      const game = parsePromptfoo(response.text, order);
      graderErrors += Number(game === null); games.push(game);
    }
    return { games, graderErrors };
  },
};

function transport() {
  const env = { ...process.env };
  for (const key of ['CLAUDE_JUDGE_MODEL', 'ANTHROPIC_JUDGE_MODEL', 'ANTHROPIC_BASE_URL', 'CLAUDECODE', 'ANTHROPIC_API_KEY']) delete env[key];
  return createDialectTransport({ provider: 'claude-cli', model: MODEL, env, maxRetries: 0, timeoutMs: SETTINGS.timeoutMs,
    maxTokens: SETTINGS.maxTokens, maxBudgetUsd: SETTINGS.maxBudgetUsd });
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
  const split = flag('--split'), contestant = flag('--contestant');
  const capUsd = Number(flag('--cap-usd', '5')), workers = Number(flag('--workers', '4'));
  if (!['dev', 'confirm'].includes(split) || !CONTESTANTS[contestant]) throw new Error('--split dev|confirm --contestant driftbench|promptfoo');
  const items = itemsFor(split);
  const cell = join(ROOT, 'cells', split, contestant);
  mkdirSync(cell, { recursive: true });
  const decisionsPath = join(cell, 'decisions.jsonl'), callsPath = join(ROOT, 'cells', 'calls.jsonl');
  const done = new Set(readJsonl(decisionsPath).map(row => row.id));
  const queue = items.filter(item => !done.has(item.id));
  console.log(JSON.stringify({ split, contestant, items: items.length, missing: queue.length, execute: argv.includes('--execute') }));
  if (!argv.includes('--execute')) return;
  const answered = new Map(readJsonl(callsPath).filter(row => row.text !== undefined && !row.transportFailure).map(row => [row.key, row]));
  let spent = readJsonl(callsPath).reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  const client = transport();
  const call = async (prompt, { schema } = {}) => {
    const key = hash(JSON.stringify([MODEL, prompt.system, prompt.user, schema ?? null]));
    if (answered.has(key)) return answered.get(key);
    if (spent + SETTINGS.maxBudgetUsd > capUsd) throw new Error(`BUDGET_STOP at ${spent.toFixed(4)} USD`);
    let row;
    try {
      const response = await client.complete({ ...prompt, ...(schema ? { schema } : {}) });
      row = { key, text: response.text, costUsd: response.costUsd ?? SETTINGS.maxBudgetUsd, costEstimated: response.costUsd === undefined,
        truncated: Boolean(response.truncated), refusal: response.refusal ?? null };
    } catch (error) {
      row = { key, transportFailure: true, error: String(error?.message ?? error).slice(0, 300), costUsd: SETTINGS.maxBudgetUsd, costEstimated: true };
    }
    spent += row.costUsd;
    appendFileSync(callsPath, `${JSON.stringify({ ...row, split, contestant, at: new Date().toISOString() })}\n`);
    // No model output is never a verdict: the item stays missing and a later pass asks again.
    if (row.transportFailure) throw Object.assign(new Error(row.error), { transport: true });
    answered.set(key, row);
    return row;
  };
  let next = 0, completed = 0, stopped;
  async function worker() {
    while (!stopped && next < queue.length) {
      const item = queue[next++];
      try {
        const result = await CONTESTANTS[contestant](item, call);
        appendFileSync(decisionsPath, `${JSON.stringify({ id: item.id, source: item.source, label: item.label, contestant, ...result, at: new Date().toISOString() })}\n`);
        completed++;
        if (completed % 10 === 0) console.log(JSON.stringify({ completed, of: queue.length, spentUsd: Number(spent.toFixed(4)) }));
      } catch (error) {
        if (error?.transport) console.log(JSON.stringify({ missing: item.id, error: error.message.slice(0, 160) }));
        else stopped ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  console.log(JSON.stringify({ completed, spentUsd: Number(spent.toFixed(4)), stopped: stopped ? String(stopped.message ?? stopped) : null }));
  if (stopped) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
