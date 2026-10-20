import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type ConversationReader,
  FeedError,
  feedFromLogs,
  type LoggedConversation,
  NOT_SHOWN,
  privateCountsOf,
  type ReaderAnswer,
  type ReaderQuestion,
  writePrivateCounts,
} from '../../src/feed';
import { intakeLogs, parseLogs } from '../../src/intake';
import { fixtureStore, variableOf } from './support';

/**
 * The bridge from intake logs to the variable store. Every conversation here is fictional. A reader that looks
 * for a keyword stands in for the model, so what it was shown is exact and can be asserted.
 */

type Seen = { question: string; text: string };

const KEYWORDS: Record<string, string[]> = {
  first_time: ['never used'],
  returning: ['regular'],
  calm: ['no rush'],
  upset: ['furious'],
};

/** Answers from a keyword; says none of these when no value is named. Records what it saw. */
function keywordReader(seen: Seen[]): ConversationReader {
  return {
    id: 'keyword',
    family: 'test',
    async read(text, questions) {
      const out: Record<string, ReaderAnswer | undefined> = {};
      for (const question of questions) {
        seen.push({ question: question.name, text });
        out[question.name] = answerOf(question, text);
      }
      return out;
    },
  };
}

function answerOf(question: ReaderQuestion, text: string): ReaderAnswer {
  const has = (value: string) => (KEYWORDS[value] ?? []).some((word) => text.includes(word));
  if (question.kind === 'yesno') {
    if (has(question.yes)) return { yes: 0.95 };
    if (has(question.no)) return { yes: 0.05 };
    return { yes: 0.5 };
  }
  // A choice: the option a keyword names, else "none of these".
  const named = question.options.filter((option) => has(option.id)).map((option) => option.id);
  const pick = named.length === 1 ? (named[0] as string) : NOT_SHOWN;
  const probabilities: Record<string, number> = {};
  for (const option of question.options) {
    probabilities[option.id] = option.id === pick ? 0.9 : 0.1 / (question.options.length - 1);
  }
  return { probabilities };
}

/** n conversations of three turns each; the user turns say whether the person is calm or furious. */
function logs(n: number): LoggedConversation[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `log-${i}`,
    anonymised: {
      turns: [
        { role: 'user', text: i % 2 === 0 ? 'I have never used this service.' : 'I am a regular here.' },
        { role: 'agent', text: 'Hello, how can I help?' },
        { role: 'user', text: i % 4 === 0 ? 'This is unacceptable, I am furious.' : 'Thank you, no rush.' },
      ],
    },
  }));
}

const SCOPES = { session_state: 'conversation', customer_mood: 'turn' } as const;
const ONLY = ['session_state', 'customer_mood'];

