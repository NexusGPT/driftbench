import {
  createDefaultJudge,
  emptyCassette,
  judgePairwise,
  playerClient,
  recordingClient,
} from '@agent-nexus/driftbench-judges';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DialectCompletionRequest, DialectTransport } from '../../judges/src/clients/transport';
import { defaultPairwiseClient } from '../src/commands/compare';

const criterion = { name: 'quality', rubric: 'The reply satisfies the request.' };
const ledger = (first: number, second: number) => ({
  items: [{ name: 'quality', first, second, reasoning: 'Compared the supplied replies.', evidence: null }],
});

function fixture(outputs: unknown[]) {
  const calls: DialectCompletionRequest[] = [];
  const transport: DialectTransport = {
    dialect: 'scratchpad-json',
    fingerprint: 'compare-default-test',
    async complete(request) {
      calls.push(request);
      const next = outputs.shift();
      if (next === undefined) throw new Error('Unexpected extra model call');
      return {
        text: JSON.stringify(next),
        raw: '',
        dialect: 'scratchpad-json',
        fingerprint: 'test',
        costUsd: 0.01,
      };
    },
  };
  return { calls, client: createDefaultJudge({ provider: 'claude-cli', model: 'test-model', transport }) };
}

afterEach(() => vi.unstubAllEnvs());

describe('compare uses the product default pair policy', () => {
  it.each(['openai', 'anthropic', 'google'])('selects the default policy for %s', (provider) => {
    vi.stubEnv('OPENAI_API_KEY', 'fixture-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-key');
    vi.stubEnv('GOOGLE_API_KEY', 'fixture-key');
    vi.stubEnv('OPENAI_JUDGE_MODEL', 'fixture-model');
    vi.stubEnv('ANTHROPIC_JUDGE_MODEL', 'fixture-model');
    vi.stubEnv('GOOGLE_JUDGE_MODEL', 'fixture-model');
    expect(defaultPairwiseClient(provider).judgePair).toBeTypeOf('function');
  });

  it('routes the original criterion once and lets the default policy read both orders', async () => {
    const { client, calls } = fixture([{ route: 'criterion' }, ledger(4, 0), ledger(0, 4)]);
    const result = await judgePairwise(
      client,
      criterion,
      [{ role: 'user', text: 'Give a helpful answer.' }],
      'First reply.',
      'Second reply.',
    );
    expect(result.choice).toBe('first');
    expect(result.consistent).toBe(true);
    expect(result.positionBias).toBe(false);
    expect(calls).toHaveLength(3);
    const routing = JSON.parse(calls[0]?.user ?? 'null');
    expect(routing.criterion).toEqual(criterion);
    expect(routing.questions).toEqual(['Give a helpful answer.']);
    expect((calls[1]?.user ?? '').indexOf('First reply.')).toBeLessThan(
      (calls[1]?.user ?? '').indexOf('Second reply.'),
    );
    expect((calls[2]?.user ?? '').indexOf('Second reply.')).toBeLessThan(
      (calls[2]?.user ?? '').indexOf('First reply.'),
    );
  });

  it('retains measured position disagreement even when the canonical reading resolves the winner', async () => {
    const { client, calls } = fixture([{ route: 'criterion' }, ledger(4, 0), ledger(4, 0), ledger(4, 0)]);
    const result = await judgePairwise(client, criterion, [], 'First reply.', 'Second reply.');
    expect(result.consistent).toBe(false);
    expect(result.positionBias).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it('preserves a reference on the original routed request', async () => {
    const { client, calls } = fixture([{ route: 'criterion' }, ledger(4, 0), ledger(0, 4)]);
    await judgePairwise(client, criterion, [], 'First reply.', 'Second reply.', {
      reference: 'Reference facts.',
    });
    expect(JSON.parse(calls[0]?.user ?? 'null').hasSupportingData).toBe(true);
    expect(calls[1]?.user).toContain('Reference facts.');
  });

  it('records and replays the same complete pair policy through wrappers', async () => {
    const { client, calls } = fixture([{ route: 'criterion' }, ledger(4, 0), ledger(0, 4)]);
    const cassette = emptyCassette();
    const recorded = await judgePairwise(
      recordingClient(client, cassette),
      criterion,
      [],
      'First reply.',
      'Second reply.',
    );
    const replayed = await judgePairwise(
      playerClient(cassette, client.id),
      criterion,
      [],
      'First reply.',
      'Second reply.',
    );
    expect(recorded.choice).toBe('first');
    expect(replayed).toEqual(recorded);
    expect(cassette.entries).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it('does not route an explicitly requested legacy contract', async () => {
    const { client, calls } = fixture([
      { outcome: 'pass', reasoning: 'first' },
      { outcome: 'fail', reasoning: 'second' },
    ]);
    await judgePairwise(client, criterion, [], 'First reply.', 'Second reply.', { answerContract: 'legacy' });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => !call.system.includes('Select the evaluation procedure'))).toBe(true);
  });

  it('keeps complete-pair recordings distinct from an ordinary judge call on the same input', async () => {
    const { client } = fixture([]);
    const answer = {
      raw: '',
      answer: { outcome: 'pass' as const, reasoning: 'complete pair' },
      winner: 'A' as const,
      comparison: {
        ordered: 'pass' as const,
        swapped: 'fail' as const,
        consistent: true,
        positionBias: false,
      },
    };
    const ordinary = {
      raw: '',
      answer: { outcome: 'fail' as const, reasoning: 'ordinary read' },
      winner: 'B' as const,
    };
    const cassette = emptyCassette();
    const recorded = recordingClient(
      { ...client, judge: async () => ordinary, judgePair: async () => answer },
      cassette,
    );
    const request = { criterion, transcript: [], candidates: { A: 'First reply.', B: 'Second reply.' } };
    await recorded.judge(request);
    await recorded.judgePair?.(request);
    const replayed = playerClient(cassette, client.id);
    expect((await replayed.judge(request)).answer.outcome).toBe('fail');
    expect((await replayed.judgePair?.(request))?.winner).toBe('A');
    expect(new Set(cassette.entries.map((entry) => entry.key)).size).toBe(2);
  });
});
