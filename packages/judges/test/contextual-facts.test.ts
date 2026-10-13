import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { replayExperiment } from '../../../research/judge-contextual-facts/replay';
import type { JudgeRequest } from '../src/index';
import { buildPrompt, parseJudgeText, promptFingerprint, requestKey } from '../src/index';

const system = readFileSync(
  new URL('../../../research/judge-contextual-facts/candidate-system.txt', import.meta.url),
  'utf8',
);
const request: JudgeRequest = {
  criterion: { name: 'facts', rubric: 'Report every requested fact with no unsupported additions.' },
  transcript: [
    { role: 'user', text: 'Report both fictional plans and their prices.' },
    { role: 'agent', text: 'Miro costs 12 crowns, while Sola costs 15.' },
  ],
  inputs: [{ path: 'plans.txt', text: 'Miro costs 12 crowns. Sola costs 15 crowns.' }],
};

describe('experimental contextual fact fulfillment', () => {
  it('uses the existing explicit override with literal-wording and missing-fact boundaries', () => {
    const prompt = buildPrompt({ ...request, system });
    expect(prompt.system).toBe(system);
    expect(system).toContain('explicit literal-wording requirement');
    expect(system).toContain('unambiguous shared context');
    expect(system).toContain('an entity, unit or period');
    expect(system).toContain('reject contradictions, genuinely absent facts, unsupported additions');
  });

  it('partitions opted-in requests while preserving the shipped default and source text', () => {
    expect(promptFingerprint()).toBe('398673b792c1');
    expect(buildPrompt(request).system).not.toContain('For factual requirements, preserve meaning');
    expect(requestKey({ ...request, system })).not.toBe(requestKey(request));
    const prompt = buildPrompt({ ...request, system });
    expect(prompt.user).toContain(request.transcript[1]?.text);
    expect(prompt.user).toContain(request.inputs?.[0]?.text);
  });

  it('does not turn a model-reported violation into a pass', () => {
    const result = parseJudgeText(
      JSON.stringify({
        checks: [
          {
            id: 'facts',
            reasoning: 'The supplied reply fails the criterion.',
            evidence: [{ source: 'transcript.1', quote: request.transcript[1]?.text }],
            met: false,
          },
        ],
      }),
      { ...request, system },
    );
    expect(result.answer.outcome).toBe('fail');
  });

  it('replays every measured case from exact submitted prompt bytes with no live calls', () => {
    expect(replayExperiment()).toEqual({ checked: 2182, liveCalls: 0 });
  });
});
