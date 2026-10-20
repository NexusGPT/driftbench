/**
 * The condition feed measured on a clause file: the candidate store, the wordings, the named configurations, the
 * way a clause file becomes spans and file texts, and the scoring. `tune.ts` runs it with the real systems;
 * a test runs it from a recording with no call.
 *
 * A clause file is an array of { id, path, quote, truth }, where truth is 'none' (the clause states no condition
 * among the store's variables), a { variable, value } of store.yaml, or { variable, value: 'NEW', proposed_hint }
 * for a case of a variable the store has that equals none of its values.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVariableStoreText } from '@agent-nexus/driftbench-space';
import {
  averageReader,
  type ConditionProposer,
  type ConversationReader,
  createModelProposer,
  feedFromConditions,
  type ModelPort,
  type ReaderQuestion,
} from '../../../packages/generate/src';

export type Truth = 'none' | { variable: string; value: string; proposed_hint?: string };
export type Clause = { id: string; path: string; quote: string; truth: Truth };
export type Wording = 'default' | 'sharp' | 'siblings' | 'terse' | 'when';
export type Config = {
  wording: Wording;
  also?: Array<'sharp' | 'siblings' | 'when'>;
  yesAt: number;
  noAt: number;
  propose: 'all-no' | 'no-yes';
  existing?: boolean;
  titles?: boolean;
  checkProposals?: 'refuse' | 'match';
  crossCheck?: boolean;
};

export const CONFIGS: Record<string, Config> = {
  // Frozen after the first tuning round on the dev half: the default wording and the sharp wording averaged, a
  // yes at 0.5, system 2 called whenever no candidate got a yes, a proposal only under a listed variable.
  frozen: { wording: 'default', also: ['sharp'], yesAt: 0.5, noAt: 0.4, propose: 'no-yes', existing: true },
  base: { wording: 'default', yesAt: 0.75, noAt: 0.25, propose: 'all-no' },
};

/** The names of the form `t-<yes>-<no>[-noyes][-ex][+sharp]` build a config; other names are CONFIGS keys. */
export function configNamed(name: string): Config {
  const extras = {
    ...(name.includes('~titles') ? { titles: true } : {}),
    ...(name.includes('~refuse') ? { checkProposals: 'refuse' as const } : {}),
    ...(name.includes('~match') ? { checkProposals: 'match' as const } : {}),
    ...(name.includes('~cross') ? { crossCheck: true } : {}),
  };
  const bare = name.split('~')[0] as string;
  const grid = /^(t|terse|when)-(\d+)-(\d+)(-noyes)?(-ex)?(?:\+(sharp|when|siblings))?$/.exec(bare);
  if (grid) {
    return {
      wording: grid[1] === 't' ? 'default' : (grid[1] as 'terse' | 'when'),
      yesAt: Number(grid[2]) / 100,
      noAt: Number(grid[3]) / 100,
      propose: grid[4] ? 'no-yes' : 'all-no',
      existing: Boolean(grid[5]),
      ...(grid[6] ? { also: [grid[6] as 'sharp' | 'when' | 'siblings'] } : {}),
      ...extras,
    };
  }
  const named = CONFIGS[bare];
  if (!named) throw new Error(`no config ${name}`);
  return { ...named, ...extras };
}

const here = new URL('.', import.meta.url).pathname;
export const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export function loadStore() {
  const loaded = parseVariableStoreText(readFileSync(join(here, 'store.yaml'), 'utf8'), 'yaml');
  if (!loaded.ok) throw new Error('the candidate store does not load');
  return loaded.store;
}

export type Unit = { id: string; path: string; quote: string; truths: Truth[] };

/** A quote written twice (with two labels) is one clause with two conditions: read once, scored against both. */
export function unitsOf(clauses: readonly Clause[]): Unit[] {
  const units = new Map<string, Unit>();
  for (const c of clauses) {
    const key = `${c.path}\n${c.quote}`;
    const unit = units.get(key) ?? { id: c.id, path: c.path, quote: c.quote, truths: [] };
    unit.truths.push(c.truth);
    units.set(key, unit);
  }
  return [...units.values()];
}

/**
 * Each clause is a line inserted into the real file of the first example estate that has the path, so the quote
 * sits among real surrounding text; a path no estate has is the clauses alone.
 */
export function textsOf(units: readonly Unit[]): Map<string, string> {
  const texts = new Map<string, string>();
  for (const u of units) {
    if (!texts.has(u.path)) {
      const real = ['fixture', 'fixture-v2', 'reader-cases']
        .map((e) => join(here, '../../estates', e, u.path))
        .find((f) => existsSync(f));
      texts.set(u.path, real ? readFileSync(real, 'utf8') : '');
    }
    const held = texts.get(u.path) as string;
    texts.set(u.path, `${held}${held === '' || held.endsWith('\n') ? '' : '\n'}${u.quote}\n`);
  }
  return texts;
}

export type Cache = { reads: Record<string, unknown>; proposals: Record<string, unknown> };
export type Live = {
  read(clause: string, questions: readonly ReaderQuestion[]): Promise<Record<string, never>>;
  port: ModelPort;
};
export type Systems = {
  reader: ConversationReader;
  proposerFor(config: Config): ConditionProposer;
  touched: { reads: Set<string>; proposals: Set<string> };
  live: { reads: number; proposals: number };
  seen: Map<string, Record<string, { yes: number } | undefined>>;
  onMiss?: () => void;
};

