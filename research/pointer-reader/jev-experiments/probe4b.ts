// Probe: the choice and score question types of the Jev System One API (documented by the Vercel AI Gateway and Databricks pages).
import { join } from 'node:path';
import { ask, config, loadCassette, budget } from './src/jev';
const dir = new URL('.', import.meta.url).pathname;
const scratch = process.env.JEV_SCRATCH!;
const cfg = config(dir, { cassettePath: join(scratch, 'cassette4.raw.jsonl'), budgetPath: join(scratch, 'budget4.json'), maxCalls: 3000 });
const cas = loadCassette(cfg.cassettePath);
const state = 'WINDOW\n[1] Return every key before you leave.\n[2] A key opens one door.\n[3] Never leave the till open.\n[4] Close the shop before you switch off the lamps.\n[5] For example, a missing key once delayed the opening by an hour.';
const crit = { rule: 'a unit that tells the reader to do something, and neither forbids anything nor sets an order between two acts', prohibition: 'a unit that tells the reader never to do something', gate: 'a unit that says one act must come before another', example: 'a unit that shows a case and is not itself an instruction', description: 'a unit that states how something is and tells the reader neither to do nor to avoid anything', none: 'a heading, label, greeting or filler that says nothing about the work' };
const q = (n: number) => ({ type: 'choice', instructions: `Which label does unit [${n}] of the window have?`, criteria: crit });
const cases: Array<[string, unknown]> = [
  ['choice-5', { model: cfg.model, state, questions: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`u${n}`, q(n)])) }],
  ['choice-null-criteria', { model: cfg.model, state, questions: { u1: { type: 'choice', instructions: 'Which label does unit [1] have: rule, prohibition, gate, example, description or none?', criteria: Object.fromEntries(Object.keys(crit).map((k) => [k, null])) } } }],
  ['noul-criteria', { model: cfg.model, state, questions: { u3: { type: 'noul', instructions: 'Is unit [3] a prohibition?', criteria: { true: 'unit [3] tells the reader never to do something', false: 'unit [3] does not forbid anything' } } } }],
  ['score', { model: cfg.model, state, questions: { u1: { type: 'score', instructions: 'How strongly does unit [1] instruct the reader?', criteria: ['not an instruction', 'a soft suggestion', 'a firm instruction'] } } }],
];
for (const [name, body] of cases) {
  const r = await ask(cfg, body as never, `probe4b-${name}`, cas);
  console.log(`== ${name}: status ${r.status}, ${r.ms} ms`);
  console.log(JSON.stringify(r.raw).slice(0, 2500));
}
console.log(JSON.stringify(budget(cfg.budgetPath)));
