import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import { dataKey, emptyCassette, playerClient, recordingClient, requestKey } from '../src/cassette';
import type { JudgeClient } from '../src/client';
import type { JudgeRequest, JudgeResult } from '../src/contract';
import {
  COMPARE_SYSTEM_PROMPT,
  judgePairwise,
  type PairwiseOptions,
  pairwiseRequest,
  pairwiseTally,
} from '../src/pairwise';
import { buildPrompt, CRITERION_PROMPT_V1_FINGERPRINT } from '../src/prompt';

const criterion = { name: 'correct', rubric: 'Give the correct answer.' };
const transcript = [{ role: 'user' as const, text: 'What is six times seven?' }];
const replies = ['The answer is 42.', 'The answer is 17.'] as const;
const canonical = { presentation: 'canonical' as const };
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const byContent = (a: string, b: string) => {
  const aHash = sha256(a);
  const bHash = sha256(b);
  return aHash < bHash ? -1 : aHash > bHash ? 1 : a < b ? -1 : a > b ? 1 : 0;
};
const [replyA, replyB] = [...replies].sort(byContent) as [string, string];

function clientReturning(answer: (request: JudgeRequest, call: number) => JudgeResult) {
  const requests: JudgeRequest[] = [];
  const client: JudgeClient = {
    id: 'canonical-test',
    family: 'test',
    cls: 'system2',
    cost: 0,
    async judge(request) {
      requests.push(request);
      return answer(request, requests.length);
    },
  };
  return { client, requests };
}

function named(request: JudgeRequest, winner: 'A' | 'B' | 'tie' | 'inconclusive') {
  return parseJudgeText(
    JSON.stringify({
      reasoning: 'Recorded comparison.',
      winner,
      winnerQuote: winner === 'A' || winner === 'B' ? request.candidates?.[winner] : null,
    }),
    request,
  );
}

