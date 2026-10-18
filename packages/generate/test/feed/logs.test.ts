import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type ConversationReader,
  FeedError,
  feedFromLogs,
  type LoggedConversation,
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

/** Answers a yes or no question from a keyword; says unsure when neither value is named. Records what it saw. */
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
  if (question.kind !== 'yesno') return { probabilities: {} };
  const has = (value: string) => (KEYWORDS[value] ?? []).some((word) => text.includes(word));
  if (has(question.yes)) return { yes: 0.95 };
  if (has(question.no)) return { yes: 0.05 };
  return { yes: 0.5 };
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
    expect(asked.every((entry) => !entry.text.includes('agent:') && !entry.text.includes('Hello'))).toBe(true);
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
    // 80 user turns: 10 furious (every 4th conversation's second turn), 70 calm.
    expect(mood.values.map((v) => v.weight)).toEqual([0.875, 0.125]);
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

describe('feedFromLogs: the calibration of each group', () => {
  it('corrects a turn-scoped variable with turn calibration items and a conversation-scoped one with conversation items', async () => {
    const calibration = {
      turn: [
        ...Array.from({ length: 12 }, () => ({ text: 'Thank you, no rush.', truth: { customer_mood: 'calm' } })),
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
          { role: 'user', text: i % 2 === 0 ? 'I am a regular, so no rush.' : 'I am furious, never used this.' },
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
