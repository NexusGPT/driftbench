import { describe, expect, it } from 'vitest';
import { renderHtml, renderRun } from '../src/html';
import { renderJunit } from '../src/junit';
import { buildScorecard, runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

describe('history normalization in reports', () => {
  for (const pass of [true, false]) {
    it(`names the wire and dropped history index on a ${pass ? 'passing' : 'failing'} block`, () => {
      const stored = run({ blocks: [{ text: 'Answer.', pass }] });
      const block = stored.blocks[0];
      if (!block) throw new Error('missing block');
      block.observed.historyNormalizations = [
        { wire: 'anthropic', historyIndex: 2, role: 'user', kind: 'omitted-empty-turn' },
        { wire: 'google', historyIndex: 4, role: 'tool', kind: 'omitted-empty-turn' },
      ];
      const data = dataOf([stored]);
      const card = buildScorecard(data);
      expect(card.drilldown[0]?.blocks[0]?.historyNormalizations).toEqual(
        block.observed.historyNormalizations,
      );
      for (const rendered of [renderHtml(card), renderRun(runDetailOf(data, stored)), renderJunit(data)]) {
        expect(rendered).toContain('anthropic wire omitted empty user turn at history index 2 (zero-based)');
        expect(rendered).toContain('google wire omitted empty tool turn at history index 4 (zero-based)');
      }
      expect(block.observed.text).toBe('Answer.');
    });
  }

  it('emits no new field or markup for a legacy observation', () => {
    const stored = run({ blocks: [{ text: 'Answer.' }] });
    const data = dataOf([stored]);
    expect(runDetailOf(data, stored).blocks[0]).not.toHaveProperty('historyNormalizations');
    expect(renderHtml(buildScorecard(data))).not.toContain('History normalization');
    expect(renderJunit(data)).not.toContain('system-out');
  });
});
