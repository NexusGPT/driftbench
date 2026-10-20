/**
 * Runs the condition feed with the real systems (Jev, Haiku) on a clause file and scores it. The clause file
 * is an array of { id, path, quote, truth }, where truth is 'none' (the clause states no condition), a
 * { variable, value } of store.yaml, or { variable, value: 'NEW', proposed_hint } for a value the store lacks.
 * The "file" a path names is the clauses written for it, joined by line feeds.
 *
 *   pnpm exec tsx examples/variables/conditions/tune.ts <clauses.json> <cache.json> <config-name>...
 *
 * Answers are cached by clause and question text, so a config that only changes a threshold costs nothing.
 * Keys are read by path and never printed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseVariableStoreText } from '@agent-nexus/driftbench-space';
import {
  averageReader,
  type ConditionProposer,
  type ConversationReader,
  createAnthropicPort,
  createJevReader,
  createModelProposer,
  feedFromConditions,
  type ReaderQuestion,
} from '../../../packages/generate/src';

type Truth = 'none' | { variable: string; value: string; proposed_hint?: string };
type Clause = { id: string; path: string; quote: string; truth: Truth };
type Config = {
  wording: 'default' | 'sharp' | 'siblings' | 'terse' | 'when';
  also?: Array<'sharp' | 'siblings' | 'when'>;
  yesAt: number;
  noAt: number;
  propose: 'all-no' | 'no-yes';
  existing?: boolean;
};

const CONFIGS: Record<string, Config> = {
  // The configuration frozen after tuning on the dev half: the default wording and the sharp wording averaged,
  // a yes at 0.5, system 2 called whenever no candidate got a yes, a proposal only under a listed variable.
  frozen: { wording: 'default', also: ['sharp'], yesAt: 0.5, noAt: 0.4, propose: 'no-yes', existing: true },
  base: { wording: 'default', yesAt: 0.75, noAt: 0.25, propose: 'all-no' },
  no05: { wording: 'default', yesAt: 0.75, noAt: 0.5, propose: 'all-no' },
  sharp: { wording: 'sharp', yesAt: 0.75, noAt: 0.25, propose: 'all-no' },
  'sharp-no05': { wording: 'sharp', yesAt: 0.75, noAt: 0.5, propose: 'all-no' },
  siblings: { wording: 'siblings', yesAt: 0.75, noAt: 0.25, propose: 'all-no' },
  'siblings-no05': { wording: 'siblings', yesAt: 0.75, noAt: 0.5, propose: 'all-no' },
  'siblings-no05-noyes': { wording: 'siblings', yesAt: 0.75, noAt: 0.5, propose: 'no-yes' },
  'sharp-no05-noyes': { wording: 'sharp', yesAt: 0.75, noAt: 0.5, propose: 'no-yes' },
};

const here = new URL('.', import.meta.url).pathname;
const secret = (name: string) => readFileSync(join(homedir(), '.nexus-secrets', name), 'utf8').trim();
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const [clausesPath, cachePath, ...names] = process.argv.slice(2);
if (!clausesPath || !cachePath || names.length === 0)
  throw new Error('usage: tune.ts <clauses.json> <cache.json> <config>...');

const clauses = JSON.parse(readFileSync(clausesPath, 'utf8')) as Clause[];
const loaded = parseVariableStoreText(readFileSync(join(here, 'store.yaml'), 'utf8'), 'yaml');
if (!loaded.ok) throw new Error('the candidate store does not load');
const store = loaded.store;
// A quote written twice (with two labels) is one clause with two conditions: read once, scored against both.
const units = new Map<string, { id: string; path: string; quote: string; truths: Truth[] }>();
for (const c of clauses) {
  const key = `${c.path}\n${c.quote}`;
  const unit = units.get(key) ?? { id: c.id, path: c.path, quote: c.quote, truths: [] };
  unit.truths.push(c.truth);
  units.set(key, unit);
}
// Each clause is a line inserted into the real file of the first example estate that has the path, so the quote
// sits among real surrounding text; a path no estate has is the clauses alone.
const texts = new Map<string, string>();
for (const u of units.values()) {
  if (!texts.has(u.path)) {
    const real = ['fixture', 'fixture-v2', 'reader-cases']
      .map((e) => join(here, '../../estates', e, u.path))
      .find((f) => existsSync(f));
    texts.set(u.path, real ? readFileSync(real, 'utf8') : '');
  }
  texts.set(
    u.path,
    `${texts.get(u.path)}${texts.get(u.path)?.endsWith('\n') || texts.get(u.path) === '' ? '' : '\n'}${u.quote}\n`,
  );
}

type Cache = { reads: Record<string, unknown>; proposals: Record<string, unknown> };
const cache: Cache = existsSync(cachePath)
  ? (JSON.parse(readFileSync(cachePath, 'utf8')) as Cache)
  : { reads: {}, proposals: {} };
const save = () => writeFileSync(cachePath, JSON.stringify(cache));

const jev = createJevReader({ env: { JEV_ROUTE: 'typesafe', JEV_API_KEY: secret('jev-typesafe.key') } });
const port = createAnthropicPort({
  env: { ANTHROPIC_API_KEY: secret('anthropic-driftbench.key'), ANTHROPIC_MODEL: 'claude-haiku-5-5' },
});
const haiku = createModelProposer(port);
const haikuExisting = createModelProposer(port, { scope: 'existing' });
const seenAnswers = new Map<string, Record<string, { yes: number } | undefined>>();
let liveReads = 0;
let liveProposals = 0;

const reader: ConversationReader = {
  id: 'jev-cached',
  family: 'jev',
  async read(clause, questions) {
    const key = sha(`${clause}\n${questions.map((q) => `${q.name}\t${q.text}`).join('\n')}`);
    const hit = cache.reads[key] as Record<string, never> | undefined;
    if (hit) {
      seenAnswers.set(clause, hit);
      return hit;
    }
    liveReads++;
    const answers = await jev.read(clause, questions);
    cache.reads[key] = answers;
    save();
    seenAnswers.set(clause, answers as never);
    return answers;
  },
};
const proposerFor = (existing: boolean): ConditionProposer => ({
  id: existing ? 'haiku-existing-cached' : 'haiku-cached',
  async propose(clause, current) {
    const listing = current.variables.map((v) => `${v.id}:${v.values.map((x) => x.id).join(',')}`).join('|');
    const key = sha(`${existing ? 'E2|' : ''}${clause}\n${listing}`);
    if (key in cache.proposals) return (cache.proposals[key] as never) ?? undefined;
    liveProposals++;
    const proposal = await (existing ? haikuExisting : haiku).propose(clause, current);
    cache.proposals[key] = proposal ?? null;
    save();
    return proposal;
  },
});

const wordings: Record<
  Config['wording'],
  NonNullable<NonNullable<Parameters<typeof feedFromConditions>[0]['options']>['questionText']>
> = {
  default: (v, x) =>
    `Does this text say when this applies: ${v.title}: ${x.title}? Answer for the text itself.`,
  terse: (_v, x) => `${x.title}?`,
  when: (_v, x) => `Does this text tell what to do in this situation: ${x.title}?`,
  sharp: (v, x) =>
    `This is one clause from the instructions of an AI agent. Does the clause tell the agent to act only in this exact situation: "${x.title}" (a case of "${v.title}")? Answer yes only when the clause names that situation. A clause about a different situation, or about no situation, is a no.`,
  siblings: (v, x) => {
    const others = (store.variables.find((w) => w.id === v.id)?.values ?? []).filter((y) => y.id !== x.id);
    const rest = others.length
      ? ` The other cases of "${v.title}" are: ${others.map((y) => y.title).join('; ')}.`
      : '';
    return `This is one clause from the instructions of an AI agent. Does the clause tell the agent to act only in this exact situation: "${x.title}"?${rest} Answer yes only when the clause names this case and not another. A clause about no situation is a no.`;
  },
};

function score(result: Awaited<ReturnType<typeof feedFromConditions>>) {
  const by = new Map(result.report.outcomes.map((o) => [o.span, o]));
  const modelValues = new Map<string, string>();
  for (const v of result.store.variables)
    for (const x of v.values) if (x.produced_by === 'model') modelValues.set(`${v.id}/${x.id}`, v.id);
  let assigned = 0;
  let correct = 0;
  let planted = 0;
  const wrong: string[] = [];
  for (const u of units.values()) {
    const o = by.get(u.id);
    const values = o?.values ?? [];
    assigned += values.length;
    const explained = new Set<string>();
    for (const t of u.truths) {
      if (t === 'none') continue;
      planted++;
      if (t.value === 'NEW') {
        const hit = values.find((v) => modelValues.get(v) === t.variable && !explained.has(v));
        if (hit) {
          correct++;
          explained.add(hit);
        } else wrong.push(`${u.id} NEW(${t.variable}) got ${o?.status} ${values.join(',')}`);
        continue;
      }
      const want = `${t.variable}/${t.value}`;
      if (values.includes(want)) {
        correct++;
        explained.add(want);
      } else wrong.push(`${u.id} want ${want} got ${o?.status} ${values.join(',')}`);
    }
    for (const v of values) if (!explained.has(v)) wrong.push(`${u.id} extra ${v}`);
  }
  return { assigned, correct, planted, wrong };
}

for (const name of names) {
  const grid = /^(t|terse|when)-(\d+)-(\d+)(-noyes)?(-ex)?(?:\+(sharp|when|siblings))?$/.exec(name);
  const config: Config | undefined = grid
    ? {
        wording: grid[1] === 't' ? 'default' : (grid[1] as 'terse' | 'when'),
        yesAt: Number(grid[2]) / 100,
        noAt: Number(grid[3]) / 100,
        propose: grid[4] ? 'no-yes' : 'all-no',
        existing: Boolean(grid[5]),
        ...(grid[6] ? { also: [grid[6] as 'sharp' | 'when' | 'siblings'] } : {}),
      }
    : CONFIGS[name];
  if (!config) throw new Error(`no config ${name}`);
  const result = await feedFromConditions({
    store,
    spans: [...units.values()].map((c) => ({ id: c.id, path: c.path, quote: c.quote })),
    texts,
    reader: config.also
      ? averageReader(reader, [
          (q) => q,
          ...config.also.map((w) => (q: ReaderQuestion): ReaderQuestion => {
            // The default wording is `...applies: <variable title>: <value title>? ...`, written above.
            const m = /applies: (.*): (.*)\? Answer/.exec(q.text);
            const [, vt = '', xt = ''] = m ?? [];
            const sibs =
              store.variables.find((y) => y.title === vt)?.values.filter((y) => y.title !== xt) ?? [];
            return {
              ...q,
              text: wordingsFor(w)(
                { id: '', title: vt },
                { id: '', title: xt },
                sibs.map((y) => y.title),
              ),
            };
          }),
        ])
      : reader,
    proposer: proposerFor(config.existing === true),
    options: {
      ...(config.existing ? { newVariables: false } : {}),
      decide: { yesAt: config.yesAt, noAt: config.noAt },
      questionText: wordings[config.wording],
      propose: config.propose,
    },
  });
  const s = score(result);
  const r = result.report;
  console.log(
    `${name}: precision ${(s.correct / s.assigned).toFixed(3)} (${s.correct}/${s.assigned}) recall ${(s.correct / s.planted).toFixed(3)} (${s.correct}/${s.planted}) matched ${r.matched} proposed ${r.proposed} unsure ${r.unsure} unmatched ${r.unmatched} refused ${r.refused} failed ${r.failed} proposerCalls ${r.proposerCalls}`,
  );
  if (process.env.DIAG) {
    for (const c of [...units.values()].map((u) => ({ ...u, truth: u.truths[0] as Truth }))) {
      const a = seenAnswers.get(c.quote) ?? {};
      const top = Object.entries(a)
        .map(([n, v]) => [n, v?.yes ?? -1] as const)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([n, p]) => `${n} ${p.toFixed(2)}`);
      const want = c.truth === 'none' ? 'none' : `${c.truth.variable}/${c.truth.value}`;
      console.log(`   ${c.id} [${want}] ${top.join(' | ')}`);
    }
  }
  for (const o of r.outcomes)
    if (o.status === 'failed' || o.status === 'refused') console.log(`   ${o.span} ${o.status}: ${o.reason}`);
  if (process.env.SHOW_WRONG) for (const w of s.wrong) console.log(`   ${w}`);
}
console.log(
  'live calls this run',
  JSON.stringify({ reads: liveReads, proposals: liveProposals }),
  'jev usage',
  JSON.stringify(jev.usage()),
);

function wordingsFor(w: 'sharp' | 'siblings' | 'when'): Wording {
  return wordings[w];
}
