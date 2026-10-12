import { describe, expect, it } from 'vitest';
import {
  auditDecision,
  criterionVote,
  groundRequirementChecks,
  parseAudit,
  parseFailures,
  parseRequirements,
  parseWriting,
  requirementScore,
  sectionVote,
  type WritingVerdict,
  writingAudit,
  writingChunks,
  writingCriteria,
} from '../src/wp';
import { callQueue, writingRowKey } from '../src/wp-study';

describe('writing preference mechanics', () => {
  it('scores declared requirements in code and calibrates section ties', () => {
    const requirements = [
      { text: 'title', basis: 'request', hard: true },
      { text: 'coherence', basis: 'story', hard: false },
    ];
    expect(parseRequirements(JSON.stringify({ requirements }))).toEqual(requirements);
    expect(
      groundRequirementChecks('real source', [{ status: 'met', evidence: 'claim', quote: 'invented' }])?.[0]
        ?.status,
    ).toBe('missing');
    expect(
      groundRequirementChecks('real source', [{ status: 'met', evidence: 'claim', quote: 'real' }])?.[0]
        ?.status,
    ).toBe('met');
    expect(parseRequirements('{"requirements":[{"text":"x","basis":"y","hard":"true"}]}')).toBeUndefined();
    const checks = parseFailures(
      '{"checks":[{"status":"met","evidence":"title"},{"status":"partial","evidence":"weak payoff"}]}',
      2,
    );
    expect(requirementScore(requirements, checks)).toBeCloseTo(2.5 / 3);
    expect(parseFailures('{"checks":[{"status":"wrong","evidence":"x"}]}', 1)).toBeUndefined();
    expect(parseFailures('{"checks":[]}', 2)).toBeUndefined();
    const tied = JSON.stringify({ sections: [{ winner: 'A' }, { winner: 'B' }], winner: 'B' });
    expect(sectionVote(tied)).toBe('B');
    expect(sectionVote(tied, false)).toBe('tie');
    expect(sectionVote('{"sections":[{"winner":"bogus"}],"winner":"A"}')).toBe('tie');
  });
  it('uses anchored audit scores and rejects coercion or out-of-scale values', () => {
    const scores = { fulfilment: 4, coverage: 3, specificity: 3, structure: 2, constraints: 4 };
    const a = parseAudit(JSON.stringify({ scores, reason: 'evidence' }));
    const b = parseAudit(JSON.stringify({ scores: { ...scores, structure: 3 } }));
    expect(a?.scores).toEqual(scores);
    expect(auditDecision(a, b)).toBe('B');
    expect(auditDecision(b, a)).toBe('A');
    expect(auditDecision(a, a)).toBe('tie');
    expect(auditDecision(a, undefined)).toBe('tie');
    expect(parseAudit(JSON.stringify({ scores: { ...scores, fulfilment: '4' } }))).toBeUndefined();
    expect(parseAudit(JSON.stringify({ scores: { ...scores, fulfilment: 5 } }))).toBeUndefined();
    expect(writingAudit('q', 'b', 'r').user).not.toContain('reply_B');
  });
  it('never loses characters or paragraph separators during chunked reading', () => {
    const text = '一😀\n\nabcdef\n\nghijk'.repeat(7);
    const parts = writingChunks(text, 12);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(text);
    expect(writingChunks('')).toEqual(['']);
    expect(() => writingChunks(text, 0)).toThrow();
  });

  it('preserves evidence-based tie breaking and rejects missing criterion votes', () => {
    const verdict: WritingVerdict = {
      winner: 'B',
      reason: 'better ending',
      votes: {
        fulfilment: 'A',
        coverage: 'B',
        specificity: 'tie',
        structure: 'A',
        constraints: 'B',
      },
    };
    expect(criterionVote(verdict)).toBe('B');
    expect(criterionVote(verdict, false)).toBe('tie');
    expect(criterionVote({ winner: 'A', reason: '' })).toBe('tie');
    expect(parseWriting('{"winner":"unknown"}')).toBeUndefined();
    const badEvidence =
      '{"evidence":[{"axis":"coverage":"A":"developed"}],"votes":{"fulfilment":"A","coverage":"A","specificity":"A","structure":"tie","constraints":"B"},"winner":"A","reason":"grounded"}';
    expect(parseWriting(badEvidence)?.winner).toBe('A');
    expect(parseWriting(badEvidence)?.votes?.coverage).toBe('A');
    expect(parseWriting('prose winner A')).toBeUndefined();
    expect(parseWriting('{"winner":"A","votes":{"fulfilment":"B"}}')?.votes).toBeUndefined();
    expect(parseWriting(JSON.stringify(verdict))).toEqual(verdict);
  });

  it('keys repeated dataset ids by the actual pair and excludes gold labels from prompts', () => {
    const pair = { question: 'commission', a: 'alpha', b: 'beta' };
    expect(writingRowKey(pair)).not.toBe(writingRowKey({ ...pair, b: 'gamma' }));
    expect(writingRowKey(pair)).not.toBe(writingRowKey({ ...pair, a: pair.b, b: pair.a }));
    const input = { ...pair, brief: 'brief', label: 'GOLD_SENTINEL', group: 'en', id: 'PRIVATE_ID' };
    const p = writingCriteria(input);
    expect(p.user).toContain('<reply_A>\nalpha\n</reply_A>');
    expect(p.user + p.system).not.toContain('GOLD_SENTINEL');
    expect(p.user + p.system).not.toContain('PRIVATE_ID');
  });

  it('limits nested model calls to one and releases a slot after failure', async () => {
    const queue = callQueue(1);
    let active = 0;
    let max = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        queue(async () => {
          active += 1;
          max = Math.max(max, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          if (i === 2) throw new Error('probe');
          return i;
        }),
      ),
    );
    expect(max).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(9);
    expect(() => callQueue(2)).toThrow();
  });
});
