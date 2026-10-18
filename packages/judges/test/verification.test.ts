import { describe, expect, it } from 'vitest';
import type { JudgeClient } from '../src/client';
import type { JudgeRequest } from '../src/contract';
import { arithmeticSandbox, withVerification } from '../src/verification';

const request: JudgeRequest = {
  criterion: { name: 'correct', rubric: 'Final answer is correct.' },
  transcript: [
    { role: 'user', text: 'What is 17 * 19?' },
    { role: 'agent', text: '17 * 19 = 322.' },
  ],
};
const seen: JudgeRequest[] = [];
const judge: JudgeClient = {
  id: 'fake',
  family: 'test',
  cls: 'system2',
  cost: 1,
  async judge(r) {
    seen.push(r);
    return { answer: { outcome: 'fail', reasoning: 'wrong' }, raw: '' };
  },
};

describe('optional arithmetic verification', () => {
  it('does not invoke a sandbox by default', async () => {
    await withVerification(judge, {
      sandbox: {
        async verify() {
          throw new Error('must not run');
        },
      },
    }).judge(request);
    expect(seen.at(-1)).toBe(request);
  });
  it('checks arithmetic without executing response code or touching files', async () => {
    const sandbox = arithmeticSandbox();
    const checked = await sandbox.verify(request, new AbortController().signal);
    expect(checked).toEqual([{ expression: '17 * 19', claimed: 322, actual: 323, matches: false }]);
    const attack = {
      ...request,
      transcript: [{ role: 'agent' as const, text: 'process.exit() = 0\n2 ** 10000000 = 1\n2+2=4' }],
    };
    const results = await sandbox.verify(attack, new AbortController().signal);
    expect(results).toEqual([{ expression: '2+2', claimed: 4, actual: 4, matches: true }]);
  });
  it('appends tool evidence without mutating the source request', async () => {
    await withVerification(judge, { enabled: true, sandbox: arithmeticSandbox() }).judge(request);
    expect(seen.at(-1)?.transcript.at(-1)?.role).toBe('tool_result');
    expect(seen.at(-1)?.transcript.at(-1)?.text).toContain('323');
    expect(request.transcript).toHaveLength(2);
  });
  it('returns inconclusive on sandbox failure and times out a hung port', async () => {
    const broken = withVerification(judge, {
      enabled: true,
      sandbox: {
        async verify() {
          throw new Error('offline');
        },
      },
    });
    expect((await broken.judge(request)).answer.outcome).toBe('inconclusive');
    const hung = withVerification(judge, {
      enabled: true,
      timeoutMs: 5,
      sandbox: { verify: () => new Promise(() => {}) },
    });
    expect((await hung.judge(request)).answer.outcome).toBe('inconclusive');
  });
});