describe('canonical pairwise presentation', () => {
  it('sorts raw candidate text by SHA256 and sends the same single presentation in either caller order', async () => {
    const { client, requests } = clientReturning((request) => named(request, 'A'));
    const forward = await judgePairwise(client, criterion, transcript, replyA, replyB, canonical);
    const reverse = await judgePairwise(client, criterion, transcript, replyB, replyA, canonical);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]).toMatchObject({ presentation: 'canonical', candidates: { A: replyA, B: replyB } });
    expect(requests[0]?.transcript.slice(-2)).toEqual([
      { role: 'context', text: `Reply A: ${replyA}` },
      { role: 'context', text: `Reply B: ${replyB}` },
    ]);
    expect(forward).toMatchObject({
      presentation: 'canonical',
      choice: 'first',
      outcome: 'pass',
      aIsFirst: true,
      calls: 1,
    });
    expect(reverse).toMatchObject({
      presentation: 'canonical',
      choice: 'second',
      outcome: 'pass',
      aIsFirst: false,
      calls: 1,
    });
  });

  it('uses deterministic content ordering when distinct strings have equal UTF-8 SHA256 hashes', async () => {
    // Lone surrogates both encode as the replacement character, without mocking the hash function.
    const low = 'reply \ud800';
    const high = 'reply \ud801';
    expect(low).not.toBe(high);
    expect(sha256(low)).toBe(sha256(high));
    const { client, requests } = clientReturning(() => ({
      raw: '',
      answer: { outcome: 'pass', reasoning: 'A' },
    }));
    await judgePairwise(client, criterion, [], high, low, canonical);
    await judgePairwise(client, criterion, [], low, high, canonical);
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.candidates)).toEqual([
      { A: low, B: high },
      { A: low, B: high },
    ]);
  });

  it.each(['pass', 'fail'] as const)('maps binary %s back to both caller positions', async (outcome) => {
    const { client } = clientReturning(() => ({ raw: '', answer: { outcome, reasoning: 'Binary client.' } }));
    const forward = await judgePairwise(client, criterion, [], replyA, replyB, canonical);
    const reverse = await judgePairwise(client, criterion, [], replyB, replyA, canonical);
    expect(forward).toMatchObject({
      choice: outcome === 'pass' ? 'first' : 'second',
      outcome,
      aIsFirst: true,
      calls: 1,
    });
    expect(reverse).toMatchObject({
      choice: outcome === 'pass' ? 'second' : 'first',
      outcome,
      aIsFirst: false,
      calls: 1,
    });
  });

  it.each(['A', 'B'] as const)(
    'maps named winner %s even when a custom client gives the opposite binary outcome',
    async (winner) => {
      const { client } = clientReturning(() => ({
        raw: '',
        winner,
        answer: { outcome: winner === 'A' ? 'fail' : 'pass', reasoning: 'Explicit winner takes precedence.' },
      }));
      const forward = await judgePairwise(client, criterion, [], replyA, replyB, canonical);
      const reverse = await judgePairwise(client, criterion, [], replyB, replyA, canonical);
      expect(forward).toMatchObject({
        choice: winner === 'A' ? 'first' : 'second',
        outcome: winner === 'A' ? 'pass' : 'fail',
        calls: 1,
      });
      expect(reverse).toMatchObject({
        choice: winner === 'A' ? 'second' : 'first',
        outcome: winner === 'A' ? 'pass' : 'fail',
        calls: 1,
      });
    },
  );

  it.each(['tie', 'inconclusive'] as const)('preserves an explicit %s', async (winner) => {
    const { client, requests } = clientReturning((request) => named(request, winner));
    const verdict = await judgePairwise(client, criterion, [], ...replies, canonical);
    expect(verdict).toMatchObject({
      choice: 'tie',
      outcome: 'inconclusive',
      presentation: 'canonical',
      calls: 1,
    });
    expect(requests).toHaveLength(1);
  });

  it('omits every two-order diagnostic because those orders were not measured', async () => {
    const { client } = clientReturning((request) => named(request, 'A'));
    const verdict = await judgePairwise(client, criterion, [], ...replies, canonical);
    for (const diagnostic of ['positionBias', 'consistent', 'swapped', 'ordered', 'recovered']) {
      expect(verdict).not.toHaveProperty(diagnostic);
    }
    expect(typeof verdict.aIsFirst).toBe('boolean');
  });

  it('returns a tie for identical replies even when a custom client always names A', async () => {
    const { client } = clientReturning(() => ({
      raw: '',
      winner: 'A',
      answer: { outcome: 'pass', reasoning: 'Always prefer A.' },
    }));
    const verdict = await judgePairwise(client, criterion, [], 'Same reply.', 'Same reply.', canonical);
    expect(verdict).toMatchObject({ choice: 'tie', outcome: 'inconclusive', presentation: 'canonical' });
    expect(typeof verdict.aIsFirst).toBe('boolean');
    expect(verdict.calls).toBeLessThanOrEqual(1);
    expect(verdict).not.toHaveProperty('positionBias');
  });

  it('propagates a client failure instead of manufacturing a tie', async () => {
    const { client, requests } = clientReturning(() => {
      throw new Error('transport down');
    });
    await expect(judgePairwise(client, criterion, [], ...replies, canonical)).rejects.toThrow(
      'transport down',
    );
    expect(requests).toHaveLength(1);
  });
});

