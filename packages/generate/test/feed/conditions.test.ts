import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import {
  averageReader,
  type ConditionProposal,
  type ConditionProposer,
  type ConditionSpan,
  type ConversationReader,
  emptyRecording,
  feedFromConditions,
  type ReaderAnswer,
  recordConditions,
  replayConditions,
} from '../../src/feed';
import { fixtureStore } from './support';

const SEEDS = Number(process.env.FEED_COVERAGE_SEEDS ?? 20);
const FILE = 'agent/rules.md';

/** One planted condition: the clause, and the value it must end up under. */
type Planted = { span: ConditionSpan; pair: string; proposal?: ConditionProposal };

const fnv = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

/**
 * Fictional clauses, written from ids (a write-only template). 30 are about a value the store already has;
 * 10 are about a value it lacks, in a variable it lacks too.
 */
function plant(): { planted: Planted[]; texts: Map<string, string> } {
  const store = fixtureStore();
  const known = store.variables.flatMap((variable) => variable.values.map((value) => ({ variable, value })));
  const planted: Planted[] = [];
  for (let i = 0; i < 30; i++) {
    const at = known[i % known.length] as (typeof known)[number];
    planted.push({
      span: {
        id: `k${i}`,
        path: FILE,
        quote: `Rule K${i}: this applies only when ${at.value.title}.`,
      },
      pair: `${at.variable.id}/${at.value.id}`,
    });
  }
  for (let i = 0; i < 10; i++) {
    planted.push({
      span: { id: `n${i}`, path: FILE, quote: `Rule N${i}: this applies only in the window w${i}.` },
      pair: `delivery_window/w${i}`,
      proposal: {
        variable: { id: 'delivery_window', title: 'the delivery window' },
        value: { id: `w${i}`, title: `the window w${i}` },
      },
    });
  }
  const texts = new Map([[FILE, `${planted.map((p) => p.span.quote).join('\n')}\n`]]);
  return { planted, texts };
}

type Sim = {
  reader: ConversationReader;
  proposer: ConditionProposer;
  calls: { reads: number; proposals: number };
};

/**
 * A system 1 that knows the truth and errs at a set rate (a false yes 0.2 percent of the time, a missed yes
 * 2 percent), and a system 2 that finds the right proposal 98 percent of the time. The error depends on the
 * seed, the clause and the question only.
 */
function simulated(planted: readonly Planted[], seed: number): Sim {
  const truth = new Map(planted.map((p) => [p.span.quote, p]));
  const calls = { reads: 0, proposals: 0 };
  return {
    calls,
    reader: {
      id: 'simulated',
      family: 'test',
      async read(clause, questions) {
        calls.reads++;
        const row = truth.get(clause);
        if (row === undefined) throw new Error('unknown clause');
        const out: Record<string, ReaderAnswer | undefined> = {};
        for (const q of questions) {
          const u = mulberry32(fnv(`${seed}|${q.name}|${clause}`))();
          const isTrue = q.name === row.pair;
          const yes = isTrue ? u >= 0.02 : u < 0.002;
          out[q.name] = { yes: yes ? 0.93 : 0.04 };
        }
        return out;
      },
    },
    proposer: {
      id: 'simulated',
      async propose(clause) {
        calls.proposals++;
        const row = truth.get(clause);
        if (row?.proposal === undefined) return undefined;
        return mulberry32(fnv(`${seed}|proposal|${clause}`))() < 0.98 ? row.proposal : undefined;
      },
    },
  };
}

function score(planted: readonly Planted[], outcomes: ReadonlyArray<{ span: string; values: string[] }>) {
  const truth = new Map(planted.map((p) => [p.span.id, p.pair]));
  let assigned = 0;
  let correct = 0;
  for (const outcome of outcomes) {
    for (const value of outcome.values) {
      assigned++;
      if (truth.get(outcome.span) === value) correct++;
    }
  }
  return { assigned, correct, planted: planted.length };
}

describe('feedFromConditions: planted conditions', () => {
  it(`finds them at 0.95 precision and recall over ${SEEDS} seeds`, async () => {
    let assigned = 0;
    let correct = 0;
    let total = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { planted, texts } = plant();
      const sim = simulated(planted, seed);
      const { report } = await feedFromConditions({
        store: fixtureStore(),
        spans: planted.map((p) => p.span),
        texts,
        reader: sim.reader,
        proposer: sim.proposer,
      });
      const s = score(planted, report.outcomes);
      assigned += s.assigned;
      correct += s.correct;
      total += s.planted;
    }
    const precision = correct / assigned;
    const recall = correct / total;
    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });

  it('fails the bar for a reader that says yes to everything (the check can fail)', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 1);
    const yesToAll: ConversationReader = {
      ...sim.reader,
      async read(_clause, questions) {
        return Object.fromEntries(questions.map((q) => [q.name, { yes: 0.99 }]));
      },
    };
    const { report } = await feedFromConditions({
      store: fixtureStore(),
      spans: planted.map((p) => p.span),
      texts,
      reader: yesToAll,
      proposer: sim.proposer,
    });
    const s = score(planted, report.outcomes);
    expect(s.correct / s.assigned).toBeLessThan(0.95);
  });

  it('fails the recall bar without system 2: the missing values are not found', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 1);
    const { report } = await feedFromConditions({
      store: fixtureStore(),
      spans: planted.map((p) => p.span),
      texts,
      reader: sim.reader,
    });
    const s = score(planted, report.outcomes);
    expect(s.correct / s.planted).toBeLessThan(0.95);
    expect(report.unmatched).toBeGreaterThan(0);
  });
});

