import { ask, config, loadCassette } from './src/jev';
const dir = new URL('.', import.meta.url).pathname;
const cfg = config(dir, { cassettePath: dir + 'probe.cassette.jsonl', budgetPath: dir + 'budget.json' });
const c = loadCassette(cfg.cassettePath);
const body = {
  model: cfg.model,
  state: 'WINDOW\n[1] Return every key before you leave.\n[2] A key opens one door.\n[3] Never leave the till open.',
  questions: {
    u1__rule: { type: 'noul' as const, instructions: { question: 'Is unit [1] in the window a rule: a unit that tells the reader what to do?' } },
    u2__rule: { type: 'noul' as const, instructions: { question: 'Is unit [2] in the window a rule: a unit that tells the reader what to do?' } },
    u3__prohibition: { type: 'noul' as const, instructions: { question: 'Is unit [3] in the window a prohibition: a unit that tells the reader what never to do?' } },
  },
};
const r = await ask(cfg, body, 'probe1', c);
console.log(r.ok, r.status, r.ms, JSON.stringify(r.raw).slice(0, 800));