describe('canonical options and bounded repair', () => {
  it('rejects canonical-only presentation for the pair ledger before calling the client', async () => {
    const { client, requests } = clientReturning((request) => named(request, 'tie'));
    await expect(
      judgePairwise(client, criterion, transcript, ...replies, {
        ...canonical,
        answerContract: 'ledger',
      }),
    ).rejects.toThrow('pair ledger requires both-orders presentation');
    expect(requests).toHaveLength(0);
  });

  it.each([undefined, false] as const)(
    'keeps the reference with audit=%s and never recovers a tie through a fact ledger',
    async (audit) => {
      const { client, requests } = clientReturning((request) => named(request, 'tie'));
      const verdict = await judgePairwise(client, criterion, transcript, ...replies, {
        ...canonical,
        reference: '42',
        audit,
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.transcript).toContainEqual({ role: 'context', text: 'Reference answer: 42' });
      expect(requests[0]?.assessment).toEqual({ kind: 'pairwise' });
      if (audit === false) {
        expect(requests[0]?.factAudit).toBeUndefined();
        expect(requests[0]?.system).toBe(COMPARE_SYSTEM_PROMPT);
      } else expect(requests[0]?.factAudit).toEqual({ reference: '42' });
      expect(verdict).toMatchObject({ choice: 'tie', calls: 1 });
      expect(verdict).not.toHaveProperty('recovered');
    },
  );

  it('keeps all rubric items in caller order and parses their scores in the single presentation', async () => {
    const rubricItems = [
      { name: 'fact', rubric: 'Answer correctly.', weight: 2 },
      { name: 'format', rubric: 'Use a sentence.' },
    ];
    const { client, requests } = clientReturning((request) =>
      parseJudgeText(
        JSON.stringify({
          items: rubricItems.map((item) => ({ name: item.name, a: 4, b: 0, reasoning: 'A meets it.' })),
        }),
        request,
      ),
    );
    const verdict = await judgePairwise(client, criterion, transcript, replyB, replyA, {
      ...canonical,
      reference: '42',
      rubricItems,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.assessment).toEqual({ kind: 'rubric', pairwise: true, items: rubricItems });
    const prompt = buildPrompt(requests[0] as JudgeRequest).user;
    for (const text of ['Answer correctly.', 'Use a sentence.', '42']) expect(prompt).toContain(text);
    expect(verdict).toMatchObject({ choice: 'second', outcome: 'pass', aIsFirst: false, calls: 1 });
  });

  it('re-asks one malformed answer on the same ordering and accepts the repaired winner', async () => {
    const { client, requests } = clientReturning((request, call) =>
      call === 1 ? parseJudgeText('not JSON', request) : named(request, 'B'),
    );
    const verdict = await judgePairwise(client, criterion, transcript, replyB, replyA, canonical);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.candidates).toEqual(requests[0]?.candidates);
    expect(requests[1]).toMatchObject({ budget: 'large', presentation: 'canonical' });
    expect(requests[1]?.system).toContain('Your previous answer broke the requested contract');
    expect(verdict).toMatchObject({ choice: 'first', outcome: 'fail', aIsFirst: false, calls: 2 });
  });

  it('stops at two malformed calls even with an audited reference', async () => {
    const { client, requests } = clientReturning((request) => parseJudgeText('not JSON', request));
    const verdict = await judgePairwise(client, criterion, [], ...replies, { ...canonical, reference: '42' });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.assessment?.kind === 'pairwise')).toBe(true);
    expect(verdict).toMatchObject({ choice: 'tie', outcome: 'inconclusive', calls: 2 });
    expect(verdict).not.toHaveProperty('recovered');
  });

  it('retains legacy binary parsing and its no-reask behavior', async () => {
    const { client, requests } = clientReturning((request) => parseJudgeText('not JSON', request));
    const verdict = await judgePairwise(client, criterion, [], ...replies, {
      ...canonical,
      answerContract: 'legacy',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.answerContract).toBe('legacy');
    expect(verdict).toMatchObject({ choice: 'tie', outcome: 'inconclusive', calls: 1 });
  });
});

