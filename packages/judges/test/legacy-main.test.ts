import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import { PROMPT_FINGERPRINT } from '../src/legacy-prompt';
import { buildPrompt } from '../src/prompt';
import golden from './fixtures/legacy-main-a97cb65e.json';

describe('legacy is the exact main a97cb65e behavior', () => {
  it('matches golden prompt bytes, including every entry separator, data guard and custom system', () => {
    expect(PROMPT_FINGERPRINT).toBe(golden.fingerprint);
    for (const row of golden.prompts) {
      expect(buildPrompt({ ...(row.request as JudgeRequest), answerContract: 'legacy' })).toEqual(row.prompt);
    }
  });
  it('matches the main parser on strict, malformed and formerly unrecoverable responses', () => {
    const request: JudgeRequest = {
      criterion: { name: 'c', rubric: 'r' },
      transcript: [],
      answerContract: 'legacy',
    };
    for (const row of golden.parses) expect(parseJudgeText(row.raw, request)).toEqual(row.result);
  });
});

it('replays all 1028 chat cassette entries with identical main outcomes, including honest_failure index 44', async () => {
  const { readFileSync } = await import('node:fs');
  const { emptyCassette, playerClient, requestKey } = await import('../src/cassette');
  const { default: expected } = await import('./fixtures/legacy-cassette-main-a97cb65e.json');
  const root = new URL('../../../', import.meta.url);
  let tested = 0;
  const files = new Map<string, ReturnType<typeof emptyCassette>>();
  for (const row of expected.entries) {
    const cassette = files.get(row.file) ?? JSON.parse(readFileSync(new URL(row.file, root), 'utf8'));
    files.set(row.file, cassette);
    const entry = cassette.entries[row.index];
    const judge = cassette.judges.find((j: { id: string }) => j.id === row.judge);
    const request: JudgeRequest = {
      criterion: { name: entry.criterion ?? 'c', rubric: 'frozen replay' },
      transcript: [],
      answerContract: 'legacy',
    };
    const one = {
      version: 1 as const,
      judges: [judge],
      entries: [{ ...entry, key: requestKey(request, judge) }],
    };
    if ('error' in row)
      await expect(playerClient(one, row.judge).judge(request)).rejects.toThrow('recorded failure');
    else {
      const result = await playerClient(one, row.judge).judge(request);
      expect(result.answer.outcome, `${row.file} entry ${row.index}`).toBe(row.outcome);
      expect(result.unparsed === true).toBe(row.unparsed);
      expect(result.repaired === true).toBe(row.repaired);
    }
    tested++;
  }
  expect(tested).toBe(1028);
});
