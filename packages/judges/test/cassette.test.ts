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
  PROMPT_FINGERPRINT,
  PROMPT_PARTS,
  playerClient,
  promptFingerprint,
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
      entries: [
        { judge: 'jev-a', key: requestKey(REQUEST, { cls: 'system1' }), answer: { outcome: 'pass' } },
      ],
    };
    const result = await playerClient(cassette, 'jev-a').judge(REQUEST);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.unparsed).toBe(true);
  });

  it('replay several answers for one key in order, then repeat the last', async () => {
    const key = requestKey(REQUEST, { cls: 'system1' });
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

describe('the request key covers the prompt and the client', () => {
  it('changes with the prompt fingerprint, the model and the client settings', () => {
    const base = requestKey(REQUEST, { cls: 'system2', model: 'haiku' });
    expect(requestKey(REQUEST, { cls: 'system2', model: 'haiku' })).toBe(base);
    expect(requestKey(REQUEST, { cls: 'system2', model: 'sonnet' })).not.toBe(base);
    expect(requestKey(REQUEST, { cls: 'system2', model: 'haiku', settings: '--tools ""' })).not.toBe(base);
    const changed = promptFingerprint({
      ...PROMPT_PARTS,
      system: `${PROMPT_PARTS.system}\n- One more rule.`,
    });
    expect(changed).not.toBe(PROMPT_FINGERPRINT);
    expect(requestKey(REQUEST, { cls: 'system2', model: 'haiku' }, changed)).not.toBe(base);
  });

  it('misses the cache after a prompt change: a recording never replays under another prompt', async () => {
    const cassette = emptyCassette();
    const live = new FakeJudge('lab', [{ outcome: 'pass', reasoning: 'plain' }], {
      family: 'lab',
      cls: 'system2',
    });
    await recordingClient(live, cassette).judge(REQUEST);
    expect(await playerClient(cassette, 'lab').judge(REQUEST)).toMatchObject({ answer: { outcome: 'pass' } });
    const changed = promptFingerprint({
      ...PROMPT_PARTS,
      system: `${PROMPT_PARTS.system}\n- One more rule.`,
    });
    await expect(playerClient(cassette, 'lab', { prompt: changed }).judge(REQUEST)).rejects.toMatchObject({
      code: 'cassette_miss',
    });
  });

  it('keeps the client settings with the judge, and a recording of other settings misses', async () => {
    const cassette = emptyCassette();
    const live = Object.assign(
      new FakeJudge('cli', [{ outcome: 'fail', reasoning: 'x' }], { family: 'lab' }),
      {
        settings: 'flags-v1',
      },
    );
    await recordingClient(live, cassette).judge(REQUEST);
    expect(cassette.judges[0]).toMatchObject({ id: 'cli', settings: 'flags-v1' });
    expect((await playerClient(cassette, 'cli').judge(REQUEST)).answer.outcome).toBe('fail');
    const other: Cassette = {
      ...cassette,
      judges: [{ ...(cassette.judges[0] as Cassette['judges'][number]), settings: 'flags-v2' }],
    };
    await expect(playerClient(other, 'cli').judge(REQUEST)).rejects.toMatchObject({ code: 'cassette_miss' });
  });
});

describe('the request key and a reference answer', () => {
  const base = { criterion: { name: 'c', rubric: 'r' }, transcript: [{ role: 'user' as const, text: 'hi' }] };

  it('gives two references two keys, and none the key it had before', () => {
    const a = requestKey({ ...base, reference: 'Call Acme Care.' });
    const b = requestKey({ ...base, reference: 'Call the billing desk.' });
    expect(a).not.toBe(b);
    expect(requestKey(base)).toBe(requestKey({ ...base, reference: undefined }));
    expect(requestKey(base)).not.toBe(a);
  });
});
