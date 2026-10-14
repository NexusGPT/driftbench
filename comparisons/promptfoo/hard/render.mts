// Render the shipped judge exactly once per generated case. Labels never enter prompts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { buildPrompt as BuildPrompt } from '../../../packages/judges/src/prompt';
import { pinnedJudge } from '../../pinned-judge';

const pinned = pinnedJudge(new URL('./pinned-judge/', import.meta.url));
const buildPrompt = pinned.load('packages/judges/src/prompt.ts').buildPrompt as typeof BuildPrompt;

const here = fileURLToPath(new URL('.', import.meta.url));
const prefix = process.argv.includes('--heldout') ? 'heldout-' : '';
const verify = process.argv.includes('--verify');
type Item = {
  id: string;
  question: string;
  reply: string;
  reference?: string;
  rubric?: string;
  endState?: unknown;
};
let count = 0;
for (const row of ['rubric', 'factuality', 'pii', 'goal']) {
  const prompts: Record<string, { system: string; user: string }> = {};
  const items = JSON.parse(readFileSync(`${here}${prefix}${row}.json`, 'utf8')) as Item[];
  for (const item of items) {
    const rubric =
      row === 'factuality'
        ? 'The reply contains no factual disagreement with reference.txt. A consistent subset, superset, or equivalent paraphrase passes. Any contradicted fact fails.'
        : (item.rubric ?? item.question);
    const inputs =
      row === 'factuality'
        ? [{ path: 'reference.txt', text: item.reference ?? '' }]
        : row === 'goal'
          ? [{ path: 'persisted-final-order.json', text: JSON.stringify(item.endState) }]
          : [];
    prompts[item.id] = buildPrompt({
      criterion: { name: `${row}_hard`, rubric, scope: 'block' },
      transcript: [
        { role: 'user', text: item.question },
        { role: 'agent', text: item.reply },
      ],
      inputs,
    });
    count += 1;
  }
  const path = `${here}${prefix}${row}-shipped-prompts.json`;
  if (verify) {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as typeof prompts;
    if (JSON.stringify(stored) !== JSON.stringify(prompts)) {
      throw new Error(`${prefix}${row}: saved baseline differs from pinned judge ${pinned.commit}`);
    }
  } else {
    const content = `${JSON.stringify(prompts, null, 2)}\n`;
    if (
      !existsSync(path) ||
      JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !== JSON.stringify(prompts)
    ) {
      writeFileSync(path, content);
    }
  }
}
console.log(
  `${verify ? 'Verified' : 'Rendered'} ${count} prompts without labels from pinned judge ${pinned.commit}.`,
);
