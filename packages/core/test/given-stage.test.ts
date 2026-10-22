import { type LoadResult, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

// Fictional data only.
const prefix = [
  { role: 'user', content: 'Hello.' },
  { role: 'assistant', content: 'Hi, what do you need?' },
];
const codes = (loaded: LoadResult) =>
  ((loaded as Record<string, unknown>).errors as { code: string; path: string }[]).map(
    (issue) => `${issue.code} ${issue.path}`,
  );

describe('given.stage', () => {
  it('is accepted with a prefix, for a stage the spec lists', () => {
    const loaded = validateSpec({
      id: 'stage-ok',
      stages: ['welcome', 'address'],
      blocks: [{ user: 'hi', given: { prefix, stage: 'address' }, expect: { must: ['hi'] } }],
    });
    expect(loaded.ok).toBe(true);
  });

  it('is refused without a prefix on the same block', () => {
    const loaded = validateSpec({
      id: 'stage-alone',
      stages: ['welcome', 'address'],
      blocks: [{ user: 'hi', given: { stage: 'address' }, expect: { must: ['hi'] } }],
    });
    expect(loaded.ok).toBe(false);
    expect(codes(loaded)).toEqual(['GIVEN_STAGE_WITHOUT_PREFIX blocks.0.given.stage']);
  });

  it('is refused for a stage the spec does not list', () => {
    const loaded = validateSpec({
      id: 'stage-unknown',
      stages: ['welcome', 'address'],
      blocks: [{ user: 'hi', given: { prefix, stage: 'nowhere' }, expect: { must: ['hi'] } }],
    });
    expect(loaded.ok).toBe(false);
    expect(codes(loaded)).toEqual(['STAGE_UNKNOWN blocks.0.given.stage']);
  });

  it('takes after with a stage, and refuses after alone or a malformed reference', () => {
    const ok = validateSpec({
      id: 'after-ok',
      stages: ['welcome', 'address'],
      blocks: [
        { user: 'hi', given: { prefix, stage: 'address', after: 'other#b1' }, expect: { must: ['hi'] } },
      ],
    });
    expect(ok.ok).toBe(true);
    const alone = validateSpec({
      id: 'after-alone',
      stages: ['welcome', 'address'],
      blocks: [{ user: 'hi', given: { prefix, after: 'other#b1' }, expect: { must: ['hi'] } }],
    });
    expect(alone.ok).toBe(false);
    expect(codes(alone)).toEqual(['GIVEN_AFTER_WITHOUT_STAGE blocks.0.given.after']);
    const malformed = validateSpec({
      id: 'after-bad',
      stages: ['welcome', 'address'],
      blocks: [
        { user: 'hi', given: { prefix, stage: 'address', after: 'no hash' }, expect: { must: ['hi'] } },
      ],
    });
    expect(malformed.ok).toBe(false);
  });
});
