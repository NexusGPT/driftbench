import { describe, expect, it } from 'vitest';
import { CRITERION_RULES, SYSTEM_PROMPT } from '../src/index';

/** The per-criterion judge rules. The test pins their wording, so an edit shows up here, not in a silent verdict change. */
describe('the per-criterion judge rules', () => {
  it('holds the three rules, in order', () => {
    expect(CRITERION_RULES).toHaveLength(3);
    expect(CRITERION_RULES[0]).toBe(
      'Judge each criterion on its own: restate it as a positive requirement, check the conversation and ' +
        'the collected evidence for that requirement alone, write the reasoning, then choose its status. The ' +
        'outcome of one criterion never decides another.',
    );
    expect(CRITERION_RULES[1]).toBe(
      'passed means the agent satisfied the requirement. A criterion phrased as a fail condition ("fail if X", ' +
        '"fail only if X", "pass unless X", "the agent must not X") passes when X did not happen and fails when X ' +
        'happened.',
    );
    expect(CRITERION_RULES[2]).toBe(
      'When the evidence to decide a criterion is not available (the conversation ended before the moment it ' +
        'depends on, or it depends on internal behavior that left no trace), mark it inconclusive and name the ' +
        'missing evidence in its reasoning instead of guessing.',
    );
  });

  it('reaches the system prompt, one bullet per rule', () => {
    for (const rule of CRITERION_RULES) {
      expect(SYSTEM_PROMPT).toContain(`- ${rule}`);
    }
  });
});
