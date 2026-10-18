import { describe, expect, it } from 'vitest';
import { renderRun } from '../src/html';
import { runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

describe('the run report shows the cache key of each block', () => {
  it('prints the key of a block that has one, and says so when it has none', () => {
    const key = `block:${'a'.repeat(64)}`;
    const stored = run({ blocks: [{ text: 'hi' }, { text: 'there' }] });
    stored.blocks[0] = { ...stored.blocks[0], cacheKey: key } as never;
    const html = renderRun(runDetailOf(dataOf([stored]), stored));
    expect(html).toContain(`Cache key</p><pre class="mono">${key}`);
    expect(html).toContain('Cache key</p><pre class="mono">not cached');
  });
});
