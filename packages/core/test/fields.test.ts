import { Expect, RuntimeTrace, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

describe('references and subagents: the block fields and the runtime trace', () => {
  it('accepts references by path or glob and subagents by name and model, with counts', () => {
    const parsed = Expect.safeParse({
      references: [{ path: '.claude/skills/xlsx/SKILL.md', count: 1 }, { path: 'docs/**/*.md' }],
      subagents: [
        { name: 'sheet-reviewer', model: 'sonnet', count: { min: 1 } },
        { name: 'web-researcher', count: 0 },
      ],
    });
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
  });

  it('refuses an unknown key and an empty path', () => {
    expect(Expect.safeParse({ references: [{ file: 'a.md' }] }).success).toBe(false);
    expect(Expect.safeParse({ references: [{ path: '' }] }).success).toBe(false);
    expect(Expect.safeParse({ subagents: [{ name: 'x', effort: 'high' }] }).success).toBe(false);
  });

  it('carries the files read and the helpers dispatched in the runtime trace', () => {
    const parsed = RuntimeTrace.safeParse({
      references: [{ path: '.claude/skills/xlsx/SKILL.md', at: '2026-01-05T09:00:01.000Z' }],
      subagents: [
        { name: 'sheet-reviewer', model: 'sonnet', at: '2026-01-05T09:00:02.000Z' },
        { name: 'general-purpose' },
      ],
    });
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
  });

  it('flags a count range with min above max', () => {
    const loaded = validateSpec({
      id: 'fields',
      blocks: [
        {
          user: 'go',
          expect: {
            references: [{ path: 'a.md', count: { min: 2, max: 1 } }],
            subagents: [{ name: 'r', count: { min: 3, max: 1 } }],
          },
        },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.errors.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'COUNT_RANGE_INVALID blocks.0.expect.references.0.count',
      'COUNT_RANGE_INVALID blocks.0.expect.subagents.0.count',
    ]);
  });
});
