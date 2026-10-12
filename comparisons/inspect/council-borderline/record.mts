/* biome-ignore-all lint/style/noNonNullAssertion: research script; each lookup uses a key the script just built */
// Records one model's answer to each borderline block, through the judges' own prompt and answer contract.
// Usage: npx tsx comparisons/inspect/council-borderline/record.mts <haiku|sonnet|opus> [out.json]
// Calls the claude command (CLAUDE_BIN, default claude). Each call is capped at PER_CALL_CAP USD (default 0.05; opus measured at about 0.012 per call).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLabels } from '../../../packages/judges/src/calibration';
import { type JudgeRequest, parseAnswerText } from '../../../packages/judges/src/contract';
import { loadCriteria } from '../../../packages/judges/src/criteria';
import { buildPrompt } from '../../../packages/judges/src/prompt';

const model = process.argv[2];
if (!model || !['haiku', 'sonnet', 'opus'].includes(model))
  throw new Error('model must be haiku, sonnet or opus');
const out = process.argv[3] ?? fileURLToPath(new URL(`./recorded-${model}.json`, import.meta.url));
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';

const { criteria } = await loadCriteria(
  fileURLToPath(new URL('../../../examples/acme/criteria', import.meta.url)),
);
const criterion = criteria.find((c) => c.def.name === 'care_redirect')!.def;
const { labels: byName } = await loadLabels(fileURLToPath(new URL('./labels', import.meta.url)));
const labels = [...(byName.get('care_redirect') ?? [])];

function run(args: string[], stdin: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd: '/tmp', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', () => resolve(stdout));
    child.stdin.end(stdin);
  });
}

async function judge(block: (typeof labels)[number]) {
  const request: JudgeRequest = {
    criterion: { name: criterion.name, rubric: criterion.rubric, pass: criterion.pass, fail: criterion.fail },
    transcript: block.transcript,
  };
  const prompt = buildPrompt(request);
  const stdout = await run(
    [
      '-p',
      '--output-format',
      'json',
      '--model',
      model,
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
      process.env.PER_CALL_CAP ?? '0.05',
    ],
    prompt.user,
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
  const outcome = isError ? 'inconclusive' : parseAnswerText(text).answer.outcome;
  return { id: block.id, label: block.label, outcome, cost, text: text.slice(0, 500) };
}

const rows: Awaited<ReturnType<typeof judge>>[] = [];
const queue = [...labels];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length > 0) {
      const block = queue.shift();
      if (block) rows.push(await judge(block));
    }
  }),
);
rows.sort((a, b) => a.id.localeCompare(b.id));
const costUsd = rows.reduce((sum, r) => sum + r.cost, 0);
writeFileSync(out, JSON.stringify({ model, calls: rows.length, costUsd, rows }, null, 2));
const wrong = rows.filter((r) => r.outcome !== 'inconclusive' && r.outcome !== r.label).length;
console.log(
  JSON.stringify({
    model,
    calls: rows.length,
    wrong,
    inconclusive: rows.filter((r) => r.outcome === 'inconclusive').length,
    costUsd: Number(costUsd.toFixed(4)),
  }),
);
