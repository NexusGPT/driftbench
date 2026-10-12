// A model judge reads each reply alone (no end state), the way an output-only rubric grades a block, and records its answer.
// Usage: npx tsx comparisons/promptfoo/goal-success/judge.mts <haiku|sonnet> [out.json]
// Calls the claude command (CLAUDE_BIN, default claude). Each call is capped at 0.02 USD.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const model = process.argv[2];
if (model !== 'haiku' && model !== 'sonnet') throw new Error('model must be haiku or sonnet');
const out = process.argv[3] ?? fileURLToPath(new URL(`./recorded-${model}.json`, import.meta.url));
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const { goal, cases } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./cases.json', import.meta.url)), 'utf8'),
) as {
  goal: string;
  cases: Array<{ id: string; reply: string; truth: 'pass' | 'fail' }>;
};

const SYSTEM =
  'You grade whether an AI assistant completed a goal. You see the goal and the assistant reply only. Answer with one word: PASS or FAIL.';

function run(args: string[], stdin: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd: '/tmp', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', () => resolve(stdout));
    child.stdin.end(stdin);
  });
}

async function grade(item: (typeof cases)[number]) {
  const user = `Goal: ${goal}\nReply: ${item.reply}\nDid the reply show that the goal is complete?`;
  const stdout = await run(
    [
      '-p',
      '--output-format',
      'json',
      '--model',
      model,
      '--system-prompt',
      SYSTEM,
      '--tools',
      '',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-turns',
      '1',
      '--max-budget-usd',
      '0.02',
    ],
    user,
  );
  let text = '';
  let cost = 0;
  let isError = true;
  try {
    const parsed = JSON.parse(stdout);
    text = String(parsed.result ?? '');
    cost = Number(parsed.total_cost_usd ?? 0);
    isError = Boolean(parsed.is_error);
  } catch {
    isError = true;
  }
  const word = /\b(PASS|FAIL)\b/i.exec(text)?.[1]?.toLowerCase();
  const outcome = isError || word === undefined ? 'inconclusive' : word;
  return { id: item.id, truth: item.truth, outcome, cost, text: text.slice(0, 200) };
}

const rows: Awaited<ReturnType<typeof grade>>[] = [];
const queue = [...cases];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) rows.push(await grade(item));
    }
  }),
);
rows.sort((a, b) => a.id.localeCompare(b.id));
const costUsd = rows.reduce((sum, r) => sum + r.cost, 0);
writeFileSync(out, JSON.stringify({ model, calls: rows.length, costUsd, rows }, null, 2));
const wrong = rows.filter((r) => r.outcome !== 'inconclusive' && r.outcome !== r.truth).length;
console.log(
  JSON.stringify({
    model,
    calls: rows.length,
    wrong,
    inconclusive: rows.filter((r) => r.outcome === 'inconclusive').length,
    costUsd: Number(costUsd.toFixed(4)),
  }),
);
