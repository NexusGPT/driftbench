/* biome-ignore-all lint/style/noNonNullAssertion: research script; each lookup uses a key the script just built */
// Measures pairwise judging on set.json, both systems on the same protocol: two calls per pair with the candidates'
// positions swapped, a tie when the two calls disagree.
//   ours:   npx tsx comparisons/langwatch/pairwise/measure.mts ours --model haiku --cap 1.0
//   theirs: npx tsx comparisons/langwatch/pairwise/measure.mts theirs --model haiku --cap 1.0
// Research variants ours-audit and ours-audit-checked use recorded calls. See AUDIT.md for run and replay commands.
// "theirs" runs the competitor's golden-aware comparison prompt, copied verbatim, through the same claude command.
// Their answer format (a winner A, B or tie) is read through our answer contract (pass = A, fail = B, inconclusive = tie).
// Records go to recorded/<system>-<model>.json, keyed by case id. Scoring makes no model call.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CriterionText,
  createClaudeCliJudge,
  judgePairwise,
} from '../../../packages/judges/src/index.ts';
import { runAudit } from './audit-runner.mts';

const here = dirname(fileURLToPath(import.meta.url));
const setFile = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : 'set.json';
const setTag = setFile === 'set.json' ? '' : `-${setFile.replace(/\.json$/, '')}`;
const items = JSON.parse(readFileSync(join(here, setFile), 'utf8')) as Array<{
  id: string;
  task: string;
  golden: string;
  candidate_a: string;
  candidate_b: string;
  better: 'A' | 'B';
}>;
const args = process.argv.slice(2);
const system = args[0];
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const model = opt('model', 'haiku')!;
const cap = Number(opt('cap-usd', opt('cap', '1.0')));

// Opt-in research variant. Both legacy systems keep their original prompts and procedure.
if (system === 'ours-audit' || system === 'ours-audit-checked') {
  await runAudit({
    here,
    items,
    model,
    setFile,
    cap,
    concurrency: Number(opt('concurrency', '1')),
    replayOnly: args.includes('--replay-only'),
    checked: system === 'ours-audit-checked',
  });
  process.exit(0);
}

const CRITERION: CriterionText = {
  name: 'matches_golden',
  rubric:
    'The reply gives the same facts as the golden answer: the price, the data allowance and the availability.',
  pass: 'The reply states the same facts as the golden answer.',
  fail: 'The reply states a fact that differs from the golden answer.',
  scope: 'block',
};

// The competitor's golden-aware prompt, verbatim from its evaluator (DEFAULT_PAIRWISE_PROMPT).
const THEIR_TEMPLATE = (input: string, golden: string, a: string, b: string) =>
  `Compare two candidate outputs against a known-good reference (golden answer).

Task:           ${input}
Golden answer:  ${golden}

Candidate A:    ${a}
Candidate B:    ${b}

Reason step-by-step about how closely each candidate matches the
golden answer in correctness, completeness, and style. Then pick
the better candidate, or "tie" if equivalent.
Prefer cheaper/faster only when quality is comparable.
`;
const CONTRACT = [
  'Answer with one JSON object and nothing else, with exactly these keys:',
  '{"outcome": "pass" or "fail" or "inconclusive", "reasoning": "two sentences at most"}',
  'Use "pass" when Candidate A is the better one, "fail" when Candidate B is the better one, and "inconclusive" for a tie.',
].join('\n');

let spent = 0;
function claudeCall(prompt: string): Promise<{ outcome: string; cost: number }> {
  const folder = mkdtempSync(join(tmpdir(), 'driftbench-pw-'));
  const argv = [
    '-p',
    '--output-format',
    'json',
    '--model',
    model,
    '--system-prompt',
    CONTRACT,
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    '1',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('claude', argv, { cwd: folder });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`));
      let payload: { is_error?: boolean; result?: unknown; total_cost_usd?: number };
      try {
        payload = JSON.parse(out);
      } catch {
        return reject(new Error(`claude printed no JSON: ${out.slice(0, 120)}`));
      }
      if (payload.is_error) return reject(new Error(`claude error: ${String(payload.result).slice(0, 200)}`));
      const text = String(payload.result ?? '');
      // An answer that is not one JSON object with an outcome is inconclusive, never a winner.
      let outcome = 'inconclusive';
      try {
        const match = text.match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) : undefined;
        if (parsed && typeof parsed.outcome === 'string') outcome = parsed.outcome;
      } catch {
        outcome = 'inconclusive';
      }
      resolve({ outcome, cost: Number(payload.total_cost_usd ?? 0) });
    });
    child.stdin.end(prompt);
  });
}

let unanswered = 0;
const answers: Array<{
  id: string;
  choice: string;
  ordered: string;
  swapped: string;
  consistent: boolean;
  costUsd: number;
}> = [];
const base = createClaudeCliJudge({ model, id: `claude-${model}` });
// Every call through the client adds its cost to the run's spend, so the cap holds for ours too.
const client = {
  ...base,
  async judge(request: Parameters<typeof base.judge>[0]) {
    const result = await base.judge(request);
    spent += result.costUsd ?? 0;
    return result;
  },
};
for (const item of items) {
  if (spent >= cap) throw new Error(`spend cap ${cap} USD reached after ${answers.length} cases`);
  if (system === 'ours') {
    const before = spent;
    const verdict = await judgePairwise(
      client,
      CRITERION,
      [{ role: 'user', text: item.task }],
      item.candidate_a,
      item.candidate_b,
      { reference: item.golden },
    );
    answers.push({
      id: item.id,
      choice: verdict.choice,
      ordered: verdict.ordered,
      swapped: verdict.swapped,
      consistent: verdict.consistent,
      costUsd: spent - before,
    });
  } else if (system === 'theirs') {
    // One retry per call; a call that still gives no answer is an inconclusive answer, counted and reported.
    const ask = async (prompt: string) => {
      try {
        return await claudeCall(prompt);
      } catch {
        try {
          return await claudeCall(prompt);
        } catch {
          unanswered += 1;
          return { outcome: 'inconclusive', cost: 0 };
        }
      }
    };
    const first = await ask(THEIR_TEMPLATE(item.task, item.golden, item.candidate_a, item.candidate_b));
    const second = await ask(THEIR_TEMPLATE(item.task, item.golden, item.candidate_b, item.candidate_a));
    spent += first.cost + second.cost;
    // Map each call's winner back to the original candidates: pass names A (the first candidate) in the first call and B in the second.
    const pickFirst = first.outcome === 'pass' ? 'first' : first.outcome === 'fail' ? 'second' : 'tie';
    const pickSwapped = second.outcome === 'pass' ? 'second' : second.outcome === 'fail' ? 'first' : 'tie';
    const consistent = pickFirst === pickSwapped;
    answers.push({
      id: item.id,
      choice: consistent ? pickFirst : 'tie',
      ordered: first.outcome,
      swapped: second.outcome,
      consistent,
      costUsd: first.cost + second.cost,
    });
  } else {
    throw new Error(
      'usage: measure.mts ours|theirs|ours-audit|ours-audit-checked --model <name> --cap-usd <usd>',
    );
  }
}
writeFileSync(
  join(here, 'recorded', `${system}-${model}${setTag}.json`),
  `${JSON.stringify({ system, model, set: setFile, spentUsd: spent, unanswered, answers }, null, 1)}\n`,
);
console.log(
  `${system} ${model}: ${answers.length} cases, ${unanswered} calls without an answer, spent ${spent.toFixed(4)} USD`,
);
