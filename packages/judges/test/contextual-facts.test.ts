import { describe, expect, it } from 'vitest';
import { buildPrompt, parseJudgeText, promptFingerprint, PROMPT_PARTS } from '../src/index';
import type { JudgeRequest } from '../src/index';

const request: JudgeRequest = {
  criterion: { name: 'facts', rubric: 'Report every requested fact with no unsupported additions.' },
  transcript: [
    { role: 'user', text: 'Report both fictional plans and their prices.' },
    { role: 'agent', text: 'Miro costs 12 crowns, while Sola costs 15.' },
  ],
  inputs: [{ path: 'plans.txt', text: 'Miro costs 12 crowns. Sola costs 15 crowns.' }],
};

describe('contextual fact fulfillment', () => {
  it('defines semantic fulfillment with shared context and explicit safety boundaries', () => {
    const { system } = buildPrompt(request);
    expect(system).toContain('Unless the criterion requires literal wording');
    expect(system).toContain('equivalent paraphrase or unambiguous shared context');
    expect(system).toContain('including an implied entity, unit or period');
    expect(system).toContain('do not infer an absent fact or excuse a contradiction');
  });

  it('changes the default fingerprint and preserves the observed text verbatim', () => {
    expect(promptFingerprint()).not.toBe('398673b792c1');
    expect(promptFingerprint(PROMPT_PARTS)).toBe(promptFingerprint());
    const { user } = buildPrompt(request);
    expect(user).toContain(request.transcript[1]!.text);
    expect(user).toContain(request.inputs![0]!.text);
  });

  it('does not turn a model-reported violation into a pass', () => {
    const result = parseJudgeText(JSON.stringify({ checks: [{
      id: 'facts', reasoning: 'The supplied reply fails the criterion.',
      evidence: [{ source: 'transcript.1', quote: request.transcript[1]!.text }], met: false,
    }] }), request);
    expect(result.answer.outcome).toBe('fail');
  });
});
