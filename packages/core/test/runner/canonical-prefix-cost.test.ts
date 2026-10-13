import { describe, expect, it } from 'vitest';
import { canonicalGiven, resolveCanonicalGiven, resolveGiven } from '../../src/runner/given';
import type { Message } from '../../src/schema/common';
import { validateSpec } from '../../src/spec/load';

function fixture(blocks: number) {
  const result = validateSpec({
    id: 'canonical-prefix-cost',
    blocks: Array.from({ length: blocks }, (_, index) => ({ user: `block-${index}` })),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

describe('canonical prefix snapshots', () => {
  it('copies a growing prefix only once for the public snapshot', () => {
    const spec = fixture(202);
    canonicalGiven(spec, 200);
    const iterator = Array.prototype[Symbol.iterator];
    let copiedMessages = 0;
    let next: ReturnType<typeof canonicalGiven>;
    Array.prototype[Symbol.iterator] = function (this: unknown[]) {
      if (this.length >= 400 && (this[0] as Message | undefined)?.role === 'user')
        copiedMessages += this.length;
      return iterator.call(this);
    };
    try {
      next = canonicalGiven(spec, 201);
    } finally {
      Array.prototype[Symbol.iterator] = iterator;
    }
    expect(next.prefix).toHaveLength(402);
    expect(copiedMessages).toBeLessThanOrEqual(next.prefix.length);
  });

  it('keeps caller array edits separate from the canonical cache and later snapshots', () => {
    const spec = fixture(3);
    const first = canonicalGiven(spec, 1);
    first.prefix[0] = { role: 'user', content: 'private replacement' };
    first.prefix.push({ role: 'assistant', content: 'private append' });
    const second = canonicalGiven(spec, 2);
    expect(second.prefix).toEqual([
      { role: 'user', content: 'block-0' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'block-1' },
      { role: 'assistant', content: '' },
    ]);
    expect(first.prefix).toHaveLength(3);
    second.prefix.pop();
    expect(canonicalGiven(spec, 2).prefix).toHaveLength(4);
  });

  it('retains prefix overrides and backward/repeated calls', () => {
    const spec = fixture(5);
    const override = [{ role: 'user', content: 'reset' }] satisfies Message[];
    const overridden = spec.blocks[2];
    if (!overridden) throw new Error('missing override block');
    overridden.given = { prefix: override };
    const expected = [
      ...override,
      { role: 'user', content: 'block-2' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'block-3' },
      { role: 'assistant', content: '' },
    ];
    expect(canonicalGiven(spec, 4).prefix).toEqual(expected);
    expect(canonicalGiven(spec, 1).prefix).toHaveLength(2);
    expect(canonicalGiven(spec, 4).prefix).toEqual(expected);
    expect(canonicalGiven(spec, 4).prefix).toEqual(expected);
    expect(override).toEqual([{ role: 'user', content: 'reset' }]);
  });
});

describe('resolved teacher-forced snapshots', () => {
  it('matches the public composition and isolates retained arrays', () => {
    const internal = fixture(4);
    const publicSpec = fixture(4);
    const target = { adapter: 'function', agent: 'test' };
    const retained: Message[][] = [];
    for (let block = 0; block < 4; block++) {
      const canonical = canonicalGiven(publicSpec, block);
      const expected = resolveGiven(canonical.state, canonical.prefix, target);
      const actual = resolveCanonicalGiven(internal, block, target);
      expect(actual.given).toEqual(expected);
      retained.push(actual.given.prefix);
    }
    expect(retained.map((prefix) => prefix.length)).toEqual([0, 2, 4, 6]);
    retained[1]?.push({ role: 'user', content: 'private append' });
    expect(resolveCanonicalGiven(internal, 3, target).given.prefix).toHaveLength(6);
    expect(retained[3]).toHaveLength(6);
  });
});
