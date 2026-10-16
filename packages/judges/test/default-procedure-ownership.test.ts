import { expect, it } from 'vitest';
import type { DialectCompletionRequest, DialectTransport } from '../src/clients/transport';
import { createDefaultJudge } from '../src/default-judge';
import { runPairStage0 } from '../src/pair-stage0';

it('keeps an explicitly owned pair ledger as one read', async () => {
  const calls: DialectCompletionRequest[] = [];
  const transport: DialectTransport = {
    dialect: 'scratchpad-json',
    fingerprint: 'test',
    async complete(input) {
      calls.push(input);
      return {
        text: '{"items":[{"name":"x","first":4,"second":0,"reasoning":"x","evidence":null}]}',
        raw: '',
        costUsd: 0,
        dialect: 'scratchpad-json',
        fingerprint: 'test',
      };
    },
  };
  const client = createDefaultJudge({ provider: 'claude-cli', model: 'test', transport });
  const result = await client.judge({
    answerContract: 'ledger',
    criterion: { name: 'x', rubric: 'x' },
    transcript: [],
    candidates: { A: 'a', B: 'b' },
    assessment: { kind: 'pairwise', items: [{ name: 'x', rubric: 'x' }] },
  });
  expect(calls).toHaveLength(1);
  expect(result.pairLedger?.items).toHaveLength(1);
});
it('does not collapse format-sensitive whitespace before judging', async () => {
  const result = await runPairStage0(
    {
      criterion: { name: 'spacing', rubric: 'Return exactly two spaces between x and y.' },
      transcript: [],
      candidates: { A: 'x y', B: 'x  y' },
    },
    { exactIdentity: true },
  );
  expect(result.choice).toBeUndefined();
});
