import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  Cassette,
  emptyCassette,
  loadCassette,
  playerClient,
  recordingClient,
  requestKey,
  saveCassette,
} from '../src/cassette';
import type { JudgeClient } from '../src/client';
import type { JudgeRequest, JudgeResult } from '../src/contract';

const interleave = vi.hoisted(() => {
  let opened = () => {};
  let written = () => {};
  const allOpened = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const firstWritten = new Promise<void>((resolve) => {
    written = resolve;
  });
  return { active: false, calls: 0, opens: 0, opened, written, allOpened, firstWritten };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (!interleave.active) return actual.writeFile(...args);
      const index = interleave.calls++;
      const [path, data, options] = args;
      // Both writers open/truncate before the large write; the small write finishes last.
      const file = await actual.open(path as string, 'w');
      if (++interleave.opens === 2) interleave.opened();
      await interleave.allOpened;
      if (index === 1) await interleave.firstWritten;
      try {
        await file.writeFile(data, options);
      } finally {
        await file.close();
        if (index === 0) interleave.written();
      }
    },
  };
});

const request: JudgeRequest = {
  criterion: { name: 'exact', rubric: 'The answer is correct.' },
  transcript: [{ role: 'agent', text: '4' }],
  answerContract: 'legacy',
};
const answer = (outcome: 'pass' | 'fail'): JudgeResult => ({
  answer: { outcome, reasoning: outcome },
  raw: JSON.stringify({ outcome, reasoning: outcome }),
  costUsd: outcome === 'pass' ? 0.01 : 0.02,
});
function at<T>(values: T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing occurrence ${index}`);
  return value;
}
function controlled() {
  const calls: { resolve: (result: JudgeResult) => void; reject: (error: Error) => void }[] = [];
  const client: JudgeClient = {
    id: 'fixture',
    family: 'fixture',
    cls: 'system2',
    cost: 1,
    judge: () => new Promise<JudgeResult>((resolve, reject) => calls.push({ resolve, reject })),
  };
  return { client, calls };
}

describe('concurrent recording occurrences', () => {
  it.each([false, true])(
    'replays identical calls in invocation order across wrappers=%s',
    async (separateWrappers) => {
      const cassette = emptyCassette();
      const { client, calls } = controlled();
      const firstRecorder = recordingClient(client, cassette);
      const secondRecorder = separateWrappers ? recordingClient(client, cassette) : firstRecorder;
      const first = firstRecorder.judge(request);
      const second = secondRecorder.judge(request);
      expect(calls).toHaveLength(2);
      at(calls, 1).resolve(answer('fail'));
      await second;
      expect(Cassette.parse(JSON.parse(JSON.stringify(cassette))).entries).toHaveLength(1);
      at(calls, 0).resolve(answer('pass'));
      const live = await Promise.all([first, second]);
      const player = playerClient(cassette, client.id);
      const replay = await Promise.all([player.judge(request), player.judge(request)]);
      expect(replay).toEqual(live);
      expect(cassette.entries.map((entry) => entry.key)).toEqual(Array(2).fill(requestKey(request, client)));
    },
  );

  it.each([0, 1])(
    'keeps a failure in occurrence %i when calls finish in reverse order',
    async (failureIndex) => {
      const cassette = emptyCassette();
      const { client, calls } = controlled();
      const recorder = recordingClient(client, cassette);
      const pending = [recorder.judge(request), recorder.judge(request)];
      const settled = Promise.allSettled(pending);
      for (const index of [1, 0]) {
        if (index === failureIndex) at(calls, index).reject(new Error(`failure-${index}`));
        else at(calls, index).resolve(answer('pass'));
        await at(pending, index).catch(() => undefined);
      }
      const live = await settled;
      const player = playerClient(cassette, client.id);
      const replay = await Promise.allSettled([player.judge(request), player.judge(request)]);
      expect(replay.map((result) => result.status)).toEqual(live.map((result) => result.status));
      expect(cassette.entries[failureIndex]?.error).toBe(`failure-${failureIndex}`);
      expect(cassette.entries[1 - failureIndex]?.error).toBeUndefined();
    },
  );

  it('exports settled calls in invocation order without holes or unresolved entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cassette-order-'));
    try {
      const path = join(directory, 'recording.json');
      const cassette = emptyCassette();
      const { client, calls } = controlled();
      const recorder = recordingClient(client, cassette);
      const first = recorder.judge(request);
      const second = recorder.judge(request);
      at(calls, 1).resolve(answer('fail'));
      await second;
      expect(() => playerClient(cassette, client.id)).toThrow('in flight');
      await expect(saveCassette(path, cassette)).rejects.toThrow('in flight');
      await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      at(calls, 0).resolve(answer('pass'));
      await first;
      await saveCassette(path, cassette);
      const loaded = await loadCassette(path);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(cassette);
      expect(loaded.entries).toHaveLength(2);
      const player = playerClient(loaded, client.id);
      expect((await player.judge(request)).answer.outcome).toBe('pass');
      expect((await player.judge(request)).answer.outcome).toBe('fail');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps concurrent same-path exports complete and leaves no temporary files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cassette-export-'));
    try {
      const path = join(directory, 'recording.json');
      const large = emptyCassette();
      const small = emptyCassette();
      large.entries.push({ judge: 'fixture', key: '0123456789ab', raw: 'x'.repeat(500_000) });
      small.entries.push({ judge: 'fixture', key: '0123456789ab', raw: 'small' });
      const allowed = [large, small].map((value) => `${JSON.stringify(value, null, 2)}\n`);
      interleave.active = true;
      try {
        await Promise.all([saveCassette(path, large), saveCassette(path, small)]);
      } finally {
        interleave.active = false;
      }
      const saved = await readFile(path, 'utf8');
      expect(allowed.includes(saved)).toBe(true);
      expect(await readdir(directory)).toEqual(['recording.json']);
      await expect(saveCassette(directory, small)).rejects.toThrow();
      expect(await readdir(directory)).toEqual(['recording.json']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
