// Renders the shipped judge prompts (the criteria in examples/criteria and examples/acme/criteria) for every generated item.
// Usage, from the repository root: npx tsx comparisons/deepeval/judge/render.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from '../../../packages/judges/src/prompt.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const yaml = createRequire(join(root, 'packages/core/package.json'))('yaml') as {
  parse: (s: string) => { criterion: unknown };
};
const DS = join(here, '..', 'datasets');
const crit = (f: string, dir = 'examples/criteria') =>
  yaml.parse(readFileSync(join(root, dir, f), 'utf8')).criterion;
const ds = (n: string) => JSON.parse(readFileSync(join(DS, `${n}.json`), 'utf8'));
const ASK = 'Hello, what can you help me with?';
const CONTEXTS = [
  'Acme Fiber 1000 is available at 14 Harbor Road, Acmeville, at $60 a month.',
  'Acme Air 5G gives up to 200 Mbps for $35 a month at 88 Summit Avenue, Acmeville.',
  'Acme Mobile M gives 40 GB of data for $25 a month.',
  'Acme Mobile L gives unlimited data for $35 a month.',
  'The lead reference is LEAD-10C86C.',
];
const out: { id: string; set: string; system: string; user: string }[] = [];
const push = (
  set: string,
  id: string,
  criterion: unknown,
  transcript: unknown[],
  extra: Record<string, unknown> = {},
) => {
  const p = buildPrompt({ criterion, transcript, ...extra } as never);
  out.push({ id, set, system: p.system, user: p.user });
};
const cR = crit('relevancy.yaml');
for (const r of ds('relevancy'))
  push('relevancy', r.id, cR, [
    { role: 'user', text: r.ask },
    { role: 'agent', text: r.reply },
  ]);
for (const r of ds('relevancy-hard'))
  push('relevancy-hard', r.id, cR, [
    { role: 'user', text: r.ask },
    { role: 'agent', text: r.reply },
  ]);
const cV = crit('relevancy-vague.yaml', 'comparisons/deepeval/criteria');
for (const r of ds('relevancy-hard2'))
  push('relevancy-hard2', `p2-${r.id}`, cR, [
    { role: 'user', text: r.ask },
    { role: 'agent', text: r.reply },
  ]);
for (const r of ds('relevancy-hard2'))
  push('relevancy-hard2-vague', `vague-${r.id}`, cV, [
    { role: 'user', text: r.ask },
    { role: 'agent', text: r.reply },
  ]);
const cB = crit('role.yaml');
for (const r of ds('role'))
  push('role', r.id, cB, [
    { role: 'user', text: ASK },
    { role: 'agent', text: r.reply },
  ]);
const cC = crit('conversation_completeness.yaml');
for (const r of ds('completeness'))
  push(
    'completeness',
    r.id,
    cC,
    r.turns.flatMap((x: { ask: string; reply: string }) => [
      { role: 'user', text: x.ask },
      { role: 'agent', text: x.reply },
    ]),
  );
const cD = crit('task_completion.yaml');
for (const r of ds('task'))
  push(
    'task',
    r.id,
    cD,
    r.turns.flatMap((x: { ask: string; reply: string }) => [
      { role: 'user', text: x.ask },
      { role: 'agent', text: x.reply },
    ]),
  );
const cE = crit('no_invented_data.yaml', 'examples/acme/criteria');
for (const r of ds('hallucination'))
  push('hallucination', r.id, cE, [
    { role: 'user', text: 'What does Acme offer me?' },
    { role: 'tool_result', tool: 'catalog.search', text: CONTEXTS.join('\n') },
    { role: 'agent', text: r.reply },
  ]);
const cG = crit('knowledge_retention.yaml');
for (const set of ['knowledge', 'knowledge2']) {
  for (const r of ds(set))
    push(
      set,
      r.id,
      cG,
      [
        { role: 'user', text: 'Jo Okafor, jo.okafor@example.com' },
        { role: 'agent', text: r.reply },
      ],
      { given: { ledger: { email: 'jo.okafor@example.com' } } },
    );
}
writeFileSync(join(here, 'ours-prompts.json'), JSON.stringify(out));
console.log('prompts', out.length);