describe('feedFromLogs: the scope of a variable', () => {
  it('asks a conversation-scoped variable once per conversation, with the whole conversation', async () => {
    const seen: Seen[] = [];
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(40),
      reader: keywordReader(seen),
      scopes: SCOPES,
      options: { variables: ONLY, minDecided: 10 },
    });
    const asked = seen.filter((entry) => entry.question === 'session_state');
    expect(asked).toHaveLength(40);
    expect(asked[0]?.text).toContain('user: I have never used this service.');
    expect(asked[0]?.text).toContain('agent: Hello, how can I help?');
    expect(result.reports.conversation?.read).toBe(40);
  });

  it('asks a turn-scoped variable once per user turn, with that turn alone', async () => {
    const seen: Seen[] = [];
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(40),
      reader: keywordReader(seen),
      scopes: SCOPES,
      options: { variables: ONLY, minDecided: 10 },
    });
    const asked = seen.filter((entry) => entry.question === 'customer_mood');
    // Two user turns in each of 40 conversations; the agent turns are not asked.
    expect(asked).toHaveLength(80);
    expect(asked.every((entry) => !entry.text.includes('agent:') && !entry.text.includes('Hello'))).toBe(
      true,
    );
    expect(asked.some((entry) => entry.text === 'This is unacceptable, I am furious.')).toBe(true);
    expect(result.reports.turn?.read).toBe(80);
  });

  it('reads agent turns too when asked to', async () => {
    const seen: Seen[] = [];
    await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(10),
      reader: keywordReader(seen),
      scopes: { customer_mood: 'turn' },
      turnRoles: ['user', 'agent'],
      options: { variables: ['customer_mood'], minDecided: 5 },
    });
    expect(seen.filter((entry) => entry.question === 'customer_mood')).toHaveLength(30);
  });

  it('puts a variable with no declared scope per conversation', async () => {
    const seen: Seen[] = [];
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(30),
      reader: keywordReader(seen),
      options: { variables: ['customer_mood'], minDecided: 10 },
    });
    expect(seen).toHaveLength(30);
    expect(result.reports.turn).toBeUndefined();
    expect(result.reports.conversation?.variables.map((v) => v.id)).toEqual(['customer_mood']);
  });

  it('fills the weights of both groups into one store, each with the count it read', async () => {
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(40),
      reader: keywordReader([]),
      scopes: SCOPES,
      options: { variables: ONLY, minDecided: 10 },
    });
    const state = variableOf(result.store, 'session_state');
    const mood = variableOf(result.store, 'customer_mood');
    expect(state.values.map((v) => v.weight)).toEqual([0.5, 0.5]);
    // 80 user turns are read; only the second turn of a conversation names a mood: 30 calm, 10 furious.
    // The first turns are unsure and count in no share.
    expect(mood.values.map((v) => v.weight)).toEqual([0.75, 0.25]);
    const totals = (id: string) =>
      variableOf(result.store, id)
        .values.flatMap((v) => v.provenance ?? [])
        .filter((p) => p.kind === 'conversations')
        .map((p) => (p.kind === 'conversations' ? p.total : 0));
    expect(new Set(totals('session_state'))).toEqual(new Set([40]));
    expect(new Set(totals('customer_mood'))).toEqual(new Set([80]));
  });

  it('refuses a scope for a variable the store does not have, and a scope that is not one', async () => {
    const base = { store: fixtureStore(), conversations: logs(5), reader: keywordReader([]) };
    await expect(feedFromLogs({ ...base, scopes: { nothing_here: 'turn' } })).rejects.toThrow(FeedError);
    await expect(
      feedFromLogs({ ...base, scopes: { customer_mood: 'sentence' as unknown as 'turn' } }),
    ).rejects.toThrow(FeedError);
  });

  it('refuses a set with nothing to read in a group', async () => {
    const agentOnly: LoggedConversation[] = [
      { id: 'a', anonymised: { turns: [{ role: 'agent', text: 'Hello.' }] } },
    ];
    await expect(
      feedFromLogs({
        store: fixtureStore(),
        conversations: agentOnly,
        reader: keywordReader([]),
        scopes: { customer_mood: 'turn' },
        options: { variables: ['customer_mood'] },
      }),
    ).rejects.toThrow(FeedError);
  });

  it('leaves the input store untouched', async () => {
    const store = fixtureStore();
    const before = JSON.stringify(store);
    await feedFromLogs({
      store,
      conversations: logs(30),
      reader: keywordReader([]),
      scopes: SCOPES,
      options: { variables: ONLY, minDecided: 10 },
    });
    expect(JSON.stringify(store)).toBe(before);
  });
});

/** The fixture store with the scopes written in it, as an owner writes them. */
function scoped(scopes: Record<string, 'turn' | 'conversation'>) {
  const store = structuredClone(fixtureStore());
  for (const variable of store.variables) {
    const scope = scopes[variable.id];
    if (scope) variable.scope = scope;
  }
  return store;
}

describe('feedFromLogs: the store declares the scope', () => {
  it('reads a variable the store marks turn once per user turn, with no scopes given', async () => {
    const seen: Seen[] = [];
    const result = await feedFromLogs({
      store: scoped({ customer_mood: 'turn' }),
      conversations: logs(40),
      reader: keywordReader(seen),
      options: { variables: ONLY, minDecided: 10 },
    });
    expect(seen.filter((entry) => entry.question === 'customer_mood')).toHaveLength(80);
    expect(seen.filter((entry) => entry.question === 'session_state')).toHaveLength(40);
    expect(result.reports.turn?.variables.map((v) => v.id)).toEqual(['customer_mood']);
    expect(result.overrides).toEqual([]);
  });

  it('lets the call override the store, and reports each override it used', async () => {
    const seen: Seen[] = [];
    const result = await feedFromLogs({
      store: scoped({ customer_mood: 'turn' }),
      conversations: logs(40),
      reader: keywordReader(seen),
      scopes: { customer_mood: 'conversation' },
      options: { variables: ONLY, minDecided: 10 },
    });
    expect(seen.filter((entry) => entry.question === 'customer_mood')).toHaveLength(40);
    expect(result.overrides).toEqual([{ variable: 'customer_mood', declared: 'turn', used: 'conversation' }]);
  });

  it('reports an override of a variable that states no scope against the default', async () => {
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(40),
      reader: keywordReader([]),
      scopes: { customer_mood: 'turn' },
      options: { variables: ONLY, minDecided: 10 },
    });
    expect(result.overrides).toEqual([{ variable: 'customer_mood', declared: 'conversation', used: 'turn' }]);
  });

  it('reports nothing when the call only repeats what the store declares', async () => {
    const result = await feedFromLogs({
      store: scoped({ customer_mood: 'turn' }),
      conversations: logs(40),
      reader: keywordReader([]),
      scopes: { customer_mood: 'turn', session_state: 'conversation' },
      options: { variables: ONLY, minDecided: 10 },
    });
    expect(result.overrides).toEqual([]);
  });
});

