import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseJudgeText } from '../../../../packages/judges/src/assessment';
import type { Case, Row } from '../generate.mts';
import { parseGrade } from '../harness';
import { type Config, requestFor } from './request';

// Transport parity: re-asks N recorded claude-command calls through the Messages API (claude-haiku-5-5,
// same system and user texts) and compares the parsed outcomes. Writes parity/<name>.json and the API
// answers to parity/calls.jsonl, never into calls.jsonl. Usage: parity.mts <n per row>
const here = fileURLToPath(new URL('./', import.meta.url));
const perRow = Number(process.argv[2] ?? '10');
const apiKey = readFileSync(
  process.env.ANTHROPIC_KEY_FILE ?? `${process.env.HOME}/.nexus-secrets/anthropic-driftbench.key`,
  'utf8',
).trim();
// A key not scoped to a workspace needs the workspace id header; the id is read from a file, never printed.
const workspaceFile =
  process.env.ANTHROPIC_WORKSPACE_FILE ?? `${process.env.HOME}/.nexus-secrets/anthropic-driftbench.workspace`;
const workspaceHeader: Record<string, string> = existsSync(workspaceFile)
  ? { 'anthropic-workspace-id': readFileSync(workspaceFile, 'utf8').trim() }
  : {};
type Call = {
  request_sha256: string;
  row: Row;
  side: string;
  id: string;
  repeat: number;
  prompt: { system: string; user: string };
  text: string;
  costUsd: number;
  transport?: string;
};
const cli = readFileSync(`${here}calls.jsonl`, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Call)
  .filter((call) => call.transport !== 'api');
const sets: Record<Row, Case[]> = Object.fromEntries(
  (['qa', 'fact', 'panel', 'borderline'] as Row[]).map((row) => [
    row,
    JSON.parse(readFileSync(`${here}practice/${row}.json`, 'utf8')) as Case[],
  ]),
) as Record<Row, Case[]>;
// A spread of rows and sides, the first N recorded per row in recording order.
const picked: Call[] = [];
for (const row of ['qa', 'fact', 'panel'] as Row[]) {
  const seenCase = new Set<string>();
  for (const call of cli) {
    if (call.row !== row || seenCase.has(call.id)) continue;
    if (process.env.SIDE && call.side !== process.env.SIDE) continue;
    seenCase.add(call.id);
    picked.push(call);
    if (seenCase.size >= perRow) break;
  }
}
const price = { input: 0.1 / 1e6, output: 0.5 / 1e6 };
async function ask(prompt: { system: string; user: string }) {
  for (let wait = 2000, round = 0; round < 6; round++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...workspaceHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 4096,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      }),
    });
    const body = await response.text();
    if (response.status === 429 || response.status >= 500) {
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60000);
      continue;
    }
    if (response.status !== 200) throw new Error(`API ${response.status}: ${body.slice(0, 300)}`);
    const parsed = JSON.parse(body);
    const text = (parsed.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');
    const usage = parsed.usage ?? {};
    return {
      text,
      status: response.status,
      stop_reason: parsed.stop_reason,
      usage,
      costUsd: (usage.input_tokens ?? 0) * price.input + (usage.output_tokens ?? 0) * price.output,
    };
  }
  throw new Error('the API kept answering 429 or 5xx');
}
const outcomeOf = (call: Call, text: string) => {
  if (call.side === 'theirs') return parseGrade(text);
  const c = sets[call.row].find((x) => x.id === call.id);
  if (!c) throw new Error(`case ${call.id} not in the practice set`);
  // The recorded prompt names its procedure only by its text; the default-judge contract parses the same way for every wiring.
  const config: Config = call.prompt.system.includes('An entry whose text is a rendered record')
    ? 'rendered'
    : 'split';
  const result = parseJudgeText(text, requestFor(c, call.row, config));
  return result.unparsed ? `inconclusive (${result.answer.reasoning.slice(0, 60)})` : result.answer.outcome;
};
const rows: object[] = [];
let agree = 0;
let cost = 0;
for (const call of picked) {
  const api = await ask(call.prompt);
  cost += api.costUsd;
  const before = outcomeOf(call, call.text);
  const after = outcomeOf(call, api.text);
  if (before === after) agree++;
  rows.push({
    id: call.id,
    row: call.row,
    side: call.side,
    cli: before,
    api: after,
    stop_reason: api.stop_reason,
    usage: api.usage,
    cliCostUsd: call.costUsd,
    apiCostUsd: api.costUsd,
  });
  appendFileSync(
    `${here}parity/calls.jsonl`,
    `${JSON.stringify({ ...call, text: api.text, transport: 'api', model: 'claude-haiku-5-5', apiUsage: api.usage, apiCostUsd: api.costUsd, timestamp: new Date().toISOString() })}\n`,
  );
  console.log(call.row, call.side, call.id.slice(-30), before, '->', after);
}
const summary = {
  items: picked.length,
  agree,
  disagree: picked.length - agree,
  apiCostUsd: cost,
  cliCostUsd: picked.reduce((s, c) => s + c.costUsd, 0),
  rows,
};
writeFileSync(
  `${here}parity/summary${process.env.SIDE ? `-${process.env.SIDE}` : ''}.json`,
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify({ ...summary, rows: undefined }));
