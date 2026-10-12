import { describe, expect, it } from 'vitest';
import { runtimeLoaded } from '../src/index';

describe('files a runtime loads by itself', () => {
  it('names every CLAUDE.md and CLAUDE.local.md for claude-code, and nothing for a runtime with no rule', () => {
    const loaded = runtimeLoaded('claude-code');
    expect(loaded?.('CLAUDE.md')).toBe(true);
    expect(loaded?.('./.claude/CLAUDE.md')).toBe(true);
    expect(loaded?.('docs/CLAUDE.local.md')).toBe(true);
    expect(loaded?.('.claude/skills/x/SKILL.md')).toBe(false);
    expect(loaded?.('NOTCLAUDE.md')).toBe(false);
    expect(runtimeLoaded('other')).toBeUndefined();
  });
});