describe('feedFromLogs: the calibration of each group', () => {
  it('corrects a turn-scoped variable with turn calibration items and a conversation-scoped one with conversation items', async () => {
    const calibration = {
      turn: [
        ...Array.from({ length: 12 }, () => ({
          text: 'Thank you, no rush.',
          truth: { customer_mood: 'calm' },
        })),
        ...Array.from({ length: 12 }, () => ({ text: 'I am furious.', truth: { customer_mood: 'upset' } })),
      ],
    };
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(40),
      reader: keywordReader([]),
      scopes: SCOPES,
      calibration,
      options: { variables: ONLY, minDecided: 10 },
    });
    expect(result.reports.turn?.variables[0]?.corrected).toBe(true);
    expect(result.reports.conversation?.variables[0]?.corrected).toBe(false);
  });
});

describe('feedFromLogs: the prior of the store names every group it read', () => {
  it('names both groups, their counts with their units and their set hashes, after a two-scope feed', async () => {
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(40),
      reader: keywordReader([]),
      scopes: SCOPES,
      options: { variables: ONLY, minDecided: 10 },
    });
    const prior = result.store.prior;
    expect(prior.kind).toBe('fitted');
    const source = prior.kind === 'fitted' ? prior.source : '';
    expect(source).toContain('session_state');
    expect(source).toContain('customer_mood');
    expect(source).toContain('40 past conversations');
    expect(source).toContain('80 turns');
    expect(source).not.toContain('80 past conversations');
    expect(source).toContain((result.reports.conversation?.set_hash ?? '?').slice(0, 12));
    expect(source).toContain((result.reports.turn?.set_hash ?? '?').slice(0, 12));
  });

  it('counts turns as turns when only a turn-scoped variable is read', async () => {
    const result = await feedFromLogs({
      store: scoped({ customer_mood: 'turn' }),
      conversations: logs(40),
      reader: keywordReader([]),
      options: { variables: ['customer_mood'], minDecided: 10 },
    });
    const prior = result.store.prior;
    const source = prior.kind === 'fitted' ? prior.source : '';
    expect(source).toContain('80 turns');
    expect(source).not.toContain('80 past conversations');
  });

  it('leaves the prior as it was when no variable was fitted', async () => {
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(5),
      reader: keywordReader([]),
      scopes: SCOPES,
      options: { variables: ONLY, minDecided: 1000 },
    });
    expect(result.store.prior).toEqual({ kind: 'declared' });
  });
});

