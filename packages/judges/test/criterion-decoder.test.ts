import { describe, expect, it } from 'vitest';
import { parseJudgeText, parseJudgeValue, responseSchema } from '../src/assessment';
import { emptyCassette, playerClient, recordingClient, requestKey } from '../src/cassette';
import type { JudgeClient } from '../src/client';
import type { JudgeRequest } from '../src/contract';
import { buildPrompt } from '../src/prompt';

const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The action is complete.' },
  transcript: [{ role: 'agent', text: 'The action is complete.' }],
};
const v2: JudgeRequest = { ...request, criterionDecoderVersion: 2 };
const strict: JudgeRequest = { ...request, criterionDecoderVersion: 1 };
const raw = (met: boolean | null, evidence: unknown = 'Invented quote') =>
  JSON.stringify({ checks: [{ id: 'c', reasoning: 'Observed action.', evidence, met }] });

describe('criterion decoder v2 historical compatibility', () => {
  it.each([
    [true, 'pass'],
    [false, 'fail'],
    [null, 'inconclusive'],
  ] as const)('keeps met %s when its string evidence does not ground', (met, outcome) => {
    const result = parseJudgeText(raw(met), v2);
    expect(result.unparsed).toBeUndefined();
    expect(result.answer).toEqual({ outcome, reasoning: 'The action is complete.: Observed action.' });
    expect(result.checks?.[0]).toMatchObject({ met, evidence: null, grounded: false });
    expect(result.evidenceUnverified).toBe(1);
    expect(parseJudgeValue(JSON.parse(raw(met)), v2, raw(met))).toEqual(result);
  });
  it('counts rejected strings and aggregates every original met without mutating input', () => {
    const value = {
      checks: [
        { id: 'a', reasoning: '', met: true, evidence: 'Invented A' },
        { id: 'b', reasoning: '', met: false, evidence: 'Invented B' },
        { id: 'c', reasoning: '', met: null, evidence: 'The action is complete.' },
      ],
    };
    const original = structuredClone(value);
    const result = parseJudgeValue(value, {
      ...v2,
      requirements: ['a', 'b', 'c'].map((id) => ({ id, requirement: id })),
    });
    expect(value).toEqual(original);
    expect(result.answer.outcome).toBe('fail');
    expect(result.answer.evidence).toBe('The action is complete.');
    expect(result.evidenceUnverified).toBe(2);
    expect(result.checks?.map((c) => c.met)).toEqual([true, false, null]);
  });
  it.each([null, '', [], [{ source: 'transcript.0', quote: 'Invented quote' }]])(
    'still rejects an originally absent, malformed or invalid addressed quote: %j',
    (evidence) => {
      expect(parseJudgeText(raw(true, evidence), v2).unparsed).toBe(true);
    },
  );
  it('is the default; the strict decoder stays selectable as version 1 and for existing recordings', () => {
    expect(parseJudgeText(raw(true), request)).toEqual(parseJudgeText(raw(true), v2));
    expect(parseJudgeText(raw(true), strict).unparsed).toBe(true);
  });
  it('does not change the prompt, fingerprint or provider schema', () => {
    expect(buildPrompt(strict)).toEqual(buildPrompt(request));
    expect(buildPrompt(v2)).toEqual(buildPrompt(request));
    expect(responseSchema(v2)).toEqual(responseSchema(request));
    expect(JSON.stringify(responseSchema(v2))).not.toContain('grounded');
  });
  it('keys the versions apart; version 1 keys stay unversioned', () => {
    expect(requestKey(request)).not.toBe(requestKey(v2));
    expect(requestKey(strict)).not.toBe(requestKey(request));
    for (const other of [
      { ...request, answerContract: 'legacy' as const },
      { ...request, assessment: { kind: 'pairwise' as const } },
      { ...request, assessment: { kind: 'conformance' as const, reference: 'r' } },
    ]) {
      expect(requestKey({ ...other, criterionDecoderVersion: 2 })).toBe(requestKey(other));
    }
    expect(requestKey(v2, { cls: 'system1' })).toBe(requestKey(request, { cls: 'system1' }));
  });
  it('records explicit v2 identity and replays the same nulled evidence', async () => {
    const strictCassette = emptyCassette();
    const client: JudgeClient = {
      id: 'test',
      family: 'test',
      cls: 'system2',
      cost: 0,
      async judge(r) {
        return parseJudgeText(raw(true), r);
      },
    };
    await recordingClient(client, strictCassette).judge(strict);
    expect(strictCassette.entries[0]).not.toHaveProperty('criterionDecoderVersion');
    expect(strictCassette.entries[0]?.key).toBe(requestKey(strict, client));
    const cassette = emptyCassette();
    const result = await recordingClient(client, cassette).judge(v2);
    expect(result.evidenceUnverified).toBe(1);
    expect(cassette.entries[0]?.criterionDecoderVersion).toBe(2);
    expect(await playerClient(cassette, 'test').judge(request)).toEqual(result);
    await expect(
      playerClient(cassette, 'test').judge({ ...request, criterionDecoderVersion: 1 }),
    ).rejects.toMatchObject({ code: 'cassette_miss' });
  });
  it('replays pre-versioned ledger entries strictly and refuses an explicit version change', async () => {
    const cassette = emptyCassette();
    const judge = { id: 'test', family: 'test', cls: 'system2' as const, cost: 0 };
    cassette.judges.push(judge);
    cassette.entries.push({
      judge: 'test',
      key: requestKey({ ...strict, criterionPromptVersion: 1 }, judge),
      answerContract: 'ledger',
      raw: raw(true),
    });
    const player = playerClient(cassette, 'test');
    expect((await player.judge(request)).unparsed).toBe(true);
    expect(requestKey({ ...request, criterionPromptVersion: 1 }, player)).toBe(cassette.entries[0]?.key);
    await expect(player.judge({ ...request, criterionDecoderVersion: 2 })).rejects.toMatchObject({
      code: 'cassette_miss',
    });
  });
});
