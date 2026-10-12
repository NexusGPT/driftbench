import { describe, expect, it } from 'vitest';
import { Cassette, playerClient } from '../src/cassette';
import { CLAUDE_SETTINGS } from '../src/clients/claude-cli';
import type { JudgeRequest } from '../src/contract';
import { PROMPT_FINGERPRINT } from '../src/prompt';
import requests from './fixtures/pointwise-regression-requests.json';
import recorded from './fixtures/pointwise-regressions.cassette.json';

const cassette = Cassette.parse(recorded);
const player = playerClient(cassette, 'claude-haiku');

describe('real Haiku evidence-ledger regression recordings', () => {
  it('retains all 28 model responses under the exact recorded settings and prompt', () => {
    expect(cassette.entries).toHaveLength(28);
    expect(requests.settings).toBe(CLAUDE_SETTINGS);
    expect(requests.promptFingerprint).toBe(PROMPT_FINGERPRINT);
  });
  for (const row of requests.cases) {
    it(`${row.case_id} replays all four actual model responses, including the recorded abstention`, async () => {
      for (let repeat = 0; repeat < 4; repeat++) {
        const result = await player.judge(row.request as JudgeRequest);
        expect(result.unparsed).toBeUndefined();
        expect(result.checks).toHaveLength(1);
        // Keep the semantic failure visible. This response demands affirmative phrasing despite
        // the criterion allowing double negation; it genuinely abstains and is never edited green.
        const abstained = row.case_id === 'qa-negation-2' && repeat === 2;
        expect(result.answer.outcome).toBe(abstained ? 'inconclusive' : row.expected);
        if (abstained) {
          expect(result.checks?.[0]?.met).toBeNull();
          expect(result.answer.reasoning).toContain('double negative');
        }
      }
    });
  }
  it('records 27 correct, one inconclusive and zero wrong verdicts across 28 responses', () => {
    const ledgers = cassette.entries.map(
      (entry) => JSON.parse(entry.raw ?? '{}') as { checks: { met: boolean | null }[] },
    );
    expect(ledgers.filter((row) => row.checks.every((check) => check.met === true))).toHaveLength(27);
    expect(ledgers.filter((row) => row.checks.some((check) => check.met === null))).toHaveLength(1);
    expect(ledgers.filter((row) => row.checks.some((check) => check.met === false))).toHaveLength(0);
  });
});
