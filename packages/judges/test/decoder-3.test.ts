import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import { Cassette, emptyCassette, playerClient, recordingClient, requestKey } from '../src/cassette';
import type { JudgeClient } from '../src/client';
import type { JudgeRequest } from '../src/contract';
import { CRITERION_DECODER_VERSION } from '../src/criterion-ledger';
import { buildPrompt } from '../src/prompt';

const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The answer matches the reference.' },
  transcript: [{ role: 'agent', text: 'The closers are ) ] >.' }],
  inputs: [{ path: 'reference.txt', text: 'The expected closers are ) ] >.' }],
};
const ledger = (source: string, quote: string) =>
  JSON.stringify({
    checks: [
      { id: 'c', reasoning: 'The quoted reference matches.', evidence: [{ source, quote }], met: true },
    ],
  });

describe('decoder 3 preserves historical decoder identities', () => {
  it.each([
    ['input/reference.txt', 'The expected closers are ) ] >.'],
    ['transcript.0', ') ] >'],
  ])('adds grounding for %s only in decoder 3', (source, quote) => {
    const raw = ledger(source, quote);
    expect(CRITERION_DECODER_VERSION).toBe(3);
    for (const version of [1, 2] as const)
      expect(parseJudgeText(raw, { ...request, criterionDecoderVersion: version }).unparsed).toBe(true);
    const current = parseJudgeText(raw, { ...request, criterionDecoderVersion: 3 });
    expect(current.answer.outcome).toBe('pass');
    expect(current.unparsed).toBeUndefined();
    expect(parseJudgeText(raw, request)).toEqual(current);
  });

  it('keeps the version-2 ungrounded string diagnostic in version 3', () => {
    const raw = JSON.stringify({
      checks: [{ id: 'c', reasoning: '', evidence: 'Invented words', met: false }],
    });
    const v2 = parseJudgeText(raw, { ...request, criterionDecoderVersion: 2 });
    expect(v2.answer.outcome).toBe('fail');
    expect(v2.evidenceUnverified).toBe(1);
    expect(parseJudgeText(raw, request)).toEqual(v2);
  });

  it('separates decoding identities without changing model-facing bytes', () => {
    const v2: JudgeRequest = { ...request, criterionDecoderVersion: 2 };
    const v3: JudgeRequest = { ...request, criterionDecoderVersion: 3 };
    expect(requestKey(v2)).not.toBe(requestKey(v3));
    expect(requestKey(request)).toBe(requestKey(v3));
    expect(buildPrompt(v2)).toEqual(buildPrompt(v3));
    for (const client of [undefined, { cls: 'system1' as const }]) {
      const legacy: JudgeRequest = { ...request, answerContract: 'legacy' };
      expect(requestKey({ ...legacy, reasoning: 'high' }, client)).toBe(requestKey(legacy, client));
    }
  });

  it.each([2, 3] as const)(
    'records and replays decoder %s without silently upgrading it',
    async (version) => {
      const raw = ledger('input/reference.txt', 'The expected closers are ) ] >.');
      const client: JudgeClient = {
        id: 'reader',
        family: 'test',
        cls: 'system2',
        cost: 0,
        async judge(input) {
          return parseJudgeText(raw, input);
        },
      };
      const cassette = emptyCassette();
      const result = await recordingClient(client, cassette).judge({
        ...request,
        criterionDecoderVersion: version,
      });
      const decoded = Cassette.parse(JSON.parse(JSON.stringify(cassette)));
      expect(decoded.entries[0]?.criterionDecoderVersion).toBe(version);
      const replay = playerClient(decoded, client.id);
      expect(replay.criterionDecoderVersion).toBe(version);
      expect(await replay.judge(request)).toEqual(result);
      await expect(
        playerClient(decoded, client.id).judge({
          ...request,
          criterionDecoderVersion: version === 2 ? 3 : 2,
        }),
      ).rejects.toMatchObject({ code: 'cassette_miss' });
    },
  );
});
