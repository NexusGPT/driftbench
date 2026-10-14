/** Renders and parses driftbench requests with the package code only. Labels never enter a request. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJudgeText } from '../../../packages/judges/src/assessment.ts';
import type { JudgeRequest } from '../../../packages/judges/src/contract.ts';
import { buildPrompt } from '../../../packages/judges/src/prompt.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const yaml = createRequire(resolve(root, 'packages/core/package.json'))('yaml');
const CRITERIA: Record<string, string> = {
  relevancy: 'examples/criteria/relevancy.yaml',
  knowledge: 'examples/criteria/knowledge_retention.yaml',
};
type Row = { id: string; turns: { role: string; content: string }[] };
type Input =
  | { action: 'render'; set: string; setting: string; cases: Row[] }
  | { action: 'parse'; rows: { request: JudgeRequest; raw: string }[] };

const input = JSON.parse(readFileSync(0, 'utf8')) as Input;
if (input.action === 'render') {
  const file = CRITERIA[input.set];
  if (!file) throw new Error(`Unknown set: ${input.set}`);
  // The whole criterion, as the shipped hard renderer and the relevance harness pass it.
  const criterion = yaml.parse(readFileSync(resolve(root, file), 'utf8')).criterion;
  // The named settings a caller can choose. "default" is what ships with no option set.
  const assessment =
    input.setting === 'default'
      ? undefined
      : input.setting === 'response-relevance'
        ? ({ kind: 'response-relevance' } as JudgeRequest['assessment'])
        : undefined;
  if (input.setting !== 'default' && !assessment) throw new Error(`Unknown setting: ${input.setting}`);
  const rows = input.cases.map((row) => {
    const request: JudgeRequest = {
      criterion,
      transcript: row.turns.map((m) => ({
        role: m.role === 'assistant' ? 'agent' : 'user',
        text: m.content,
      })),
      ...(assessment ? { assessment } : {}),
    };
    return { id: row.id, request, ...buildPrompt(request) };
  });
  process.stdout.write(JSON.stringify(rows));
} else if (input.action === 'parse') {
  process.stdout.write(JSON.stringify(input.rows.map((row) => parseJudgeText(row.raw, row.request))));
} else throw new Error('Unknown bridge action');
