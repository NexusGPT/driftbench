import { describe, expect, it } from 'vitest';
import { agentVersionOf, blockCacheKey, cellId, type TargetRef, withAgentVersion } from '../../src/index';

const HASH = 'a'.repeat(64);
const base: TargetRef = { adapter: 'function', agent: 'acme-sales' };

describe('agentVersionOf', () => {
  it('reads the pinned prompt hash first, then the variant, else nothing', () => {
    const pinned: TargetRef = {
      ...base,
      variant: 'v2',
      prompt: { name: 'acme', version: 3, hash: HASH, text: 'Fictional prompt.' },
    };
    expect(agentVersionOf({ target: pinned })).toBe(HASH);
    expect(agentVersionOf({ target: { ...base, variant: 'v2' } })).toBe('v2');
    expect(agentVersionOf({ target: base })).toBeUndefined();
  });
});

describe('withAgentVersion', () => {
  it('writes the label as the variant, and keeps a variant the target already names', () => {
    expect(withAgentVersion(base, 'v2')).toEqual({ ...base, variant: 'v2' });
    expect(withAgentVersion({ ...base, variant: 'canary' }, 'v2')).toEqual({ ...base, variant: 'canary' });
  });

  it('returns the same target, untouched, when no version is given', () => {
    expect(withAgentVersion(base, undefined)).toBe(base);
  });
});

describe('two agent versions never share a cell or a cached block', () => {
  const cell = (target: TargetRef) => cellId({ specHash: 'spec-hash', target, mode: 'F', repeat: 0 });
  const key = (target: TargetRef) =>
    blockCacheKey({
      specHash: 'spec-hash',
      repeat: 0,
      position: 0,
      given: { ledger: {}, world: {}, vars: {}, prefix: [] } as never,
      stimulus: { user: 'Hello' },
      target,
      adapter: 'function',
      adapterVersion: '1',
    });

  it('gives a different cell id and a different block cache key per version', () => {
    const v1 = withAgentVersion(base, 'v1');
    const v2 = withAgentVersion(base, 'v2');
    expect(cell(v1)).not.toBe(cell(v2));
    expect(key(v1)).not.toBe(key(v2));
  });

  it('keeps the cell id and the cache key of a target with no version', () => {
    expect(cell(withAgentVersion(base, undefined))).toBe(cell(base));
    expect(key(withAgentVersion(base, undefined))).toBe(key(base));
  });
});