/** The two systems over a cache. With `live`, a miss calls the real system and stores the answer; without, a miss throws. */
export function makeSystems(cache: Cache, live?: Live, save: () => void = () => {}): Systems {
  const touched = { reads: new Set<string>(), proposals: new Set<string>() };
  const counts = { reads: 0, proposals: 0 };
  const seen = new Map<string, Record<string, { yes: number } | undefined>>();
  const reader: ConversationReader = {
    id: 'cached',
    family: 'jev',
    async read(clause, questions) {
      const key = sha(`${clause}\n${questions.map((q) => `${q.name}\t${q.text}`).join('\n')}`);
      touched.reads.add(key);
      const hit = cache.reads[key] as Record<string, never> | undefined;
      if (hit) {
        seen.set(clause, hit);
        return hit;
      }
      if (!live) throw new Error('the recording has no read for this clause and these questions');
      counts.reads++;
      const answers = await live.read(clause, questions);
      cache.reads[key] = answers;
      save();
      seen.set(clause, answers as never);
      return answers;
    },
  };
  const proposerFor = (config: Config): ConditionProposer => {
    const tag = config.existing ? (config.titles ? 'E3|' : 'E2|') : '';
    const inner = live
      ? createModelProposer(live.port, {
          ...(config.existing ? { scope: 'existing' as const } : {}),
          ...(config.titles ? { listing: 'titles' as const } : {}),
        })
      : undefined;
    return {
      id: 'cached',
      async propose(clause, current) {
        const listing = current.variables
          .map((v) =>
            config.titles
              ? `${v.id}:${v.values.map((x) => `${x.id}=${x.title}`).join(',')}`
              : `${v.id}:${v.values.map((x) => x.id).join(',')}`,
          )
          .join('|');
        const key = sha(`${tag}${clause}\n${listing}`);
        touched.proposals.add(key);
        if (key in cache.proposals) return (cache.proposals[key] as never) ?? undefined;
        if (!inner) throw new Error('the recording has no proposal for this clause and these variables');
        counts.proposals++;
        const proposal = await inner.propose(clause, current);
        cache.proposals[key] = proposal ?? null;
        save();
        return proposal;
      },
    };
  };
  return { reader, proposerFor, touched, live: counts, seen };
}

type WordingFn = (
  v: { id: string; title: string },
  x: { id: string; title: string },
  sibs?: string[],
) => string;
const wordings: Record<Wording, WordingFn> = {
  default: (v, x) =>
    `Does this text say when this applies: ${v.title}: ${x.title}? Answer for the text itself.`,
  terse: (_v, x) => `${x.title}?`,
  when: (_v, x) => `Does this text tell what to do in this situation: ${x.title}?`,
  sharp: (v, x) =>
    `This is one clause from the instructions of an AI agent. Does the clause tell the agent to act only in this exact situation: "${x.title}" (a case of "${v.title}")? Answer yes only when the clause names that situation. A clause about a different situation, or about no situation, is a no.`,
  siblings: (v, x, sibs = []) => {
    const rest = sibs.length ? ` The other cases of "${v.title}" are: ${sibs.join('; ')}.` : '';
    return `This is one clause from the instructions of an AI agent. Does the clause tell the agent to act only in this exact situation: "${x.title}"?${rest} Answer yes only when the clause names this case and not another. A clause about no situation is a no.`;
  },
};

export type Score = { assigned: number; correct: number; planted: number; wrong: string[] };

export function score(units: readonly Unit[], result: Awaited<ReturnType<typeof feedFromConditions>>): Score {
  const by = new Map(result.report.outcomes.map((o) => [o.span, o]));
  const modelValues = new Map<string, string>();
  for (const v of result.store.variables)
    for (const x of v.values) if (x.produced_by === 'model') modelValues.set(`${v.id}/${x.id}`, v.id);
  let assigned = 0;
  let correct = 0;
  let planted = 0;
  const wrong: string[] = [];
  for (const u of units) {
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

export async function runConfig(config: Config, clauses: readonly Clause[], systems: Systems) {
  const store = loadStore();
  const units = unitsOf(clauses);
  const texts = textsOf(units);
  const reader = config.also
    ? averageReader(systems.reader, [
        (q) => q,
        ...config.also.map((w) => (q: ReaderQuestion): ReaderQuestion => {
          // The default wording is `...applies: <variable title>: <value title>? ...`, written above.
          const m = /applies: (.*): (.*)\? Answer/.exec(q.text);
          const [, vt = '', xt = ''] = m ?? [];
          const sibs =
            store.variables.find((y) => y.title === vt)?.values.filter((y) => y.title !== xt) ?? [];
          return {
            ...q,
            text: wordings[w](
              { id: '', title: vt },
              { id: '', title: xt },
              sibs.map((y) => y.title),
            ),
          };
        }),
      ])
    : systems.reader;
  const result = await feedFromConditions({
    store,
    spans: units.map((c) => ({ id: c.id, path: c.path, quote: c.quote })),
    texts,
    reader,
    proposer: systems.proposerFor(config),
    options: {
      ...(config.existing ? { newVariables: false } : {}),
      ...(config.checkProposals ? { checkProposals: config.checkProposals } : {}),
      ...(config.crossCheck ? { crossCheck: true } : {}),
      decide: { yesAt: config.yesAt, noAt: config.noAt },
      questionText: (v, x) => wordings[config.wording](v, x),
      propose: config.propose,
    },
  });
  return { result, units, score: score(units, result) };
}

export function summary(name: string, run: Awaited<ReturnType<typeof runConfig>>): string {
  const s = run.score;
  const r = run.result.report;
  return `${name}: precision ${(s.correct / s.assigned).toFixed(3)} (${s.correct}/${s.assigned}) recall ${(s.correct / s.planted).toFixed(3)} (${s.correct}/${s.planted}) matched ${r.matched} proposed ${r.proposed} unsure ${r.unsure} unmatched ${r.unmatched} refused ${r.refused} failed ${r.failed} proposerCalls ${r.proposerCalls}`;
}
