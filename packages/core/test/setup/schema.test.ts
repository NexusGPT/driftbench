import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_PROFILE } from '../../src/runtime-profile/claude-code';
import { parseSetupText } from '../../src/setup/schema';

const document = {
  version: 1,
  sources: [{ id: 'project', path: '.', kind: 'project' }],
  runtime: 'claude-code',
  roles: { reviewer: { aspects: ['guards'] } },
  scope: { include: ['**'], exclude: [] },
  execute: { policy: 'never', commands: [] },
  budget: { usd: 0, modelCalls: 0 },
  privacy: { model: 'deny', exports: 'metadata', exclude: [] },
};
const parse = (value: unknown) => parseSetupText(JSON.stringify(value), CLAUDE_CODE_PROFILE);

describe('declared setup schema', () => {
  it('resolves custom types through the existing loader including extends', () => {
    const result = parse({ ...document, types: { audit: { extends: 'script', locate: 'checks/*.py' } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.types.types.find((type) => type.name === 'audit')).toMatchObject({
      aspects: ['executes'], runtime: 'claude-code',
    });
    expect(result.setup.roles).toEqual(document.roles);
  });

  it.each([
    { typo: true }, { version: 2 }, { budget: { usd: -1, modelCalls: 0 } },
    { execute: { policy: 'never', commands: ['anything'] } },
    { roles: { reviewer: { aspects: ['magic'] } } },
    { scope: { include: ['../*'], exclude: [] } },
    { sources: [{ id: 'same', path: '.', kind: 'project' }, { id: 'same', path: '.', kind: 'home' }] },
    { sources: [{ id: 'home', path: '~', kind: 'home' }] },
    { runtime: 'different-runtime' },
    { types: { audit: { extends: 'missing' } } },
  ])('refuses malformed or contradictory declared data: %j', (change) => {
    expect(parse({ ...document, ...change }).ok).toBe(false);
  });

  it('keeps quoted tilde paths literal, and refuses duplicate YAML keys', () => {
    const result = parse({ ...document, sources: [{ id: 'project', path: '~/literal', kind: 'project' }] });
    expect(result.ok && result.setup.sources[0]?.path).toBe('~/literal');
    expect(parseSetupText('version: 1\nversion: 1', CLAUDE_CODE_PROFILE).ok).toBe(false);
  });
});