describe('feedFromLogs: each scope takes its own calibration', () => {
  it('corrects both groups when both bring items, and not with the items of the other scope', async () => {
    const conversationItems = [
      ...Array.from({ length: 12 }, () => ({
        text: 'user: I have never used this.',
        truth: { session_state: 'first_time' },
      })),
      ...Array.from({ length: 12 }, () => ({
        text: 'user: I am a regular here.',
        truth: { session_state: 'returning' },
      })),
    ];
    const turnItems = [
      ...Array.from({ length: 12 }, () => ({
        text: 'Thank you, no rush.',
        truth: { customer_mood: 'calm' },
      })),
      ...Array.from({ length: 12 }, () => ({ text: 'I am furious.', truth: { customer_mood: 'upset' } })),
    ];
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(40),
      reader: keywordReader([]),
      scopes: SCOPES,
      calibration: { conversation: conversationItems, turn: turnItems },
      options: { variables: ONLY, minDecided: 10 },
    });
    expect(result.reports.conversation?.variables[0]).toMatchObject({
      id: 'session_state',
      corrected: true,
      calibrationItems: 24,
    });
    expect(result.reports.turn?.variables[0]).toMatchObject({
      id: 'customer_mood',
      corrected: true,
      calibrationItems: 24,
    });
  });

  it('gives a group no calibration when only the other scope brought items', async () => {
    const turnItems = [
      ...Array.from({ length: 12 }, () => ({
        text: 'Thank you, no rush.',
        truth: { customer_mood: 'calm' },
      })),
      ...Array.from({ length: 12 }, () => ({ text: 'I am furious.', truth: { customer_mood: 'upset' } })),
    ];
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: logs(40),
      reader: keywordReader([]),
      scopes: SCOPES,
      calibration: { turn: turnItems },
      options: { variables: ONLY, minDecided: 10 },
    });
    expect(result.reports.conversation?.variables[0]).toMatchObject({
      corrected: false,
      calibrationItems: 0,
    });
    expect(result.reports.turn?.variables[0]).toMatchObject({ corrected: true });
  });
});

describe('feedFromLogs: what the reader sees and what is kept', () => {
  const RAW = [
    JSON.stringify({
      id: 'maria.silva@example.org',
      turns: [
        { role: 'user', text: 'I have never used this. Write to maria.silva@example.org, I am furious.' },
        { role: 'agent', text: 'Understood.' },
        { role: 'user', text: 'Thank you, no rush.' },
      ],
    }),
    ...Array.from({ length: 24 }, (_, i) =>
      JSON.stringify({
        id: `c${i}`,
        turns: [
          {
            role: 'user',
            text: i % 2 === 0 ? 'I am a regular, so no rush.' : 'I am furious, never used this.',
          },
          { role: 'agent', text: 'Noted.' },
        ],
      }),
    ),
  ].join('\n');

  async function intake() {
    const parsed = parseLogs(RAW);
    if (!parsed.ok) throw new Error('fixture does not parse');
    const taken = await intakeLogs(parsed.conversations, { second: 'rules' });
    return taken.kept;
  }

  it('takes the output of intakeLogs and shows the reader the anonymised text, never the raw one', async () => {
    const seen: Seen[] = [];
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: await intake(),
      reader: keywordReader(seen),
      scopes: SCOPES,
      options: { variables: ONLY, minDecided: 5 },
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((entry) => entry.text.includes('maria.silva'))).toBe(false);
    expect(seen.some((entry) => entry.text.includes('[EMAIL_1]'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('maria.silva');
  });

  it('keeps counts only: the counts file of each group holds numbers and digests, no text', async () => {
    const seen: Seen[] = [];
    const result = await feedFromLogs({
      store: fixtureStore(),
      conversations: await intake(),
      reader: keywordReader(seen),
      scopes: SCOPES,
      options: { variables: ONLY, minDecided: 5 },
    });
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-feed-logs-'));
    try {
      for (const report of Object.values(result.reports)) {
        await writePrivateCounts(privateCountsOf(report), { dir });
      }
      const names = await readdir(dir);
      expect(names).toHaveLength(2);
      for (const name of names) {
        const text = await readFile(join(dir, name), 'utf8');
        for (const word of ['maria', 'furious', 'regular', 'EMAIL', 'Understood', 'Noted']) {
          expect(text).not.toContain(word);
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    // The store and the reports hold no conversation line either.
    const kept = JSON.stringify(result);
    for (const word of ['maria', 'Understood', 'Noted', 'Thank you']) expect(kept).not.toContain(word);
  });

  it('gives the set a different hash per group, and none that depends on the conversation ids', async () => {
    const taken = await intake();
    const run = (conversations: LoggedConversation[]) =>
      feedFromLogs({
        store: fixtureStore(),
        conversations,
        reader: keywordReader([]),
        scopes: SCOPES,
        options: { variables: ONLY, minDecided: 5 },
      });
    const a = await run(taken);
    const b = await run(taken.map((entry, i) => ({ ...entry, id: `renamed-${i}` })));
    expect(a.reports.conversation?.set_hash).not.toBe(a.reports.turn?.set_hash);
    expect(a.reports.conversation?.set_hash).toBe(b.reports.conversation?.set_hash);
    expect(a.reports.turn?.set_hash).toBe(b.reports.turn?.set_hash);
  });
});
