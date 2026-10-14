import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJudgeText } from '../../../packages/judges/src/assessment.ts';
import type { JudgeRequest } from '../../../packages/judges/src/contract.ts';
import { buildPrompt } from '../../../packages/judges/src/prompt.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const yaml = createRequire(resolve(root, 'packages/core/package.json'))('yaml');
const input = JSON.parse(readFileSync(0, 'utf8'));
if (input.action === 'render') {
  const source = yaml.parse(
    readFileSync(resolve(root, input.criterion ?? 'examples/criteria/knowledge_retention.yaml'), 'utf8'),
  ).criterion;
  // Same selection as the existing hard renderer. Labels never enter requests.
  const { name, rubric, pass, fail, scope } = source;
  const criterion = { name, rubric, pass, fail, scope };
  const rows = input.cases.map((row: { id: string; turns: { role: string; content: string }[] }) => {
    const request: JudgeRequest = {
      criterion,
      transcript: row.turns.map((m) => ({
        role: m.role === 'assistant' ? 'agent' : 'user',
        text: m.content,
      })),
    };
    return { id: row.id, request, ...buildPrompt(request) };
  });
  process.stdout.write(JSON.stringify(rows));
} else if (input.action === 'parse') {
  process.stdout.write(
    JSON.stringify(
      input.rows.map((row: { request: JudgeRequest; raw: string }) => parseJudgeText(row.raw, row.request)),
    ),
  );
} else throw new Error('Unknown bridge action');
