import { describe, expect, it } from 'vitest';
import { renderHtml, renderRun } from '../src/html';
import { buildScorecard, runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

describe('a block whose driver sent other text than the spec wrote', () => {
  const spec = { blocks: [{ when: { user: 'Hi, I want fiber.' } }, { when: { user: 'Thanks.' } }] };
  const stored = run({ blocks: [{ text: 'Sure.' }, { text: 'Bye.' }] });
  stored.blocks[0] = { ...stored.blocks[0], realized: { text: 'hey, fibre at my place?' } } as never;
  const data = dataOf([stored], { [stored.specId]: spec as never });

  it('carries the sent text in the run detail, beside the authored one', () => {
    const detail = runDetailOf(data, stored);
    expect(detail.blocks[0]?.realized).toBe('hey, fibre at my place?');
    expect(detail.blocks[1] && 'realized' in detail.blocks[1]).toBe(false);
  });

  it('shows both texts in the run page and in the scorecard page, and only one where they agree', () => {
    for (const html of [renderRun(runDetailOf(data, stored)), renderHtml(buildScorecard(data))]) {
      expect(html).toContain('User, as sent');
      expect(html).toContain('hey, fibre at my place?');
      expect(html).toContain('User, as written');
      expect(html.split('User, as sent').length - 1).toBe(1);
    }
  });
});