describe('canonical cassette identity', () => {
  it('records one real parsed judgement and replays it for both caller argument orders', async () => {
    const cassette = emptyCassette();
    const { client } = clientReturning((request) => named(request, 'B'));
    const recorded = await judgePairwise(
      recordingClient(client, cassette),
      criterion,
      transcript,
      replyA,
      replyB,
      canonical,
    );
    expect(cassette.entries).toHaveLength(1);
    expect(cassette.entries[0]?.raw).toContain('"winner":"B"');
    const player = playerClient(cassette, client.id);
    const forward = await judgePairwise(player, criterion, transcript, replyA, replyB, canonical);
    const reverse = await judgePairwise(player, criterion, transcript, replyB, replyA, canonical);
    expect(forward).toEqual(recorded);
    expect(forward).toMatchObject({ choice: 'second', aIsFirst: true, outcome: 'fail', calls: 1 });
    expect(reverse).toMatchObject({ choice: 'first', aIsFirst: false, outcome: 'fail', calls: 1 });
    expect(cassette.entries).toHaveLength(1);
  });

  it.each(['ledger', 'legacy'] as const)(
    'partitions data and request keys under the %s contract, including system1',
    (answerContract) => {
      const base = { ...pairwiseRequest(criterion, transcript, replyA, replyB), answerContract };
      const single = { ...base, ...canonical };
      const both = { ...base, presentation: 'both-orders' as const };
      expect(dataKey(single)).not.toBe(dataKey(base));
      expect(dataKey(both)).toBe(dataKey(base));
      for (const cls of ['system1', 'system2'] as const) {
        expect(requestKey(single, { cls })).not.toBe(requestKey(base, { cls }));
        expect(requestKey(both, { cls })).toBe(requestKey(base, { cls }));
      }
    },
  );

  it('refuses a both-orders recording when only its matching presentation was captured', async () => {
    const cassette = emptyCassette();
    const { client } = clientReturning((request) => named(request, 'A'));
    await recordingClient(client, cassette).judge(pairwiseRequest(criterion, transcript, replyA, replyB));
    await expect(
      judgePairwise(playerClient(cassette, client.id), criterion, transcript, replyA, replyB, canonical),
    ).rejects.toMatchObject({ code: 'cassette_miss' });
  });
});

describe('default compatibility and canonical tally', () => {
  it('accepts optional forwarded options and five-argument Parameters tuples', async () => {
    const { client } = clientReturning((request) => named(request, 'tie'));
    const forwarded = (options?: PairwiseOptions) =>
      judgePairwise(client, criterion, transcript, replyA, replyB, options);
    const args: Parameters<typeof judgePairwise> = [client, criterion, transcript, replyA, replyB];
    expect(await forwarded()).toEqual(await judgePairwise(...args));
    expect(await forwarded(canonical)).toMatchObject({ presentation: 'canonical', calls: 1 });
  });

  it('preserves the pre-canonical default key and prompt fingerprint', () => {
    expect(requestKey(pairwiseRequest({ name: 'c', rubric: 'Correct.' }, [], 'one', 'two'))).toBe(
      '2516c80c92c8',
    );
    expect(CRITERION_PROMPT_V1_FINGERPRINT).toBe('398673b792c1');
  });

  it('keeps implicit and explicit both-orders requests, keys, and measured diagnostics unchanged', async () => {
    const make = () =>
      clientReturning((request) => named(request, request.candidates?.A === replyA ? 'A' : 'B'));
    const implicit = make();
    const explicit = make();
    const before = await judgePairwise(implicit.client, criterion, transcript, replyA, replyB);
    const after = await judgePairwise(explicit.client, criterion, transcript, replyA, replyB, {
      presentation: 'both-orders',
    });
    expect(after).toEqual(before);
    expect(before).toMatchObject({
      choice: 'first',
      ordered: 'pass',
      swapped: 'fail',
      consistent: true,
      positionBias: false,
      calls: 2,
    });
    expect(implicit.requests).toHaveLength(2);
    expect(explicit.requests).toHaveLength(2);
    expect(explicit.requests.map((request) => requestKey(request))).toEqual(
      implicit.requests.map((request) => requestKey(request)),
    );
    expect(explicit.requests.map(dataKey)).toEqual(implicit.requests.map(dataKey));
  });

  it('counts only explicitly inconsistent verdicts, never unmeasured canonical orders', () => {
    const tally = pairwiseTally([
      { presentation: 'canonical', choice: 'first', outcome: 'pass', aIsFirst: true, calls: 1 },
      { presentation: 'canonical', choice: 'second', outcome: 'pass', aIsFirst: false, calls: 1 },
      { presentation: 'canonical', choice: 'tie', outcome: 'inconclusive', aIsFirst: true, calls: 1 },
      { choice: 'tie', ordered: 'pass', swapped: 'pass', consistent: false, positionBias: true, calls: 2 },
      { choice: 'first', ordered: 'pass', swapped: 'fail', consistent: true, positionBias: false, calls: 2 },
    ]);
    expect(tally).toEqual({ first: 2, second: 1, tie: 2, inconsistent: 1, positionBias: 1 });
  });
});
