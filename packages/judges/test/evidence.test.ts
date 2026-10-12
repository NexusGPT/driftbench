import { describe, expect, it } from 'vitest';
import { groundEvidence, type JudgeRequest } from '../src/index';

const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The reply quotes the secretword policy.' },
  transcript: [
    { role: 'user', text: 'I want Acme Fiber 1000 at my new address.' },
    { role: 'tool_call', tool: 'catalog.search', text: '{"q":"fiber"}' },
    { role: 'agent', text: 'Acme Fiber 1000 costs 45 USD a month.\nIt’s fast.' },
  ],
  artifact: 'File plan.txt\nThe monthly price is 45 USD.',
  given: { stage: 'offer' },
};
const g = (evidence: string | undefined, r = request) =>
  groundEvidence(r, { outcome: 'pass', reasoning: 'r', evidence });

describe('groundEvidence', () => {
  it('grounds an exact quote and names the first place', () => {
    expect(g('Acme Fiber 1000')).toEqual({ grounded: true, where: 'transcript.0' });
    expect(g('the monthly price is 45 USD')).toEqual({ grounded: true, where: 'artifact' });
    expect(g('stage')).toEqual({ grounded: true, where: 'given' });
  });

  it('folds case, compatibility forms, typographic quotes, white space and one pair of surrounding quotes', () => {
    expect(g('ACME   fiber\n1000').grounded).toBe(true);
    expect(g('"Acme Fiber 1000"').grounded).toBe(true);
    expect(g("It's fast").grounded).toBe(true);
    expect(g('Ａcme Fiber').grounded).toBe(true);
  });

  it('matches parts split by ... in order inside one place', () => {
    expect(g('Acme Fiber 1000 ... 45 USD')).toEqual({ grounded: true, where: 'transcript.2' });
    expect(g('45 USD ... Acme Fiber 1000').grounded).toBe(false);
  });

  it('matches on word boundaries only', () => {
    expect(g('cme Fiber').grounded).toBe(false);
    expect(g('Acme Fib').grounded).toBe(false);
  });

  it('does not ground the rubric, a tool name, nothing at all or an empty quote', () => {
    expect(g('secretword policy').grounded).toBe(false);
    expect(g('catalog.search').grounded).toBe(false);
    expect(g('invented words').grounded).toBe(false);
    for (const empty of [undefined, '', '   ', '""', '...']) expect(g(empty).grounded).toBe(false);
  });
});
