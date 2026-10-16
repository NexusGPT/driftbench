import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A stand-in that follows both schemas and records every physical submission. */
export async function routedJudge(dir: string): Promise<{ command: string; receipts: string }> {
  const command = join(dir, 'routed-judge.cjs');
  const receipts = join(dir, 'judge-calls.jsonl');
  await writeFile(receipts, '');
  await writeFile(
    command,
    `#!/usr/bin/env node
// @driftbench-stand-in
const { appendFileSync } = require('node:fs');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const system = process.argv[process.argv.indexOf('--system-prompt') + 1] ?? '';
  const route = system.includes('"route":"criterion"');
  const block = input.match(/<transcript_data>\\n([\\s\\S]*?)\\n<\\/transcript_data>/)?.[1] ?? '';
  const entries = block.trim().startsWith('[') ? JSON.parse(block) : [];
  const observed = entries.find((entry) => entry.role === 'agent')?.text ?? entries.find((entry) => entry.role === 'user')?.text ?? '';
  const fail = input.includes('public holiday');
  const answer = route ? { route: 'criterion' } : { checks: [{
    id: input.match(/^CRITERION: ([^\\n]+)/)?.[1] ?? 'missing',
    reasoning: fail ? 'The reply invents a public holiday.' : 'The criterion is satisfied.',
    evidence: observed.match(/[\\p{L}\\p{N}]+/u)?.[0] ?? null,
    met: !fail,
  }] };
  const budgetAt = process.argv.indexOf('--max-budget-usd');
  const budget = budgetAt < 0 ? null : Number(process.argv[budgetAt + 1]);
  const affordable = budget === null || budget >= 0.0015 - 1e-12;
  const cost = affordable ? 0.0015 : 0;
  appendFileSync(${JSON.stringify(receipts)}, JSON.stringify({ route, budget, cost }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: affordable ? 'success' : 'error_max_budget_usd', is_error: !affordable,
    result: affordable ? JSON.stringify(answer) : 'Insufficient budget.', total_cost_usd: cost }));
});
`,
  );
  return { command, receipts };
}
