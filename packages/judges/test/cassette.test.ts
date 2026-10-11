import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Cassette,
  emptyCassette,
  FakeJudge,
  JudgeError,
  type JudgeRequest,
  loadCassette,
  playerClient,
  recordingClient,
  requestKey,
  saveCassette,
} from '../src/index';

const REQUEST: JudgeRequest = {
  criterion: { name: 'plain_language', rubric: 'Does the reply avoid internal codes?' },
  transcript: [{ role: 'agent', text: 'Your plan is Acme Mobile M.' }],
};

describe('cassettes', () => {
  it('key a request by what the judge reads, and by the large budget only when it is used', () => {
    const key = requestKey(REQUEST);
    expect(requestKey({ ...REQUEST, budget: 'normal' })).toBe(key);
    expect(requestKey({ ...REQUEST, budget: 'large' })).not.toBe(key);
    expect(requestKey({ ...REQUEST, transcript: [{ role: 'agent', text: 'MOB-M-2' }] })).not.toBe(key);
  });

  it('record a live answer and an unparsed one, and replay both the same way', async () => {
    const cassette = emptyCassette();
    const live = new FakeJudge(
      'lab',
      [{ outcome: 'pass', score: 0.9, reasoning: 'plain' }, 'not json at all'],
      { family: 'lab', cls: 'system2', cost: 4 },
    );
    const recorder = recordingClient(live, cassette);
    const first = await recorder.judge(REQUEST);
    const second = await recorder.judge({ ...REQUEST, budget: 'large' });
    expect(cassette.judges).toEqual([{ id: 'lab', family: 'lab', cls: 'system2', cost: 4 }]);
    expect(cassette.entries).toHaveLength(2);
    expect(cassette.entries[1]).not.toHaveProperty('answer');

    const player = playerClient(cassette, 'lab');
    expect(await player.judge(REQUEST)).toEqual(first);
    const replayed = await player.judge({ ...REQUEST, budget: 'large' });
    expect(replayed.unparsed).toBe(true);
    expect(replayed.answer).toEqual(second.answer);
  });

  it('record a failure as an error entry that replays as an error', async () => {
    const cassette = emptyCassette();
    const live = new FakeJudge('lab', [new JudgeError('http', 'answered 503')]);
    await expect(recordingClient(live, cassette).judge(REQUEST)).rejects.toThrow('503');
    await expect(playerClient(cassette, 'lab').judge(REQUEST)).rejects.toThrow('recorded failure');
  });

  it('miss loudly: a request with no recording throws, it never answers', async () => {
    const cassette: Cassette = {
      version: 1,
      judges: [{ id: 'jev-a', family: 'jev', cls: 'system1', cost: 1 }],
      entries: [],
    };
    const error = await playerClient(cassette, 'jev-a')
      .judge(REQUEST)
      .catch((cause: unknown) => cause);
    expect((error as JudgeError).code).toBe('cassette_miss');
    expect(() => playerClient(cassette, 'nobody')).toThrow('no judge "nobody"');
  });

  it('replay a hand-written entry that breaks the contract as unparsed inconclusive', async () => {
    const cassette: Cassette = {
      version: 1,
      judges: [{ id: 'jev-a', family: 'jev', cls: 'system1', cost: 1 }],
      entries: [{ judge: 'jev-a', key: requestKey(REQUEST), answer: { outcome: 'pass' } }],
    };
    const result = await playerClient(cassette, 'jev-a').judge(REQUEST);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.unparsed).toBe(true);
  });

  it('replay several answers for one key in order, then repeat the last', async () => {
    const key = requestKey(REQUEST);
    const cassette: Cassette = {
      version: 1,
      judges: [{ id: 'j', family: 'f', cls: 'system1', cost: 1 }],
      entries: [
        { judge: 'j', key, raw: '{"outcome":"fail","reasoning":"a"}' },
        { judge: 'j', key, raw: '{"outcome":"pass","reasoning":"b"}' },
      ],
    };
    const player = playerClient(cassette, 'j');
    const outcomes = [];
    for (let i = 0; i < 3; i += 1) outcomes.push((await player.judge(REQUEST)).answer.outcome);
    expect(outcomes).toEqual(['fail', 'pass', 'pass']);
  });

  it('save and load as JSON, and refuse a file that is not a cassette', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'judges-cassette-'));
    try {
      const path = join(dir, 'c.json');
      const cassette = emptyCassette();
      await recordingClient(new FakeJudge('j', [{ outcome: 'pass', reasoning: 'r' }]), cassette).judge(
        REQUEST,
      );
      await saveCassette(path, cassette);
      expect(await loadCassette(path)).toEqual(cassette);
      await saveCassette(path, { ...cassette, version: 2 } as unknown as Cassette);
      await expect(loadCassette(path)).rejects.toThrow('version');
      expect(await readFile(path, 'utf8')).toContain('"version": 2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
