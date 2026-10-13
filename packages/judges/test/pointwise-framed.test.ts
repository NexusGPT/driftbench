import { describe, expect, it } from 'vitest';
import { Cassette, playerClient, requestKey } from '../src/cassette';
import { CLAUDE_SETTINGS } from '../src/clients/claude-cli';
import type { JudgeRequest } from '../src/contract';
import { buildPrompt, PROMPT_FINGERPRINT } from '../src/prompt';
import recorded from './fixtures/pointwise-framed.cassette.json';
import requests from './fixtures/pointwise-framed-requests.json';
import observed from './fixtures/pointwise-framed-results.json';

const cassette = Cassette.parse(recorded);
// Preserve the previous prompt's identity rather than re-recording these observations.
const player = playerClient(cassette, 'claude-haiku', { prompt: requests.promptFingerprint });

describe('real indexed-frame Haiku regression recordings', () => {
  it('preserves all 28 actual responses with their exact prompts, settings and keys', () => {
    expect(cassette.entries).toHaveLength(28);
    expect(requests.promptFingerprint).toBe('19cf28d04b13');
    expect(requests.promptFingerprint).not.toBe(PROMPT_FINGERPRINT);
    expect(requests.settings).toBe(CLAUDE_SETTINGS);
    for (const row of requests.cases) {
      expect(buildPrompt(row.request as JudgeRequest).user).toEqual(row.prompt.user);
      const key = requestKey(row.request as JudgeRequest, player, requests.promptFingerprint);
      expect(cassette.entries.filter((entry) => entry.key === key)).toHaveLength(4);
    }
  });
  for (const row of requests.cases) {
    it(`${row.case_id} replays every observed response without changing a model judgment`, async () => {
      for (let repeat = 0; repeat < 4; repeat++) {
        const result = await player.judge(row.request as JudgeRequest);
        const live = observed.rows.find((r) => r.id === row.case_id && r.repeat === repeat);
        expect(result.answer.outcome).toBe(live?.outcome);
        expect(result.unparsed === true).toBe(live?.unparsed);
      }
    });
  }
  it('reports the real 27 correct, one unparsed and zero wrong responses', () => {
    expect(observed).toMatchObject({ correct: 27, inconclusive: 1, wrong: 0, n: 28 });
    const entry = cassette.entries.find((entry) => entry.note === 'factuality.006 framed repeat 0');
    expect(entry?.raw).toContain('Reference:');
    expect(entry?.raw).toContain('Reply:');
    // Two separately labelled quotations violate the requested single-source quote contract.
    // Preserve the actual abstention rather than constructing a passing ledger.
    expect(observed.rows.find((r) => r.id === 'factuality.006' && r.repeat === 0)?.unparsed).toBe(true);
  });
});