describe('feedFromConditions: the two systems', () => {
  it('calls system 2 only for a span no candidate took', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 3);
    const { report } = await feedFromConditions({
      store: fixtureStore(),
      spans: planted.map((p) => p.span),
      texts,
      reader: sim.reader,
      proposer: sim.proposer,
    });
    const taken = report.outcomes.filter((o) => o.status === 'matched').length;
    expect(sim.calls.proposals).toBe(report.proposerCalls);
    expect(report.proposerCalls).toBe(report.spans - taken - report.unsure);
    expect(report.proposerCalls).toBeLessThan(report.spans);
  });

  it('stands every value on a quote that is in its file, and marks the proposed ones for approval', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 5);
    const { store } = await feedFromConditions({
      store: fixtureStore(),
      spans: planted.map((p) => p.span),
      texts,
      reader: sim.reader,
      proposer: sim.proposer,
    });
    const text = texts.get(FILE) as string;
    const quoted = store.variables.flatMap((v) => v.values.filter((x) => (x.provenance ?? []).length > 0));
    expect(quoted.length).toBeGreaterThan(10);
    for (const value of quoted) {
      for (const p of value.provenance ?? []) {
        expect(p.kind).toBe('quote');
        if (p.kind === 'quote') expect(text.includes(p.quote)).toBe(true);
      }
    }
    const added = store.variables.find((v) => v.id === 'delivery_window');
    expect(added?.approved).toBe(false);
    expect(added?.produced_by).toBe('model');
    for (const value of added?.values ?? []) {
      expect(value.approved).toBe(false);
      expect(value.produced_by).toBe('model');
    }
  });

  it('does not propose over a candidate the reader could not settle', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 1);
    const unsure: ConversationReader = {
      ...sim.reader,
      async read(_clause, questions) {
        return Object.fromEntries(questions.map((q, i) => [q.name, { yes: i === 0 ? 0.5 : 0.04 }]));
      },
    };
    const { report, store } = await feedFromConditions({
      store: fixtureStore(),
      spans: planted.slice(0, 3).map((p) => p.span),
      texts,
      reader: unsure,
      proposer: sim.proposer,
    });
    expect(report.unsure).toBe(3);
    expect(sim.calls.proposals).toBe(0);
    expect(store).toEqual(fixtureStore());
  });

  it('refuses a quote that is not in its file, without calling anybody', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 1);
    const span = { id: 'x', path: FILE, quote: 'A clause that is nowhere in the file.' };
    const { report, store } = await feedFromConditions({
      store: fixtureStore(),
      spans: [span, { ...span, id: 'y', path: 'agent/missing.md' }, { ...span, id: 'z', quote: '  ' }],
      texts,
      reader: sim.reader,
      proposer: sim.proposer,
    });
    expect(report.refused).toBe(3);
    expect(sim.calls.reads).toBe(0);
    expect(sim.calls.proposals).toBe(0);
    expect(store).toEqual(fixtureStore());
  });

  it('refuses a proposal that clashes with a value of the store or breaks the id form, and keeps the store', async () => {
    const { planted, texts } = plant();
    const noOne: ConversationReader = {
      id: 'no',
      family: 'test',
      async read(_c, questions) {
        return Object.fromEntries(questions.map((q) => [q.name, { yes: 0.01 }]));
      },
    };
    const proposals: ConditionProposal[] = [
      { variable: { id: 'channel', title: 'x' }, value: { id: 'email', title: 'email again' } },
      { variable: { id: 'bad id', title: 'x' }, value: { id: 'v', title: 'v' } },
    ];
    let at = 0;
    const proposer: ConditionProposer = { id: 'fixed', propose: async () => proposals[at++] };
    const { report, store } = await feedFromConditions({
      store: fixtureStore(),
      spans: planted.slice(0, 2).map((p) => p.span),
      texts,
      reader: noOne,
      proposer,
    });
    expect(report.outcomes.map((o) => o.status)).toEqual(['refused', 'refused']);
    expect(store).toEqual(fixtureStore());
  });

  it('reports a reader that throws as failed and goes on', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 1);
    let n = 0;
    const flaky: ConversationReader = {
      ...sim.reader,
      read: (clause, questions) =>
        n++ === 0 ? Promise.reject(new Error('down')) : sim.reader.read(clause, questions),
    };
    const { report } = await feedFromConditions({
      store: fixtureStore(),
      spans: planted.slice(0, 3).map((p) => p.span),
      texts,
      reader: flaky,
    });
    expect(report.failed).toBe(1);
    expect(report.outcomes[0]?.status).toBe('failed');
    expect(report.spans).toBe(3);
  });

  it('refuses two spans with one id and a variable filter that names nothing', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 1);
    const span = planted[0]?.span as ConditionSpan;
    await expect(
      feedFromConditions({ store: fixtureStore(), spans: [span, span], texts, reader: sim.reader }),
    ).rejects.toThrow(/two spans/);
    await expect(
      feedFromConditions({
        store: fixtureStore(),
        spans: [span],
        texts,
        reader: sim.reader,
        options: { variables: ['nope'] },
      }),
    ).rejects.toThrow(/no variable nope/);
  });
});

