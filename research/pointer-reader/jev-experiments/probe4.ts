// Probes of the Jev request format: what the validator says about question types, fields and state shapes. Each answer is recorded in the cassette.
import { join } from 'node:path';
import { ask, config, loadCassette, budget } from './src/jev';
const dir = new URL('.', import.meta.url).pathname;
const scratch = process.env.JEV_SCRATCH!;
const cfg = config(dir, { cassettePath: join(scratch, 'cassette4.raw.jsonl'), budgetPath: join(scratch, 'budget4.json'), maxCalls: 3000 });
const cas = loadCassette(cfg.cassettePath);
const state = 'WINDOW\n[1] Return every key before you leave.\n[2] A key opens one door.\n[3] Never leave the till open.';
const cases: Array<[string, unknown]> = [
  ['bogus-type', { model: cfg.model, state, questions: { a: { type: 'bogus', instructions: { question: 'x' } } } }],
  ['no-instructions', { model: cfg.model, state, questions: { a: { type: 'noul' } } }],
  ['extra-instruction-field', { model: cfg.model, state, questions: { a: { type: 'noul', instructions: { question: 'Is [1] a rule?', foo: 1 } } } }],
  ['extra-top-field', { model: cfg.model, state, foo: 1, questions: { a: { type: 'noul', instructions: { question: 'Is [1] a rule?' } } } }],
  ['state-object', { model: cfg.model, state: { a: 1 }, questions: { a: { type: 'noul', instructions: { question: 'Is it a rule?' } } } }],
  ['no-model', { state, questions: { a: { type: 'noul', instructions: { question: 'Is [1] a rule?' } } } }],
];
for (const [name, body] of cases) {
  const r = await ask(cfg, body as never, `probe4-${name}`, cas);
  console.log(`== ${name}: status ${r.status}`);
  console.log(JSON.stringify(r.raw).slice(0, 1500));
}
console.log(JSON.stringify(budget(cfg.budgetPath)));
