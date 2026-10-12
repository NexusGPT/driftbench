import { describe, expect, it } from 'vitest';
import type { JudgeAnswer, JudgeRequest } from '../src/contract';
import { groundEvidence } from '../src/evidence';

const criterion = { name: 'resolves', rubric: 'Did the agent resolve the request?' };
const request = (over: Partial<JudgeRequest> = {}): JudgeRequest => ({
  criterion,
  transcript: [
    { role: 'user', text: 'My invoice shows a double charge from March.' },
    { role: 'tool_result', tool: 'billing.lookup', text: 'Refund issued for the duplicate charge.' },
    { role: 'agent', text: 'I have refunded the duplicate charge to your card.' },
  ],
  ...over,
});
const answer = (evidence?: string): JudgeAnswer => ({
  outcome: 'pass',
  reasoning: 'x',
  ...(evidence === undefined ? {} : { evidence }),
});

describe('groundEvidence: a quote is grounded when the data holds it', () => {
  it('names the transcript entry that holds the quote', () => {
    expect(groundEvidence(request(), answer('double charge from March'))).toEqual({
      grounded: true,
      where: 'transcript.0',
    });
  });

  it('is not grounded when the quote is absent, empty or only in the criterion', () => {
    expect(groundEvidence(request(), answer()).grounded).toBe(false);
    expect(groundEvidence(request(), answer('')).grounded).toBe(false);
    expect(groundEvidence(request(), answer('resolve the request')).grounded).toBe(false);
  });

  it('matches without case, across extra spaces, and inside one pair of quotes', () => {
    expect(groundEvidence(request(), answer('DOUBLE   CHARGE from march')).grounded).toBe(true);
    expect(groundEvidence(request(), answer('"double charge from March"')).grounded).toBe(true);
  });

  it('matches on word boundaries only', () => {
    expect(groundEvidence(request(), answer('charge from Marc')).grounded).toBe(false);
    expect(groundEvidence(request(), answer('doubl')).grounded).toBe(false);
  });

  it('finds a quote with an ellipsis when its parts appear in order in one place', () => {
    expect(groundEvidence(request(), answer('My invoice ... double charge')).where).toBe('transcript.0');
    expect(groundEvidence(request(), answer('double charge ... My invoice')).grounded).toBe(false);
  });

  it('names the artifact and the Given when the quote sits there, and never a tool name', () => {
    const inArtifact = request({ transcript: [], artifact: 'Report: total 42 euros.' });
    expect(groundEvidence(inArtifact, answer('total 42 euros'))).toEqual({
      grounded: true,
      where: 'artifact',
    });
    const inGiven = request({ transcript: [], given: { stage: 'offer', ledger: { plan: 'fiber' } } });
    expect(groundEvidence(inGiven, answer('fiber')).where).toBe('given');
    expect(groundEvidence(request(), answer('billing.lookup')).grounded).toBe(false);
  });
});