describe('feedFromConditions: recorded and replayed', () => {
  it('replays a recorded run to the same store and report with no live call', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 7);
    const recording = emptyRecording();
    const wrapped = recordConditions(recording, sim.reader, sim.proposer);
    const spans = planted.map((p) => p.span);
    const live = await feedFromConditions({
      store: fixtureStore(),
      spans,
      texts,
      reader: wrapped.reader,
      ...(wrapped.proposer ? { proposer: wrapped.proposer } : {}),
    });
    const callsAfterRecording = { ...sim.calls };
    const replayed = replayConditions(JSON.parse(JSON.stringify(recording)));
    const again = await feedFromConditions({
      store: fixtureStore(),
      spans,
      texts,
      reader: replayed.reader,
      proposer: replayed.proposer,
    });
    expect(again.store).toEqual(live.store);
    expect(again.report.outcomes).toEqual(live.report.outcomes);
    expect(sim.calls).toEqual(callsAfterRecording);
  });

  it('fails a replay when a clause was not recorded', async () => {
    const { planted, texts } = plant();
    const replayed = replayConditions(emptyRecording());
    const { report } = await feedFromConditions({
      store: fixtureStore(),
      spans: [planted[0]?.span as ConditionSpan],
      texts,
      reader: replayed.reader,
    });
    expect(report.failed).toBe(1);
    expect(report.outcomes[0]?.reason).toMatch(/no read/);
  });
});

describe('feedFromConditions: the tuned options', () => {
  const noOne: ConversationReader = {
    id: 'no',
    family: 'test',
    async read(_c, questions) {
      return Object.fromEntries(questions.map((q, i) => [q.name, { yes: i === 0 ? 0.5 : 0.04 }]));
    },
  };

  it('propose "no-yes" calls system 2 for a span with an unsure candidate, "all-no" does not', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 1);
    const span = planted[30]?.span as ConditionSpan;
    const run = (propose: 'all-no' | 'no-yes') =>
      feedFromConditions({
        store: fixtureStore(),
        spans: [span],
        texts,
        reader: noOne,
        proposer: sim.proposer,
        options: { propose },
      });
    expect((await run('all-no')).report.outcomes[0]?.status).toBe('unsure');
    expect((await run('no-yes')).report.outcomes[0]?.status).toBe('proposed');
  });

  it('newVariables false refuses a proposal under a variable the store lacks, and keeps the store', async () => {
    const { planted, texts } = plant();
    const sim = simulated(planted, 1);
    const span = planted[30]?.span as ConditionSpan;
    const { report, store } = await feedFromConditions({
      store: fixtureStore(),
      spans: [span],
      texts,
      reader: noOne,
      proposer: sim.proposer,
      options: { propose: 'no-yes', newVariables: false },
    });
    expect(report.outcomes[0]?.status).toBe('refused');
    expect(store).toEqual(fixtureStore());
  });

  it('questionText sets the wording of the question each candidate gets', async () => {
    const { planted, texts } = plant();
    const seen: string[] = [];
    const reader: ConversationReader = {
      id: 'spy',
      family: 'test',
      async read(_c, questions) {
        seen.push(...questions.map((q) => q.text));
        return Object.fromEntries(questions.map((q) => [q.name, { yes: 0.04 }]));
      },
    };
    await feedFromConditions({
      store: fixtureStore(),
      spans: [planted[0]?.span as ConditionSpan],
      texts,
      reader,
      options: { questionText: (v, x) => `Q ${v.id}/${x.id}` },
    });
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.every((t) => t.startsWith('Q '))).toBe(true);
  });
});

describe('averageReader', () => {
  it('averages the probability of yes over the wordings, and leaves a question unanswered in any wording unanswered', async () => {
    const inner: ConversationReader = {
      id: 'inner',
      family: 'test',
      async read(_c, questions) {
        return Object.fromEntries(
          questions.map((q) => [
            q.name,
            q.text === 'a' ? { yes: 0.2 } : q.name === 'x' ? undefined : { yes: 0.8 },
          ]),
        );
      },
    };
    const reader = averageReader(inner, [(q) => ({ ...q, text: 'a' }), (q) => ({ ...q, text: 'b' })]);
    const out = await reader.read('c', [
      { name: 'y', kind: 'yesno', text: 'q', yes: 'yes', no: 'no' },
      { name: 'x', kind: 'yesno', text: 'q', yes: 'yes', no: 'no' },
    ]);
    expect(out.y).toEqual({ yes: 0.5 });
    expect(out.x).toBeUndefined();
  });
});
