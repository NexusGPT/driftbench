import { describe, expect, it } from 'vitest';
import { Cassette, playerClient, requestKey } from '../src/cassette';
import { CLAUDE_SETTINGS } from '../src/clients/claude-cli';
import type { JudgeRequest } from '../src/contract';
import { buildPrompt, CRITERION_PROMPT_V1_FINGERPRINT } from '../src/prompt';
import recorded from './fixtures/multi-span.cassette.json';
import requests from './fixtures/multi-span-requests.json';
import observed from './fixtures/multi-span-results.json';

const cassette = Cassette.parse(recorded);
const player = playerClient(cassette, 'claude-haiku');

describe('real Haiku responses to the multi-span contract', () => {
  it('pins all eight actual prompts, settings, response keys and costs', () => {
    expect(cassette.entries).toHaveLength(8);
    // Recorded under prompt version 1; the player replays the cassette under the versions it records.
    expect(requests.promptFingerprint).toBe(CRITERION_PROMPT_V1_FINGERPRINT);
    expect(requests.settings).toBe(CLAUDE_SETTINGS);
    for (const row of requests.cases) {
      const v1 = { ...(row.request as JudgeRequest), criterionPromptVersion: 1 as const };
      expect(buildPrompt(v1)).toEqual(row.prompt);
      expect(cassette.entries.filter((entry) => entry.key === requestKey(v1, player))).toHaveLength(1);
    }
    expect(observed).toMatchObject({ correct: 8, n: 8, wrong: 0, inconclusive: 0 });
    expect(cassette.entries.reduce((sum, entry) => sum + (entry.cost_usd ?? 0), 0)).toBeCloseTo(
      observed.costUsd,
      10,
    );
  });
  for (const row of requests.cases) {
    it(`${row.case_id} replays the unchanged model response`, async () => {
      const result = await player.judge(row.request as JudgeRequest);
      expect(result.unparsed).toBeUndefined();
      expect(result.answer.outcome).toBe(row.expected);
      expect(result.answer.outcome).toBe(observed.rows.find((r) => r.id === row.case_id)?.outcome);
    });
  }
  it('the real threshold response contains two separately grounded entries', async () => {
    const row = requests.cases[0];
    if (!row) throw new Error('missing threshold recording');
    const result = await player.judge(row.request as JudgeRequest);
    expect(result.answer.outcome).toBe('fail');
    expect(result.checks?.[0]?.met).toBe(false);
    expect(result.checks?.[0]?.evidence).toEqual([
      { source: 'transcript.0', quote: 'Usage=32 GB. Discount threshold is strictly > 32 GB.' },
      { source: 'transcript.1', quote: 'Your usage meets the threshold, so I approve the discount.' },
    ]);
  });
});
