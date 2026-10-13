import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JudgeRequest } from '../../../packages/judges/src/contract.ts';
import { buildPrompt } from '../../../packages/judges/src/prompt.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const yaml = createRequire(resolve(root, 'packages/core/package.json'))('yaml') as {
  parse: (text: string) => { criterion: JudgeRequest['criterion'] };
};
const files: Record<string, string> = {
  relevancy: 'examples/criteria/relevancy.yaml',
  role: 'examples/criteria/role.yaml',
  completeness: 'examples/criteria/conversation_completeness.yaml',
  task: 'examples/criteria/task_completion.yaml',
  grounding: 'examples/acme/criteria/no_invented_data.yaml',
  knowledge: 'examples/criteria/knowledge_retention.yaml',
};
type Case = {
  id: string;
  turns: { role: 'user' | 'assistant'; content: string }[];
  contexts?: string[];
  role?: string;
  tool_receipts?: {
    name: string;
    input_parameters: Record<string, unknown>;
    output: Record<string, unknown>;
  }[];
};
const suffix = process.argv[2] === 'receipt' ? '-receipts' : '';
const sets = JSON.parse(readFileSync(resolve(here, `additional/sets${suffix}.json`), 'utf8')) as Record<
  string,
  Case[]
>;
const prompts: Record<string, { system: string; user: string }> = {};
for (const [name, rows] of Object.entries(sets)) {
  const file = files[name];
  if (!file) throw new Error(`Unknown set: ${name}`);
  const criterion = yaml.parse(readFileSync(resolve(root, file), 'utf8')).criterion;
  for (const row of rows) {
    const transcript: JudgeRequest['transcript'][number][] = row.turns.map((m) => ({
      role: m.role === 'assistant' ? 'agent' : 'user',
      text: m.content,
    }));
    if (row.contexts) {
      transcript.splice(transcript.length - 1, 0, {
        role: 'tool_result',
        tool: 'catalog.search',
        text: row.contexts.join('\n'),
      });
    }
    for (const receipt of row.tool_receipts ?? []) {
      transcript.splice(
        transcript.length - 1,
        0,
        { role: 'tool_call', tool: receipt.name, text: JSON.stringify(receipt.input_parameters) },
        { role: 'tool_result', tool: receipt.name, text: JSON.stringify(receipt.output) },
      );
    }
    // Both sides receive the same explicit role, in addition to the shipped rubric.
    const inputs = row.role ? [{ path: 'role.txt', text: row.role }] : undefined;
    prompts[row.id] = buildPrompt({ criterion, transcript, ...(inputs ? { inputs } : {}) });
  }
}
writeFileSync(
  resolve(here, `additional/baseline-prompts${suffix}.json`),
  `${JSON.stringify(prompts, null, 2)}\n`,
);
console.log(`Rendered ${Object.keys(prompts).length} shipped prompts.`);
