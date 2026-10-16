import { describe, expect, it } from 'vitest';
import { renderHtml, renderRun } from '../src/html';
import { renderJunit } from '../src/junit';
import { buildScorecard, runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

describe('history normalization in reports', () => {
  for (const pass of [true, false]) {
    it(`aggregates the rendered note but retains every JSON index on a ${pass ? 'passing' : 'failing'} block`, () => {
      const stored = run({ blocks: [{ text: 'Answer.', pass }] });
      const block = stored.blocks[0];
      if (!block) throw new Error('missing block');
      block.observed.historyNormalizations = [
        { wire: 'anthropic', historyIndex: 1, role: 'assistant', kind: 'omitted-empty-turn' },
        { wire: 'anthropic', historyIndex: 2, role: 'user', kind: 'omitted-empty-turn' },
        { wire: 'anthropic', historyIndex: 3, role: 'assistant', kind: 'omitted-empty-turn' },
        { wire: 'google', historyIndex: 4, role: 'tool', kind: 'omitted-empty-turn' },
      ];
      const data = dataOf([stored]);
      const card = buildScorecard(data);
      expect(card.drilldown[0]?.blocks[0]?.historyNormalizations).toEqual(
        block.observed.historyNormalizations,
      );
      for (const rendered of [renderHtml(card), renderRun(runDetailOf(data, stored)), renderJunit(data)]) {
        expect(rendered).toContain('3 empty turns not sent on anthropic; 1 empty turn not sent on google');
        expect(rendered).not.toContain('history index');
      }
      const runHtml = renderRun(runDetailOf(data, stored));
      expect(runHtml.match(/class="history-normalization"/g)).toHaveLength(1);
      expect(renderJunit(data).match(/block 0:/g)).toHaveLength(1);
      expect(block.observed.text).toBe('Answer.');
    });
  }

  it('escapes the wire name in every HTML view', () => {
    const stored = run({ blocks: [{ text: 'Answer.' }] });
    const block = stored.blocks[0];
    if (!block) throw new Error('missing block');
    const wire = '<img src=x onerror="alert(1)">&';
    block.observed.historyNormalizations = [
      { wire, historyIndex: 2, role: 'user', kind: 'omitted-empty-turn' },
    ];
    const data = dataOf([stored]);
    for (const html of [renderHtml(buildScorecard(data)), renderRun(runDetailOf(data, stored))]) {
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;');
      expect(html).not.toContain(wire);
    }
    expect(runDetailOf(data, stored).blocks[0]?.historyNormalizations?.[0]?.wire).toBe(wire);
  });

  it('emits no new field or markup for a legacy observation', () => {
    const stored = run({ blocks: [{ text: 'Answer.' }] });
    const data = dataOf([stored]);
    expect(runDetailOf(data, stored).blocks[0]).not.toHaveProperty('historyNormalizations');
    expect(renderHtml(buildScorecard(data))).not.toContain('class="history-normalization"');
    expect(renderJunit(data)).not.toContain('system-out');
  });
});
