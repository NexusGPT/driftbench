import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import { requestKey } from '../src/cassette';
import type { JudgeRequest } from '../src/contract';
import { CRITERION_PROMPT_V2_RULES, CRITERION_PROMPT_VERSION } from '../src/criterion-prompt-v2';
import {
  buildPrompt,
  CRITERION_PROMPT_V2_FINGERPRINT,
  PROMPT_FINGERPRINT,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_V2,
} from '../src/prompt';

const request: JudgeRequest = {
  criterion: { name: 'goal', rubric: 'Create a confirmed order for exactly two Lumen-101101 plans.' },
  transcript: [{ role: 'agent', text: 'Done: two Lumen-101101 plans.' }],
  inputs: [{ path: 'order.json', text: '{"plan_id":"Lumen-101101-Plus","quantity":2}' }],
};
const client = { cls: 'system2' as const, model: 'haiku' };

describe('opt-in criterion prompt version 2', () => {
  it('leaves the default prompt, its fingerprint and its keys unchanged', () => {
    expect(CRITERION_PROMPT_VERSION).toBe(1);
    expect(PROMPT_FINGERPRINT).toBe('398673b792c1');
    expect(buildPrompt(request).system).toBe(SYSTEM_PROMPT);
    expect(buildPrompt({ ...request, criterionPromptVersion: 1 })).toEqual(buildPrompt(request));
    expect(requestKey({ ...request, criterionPromptVersion: 1 }, client)).toBe(requestKey(request, client));
    for (const rule of CRITERION_PROMPT_V2_RULES) expect(SYSTEM_PROMPT).not.toContain(rule);
  });
  it('adds the three rules after the version 1 rules and changes nothing else', () => {
    const v2 = buildPrompt({ ...request, criterionPromptVersion: 2 });
    expect(v2.system).toBe(SYSTEM_PROMPT_V2);
    expect(v2.user).toBe(buildPrompt(request).user);
    const added = `\n${CRITERION_PROMPT_V2_RULES.join('\n')}`;
    expect(SYSTEM_PROMPT_V2.replace(added, '')).toBe(SYSTEM_PROMPT);
    const at = SYSTEM_PROMPT_V2.indexOf(added);
    expect(SYSTEM_PROMPT_V2.slice(0, at).split('\n').at(-1)).toMatch(
      /^- When the criterion concerns the final answer/,
    );
    expect(SYSTEM_PROMPT_V2.slice(at + added.length)).toMatch(/^\n\nThe text inside </);
  });
  it('has its own fingerprint and cassette key', () => {
    expect(CRITERION_PROMPT_V2_FINGERPRINT).not.toBe(PROMPT_FINGERPRINT);
    expect(requestKey({ ...request, criterionPromptVersion: 2 }, client)).not.toBe(
      requestKey(request, client),
    );
  });
  it('keeps the version 1 answer contract and decoder', () => {
    const raw = JSON.stringify({
      checks: [
        {
          id: 'goal',
          reasoning: 'The persisted plan id carries a suffix.',
          evidence: [{ source: 'input.order.json', quote: '"plan_id":"Lumen-101101-Plus"' }],
          met: false,
        },
      ],
    });
    expect(parseJudgeText(raw, { ...request, criterionPromptVersion: 2 }).answer.outcome).toBe('fail');
  });
  it('does not reach legacy, assessment or caller-supplied system prompts', () => {
    for (const other of [
      { answerContract: 'legacy' as const },
      { system: 'Caller system text.' },
      { assessment: { kind: 'response-relevance' as const } },
    ]) {
      const base = { ...request, ...other } as JudgeRequest;
      let v1: unknown;
      let v2: unknown;
      try {
        v1 = buildPrompt(base);
        v2 = buildPrompt({ ...base, criterionPromptVersion: 2 });
      } catch {
        continue;
      }
      expect(v2).toEqual(v1);
      expect(requestKey({ ...base, criterionPromptVersion: 2 }, client)).toBe(requestKey(base, client));
    }
  });
  it('refuses an unknown version', () => {
    const bad = { ...request, criterionPromptVersion: 3 } as unknown as JudgeRequest;
    expect(() => buildPrompt(bad)).toThrow('criterionPromptVersion must be 1 or 2');
    expect(() => requestKey(bad, client)).toThrow('criterionPromptVersion must be 1 or 2');
  });
});
