import { describe, expect, it } from 'vitest';
import { renderHtml, renderRun } from '../src/html';
import { buildScorecard, runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

const HASH = 'a'.repeat(64);

describe('a block whose driver sent other text than the spec wrote', () => {
  const spec = { blocks: [{ when: { user: 'Hi, I want fiber.' } }, { when: { user: 'Thanks.' } }] };
  const stored = run({ blocks: [{ text: 'Sure.' }, { text: 'Bye.' }] });
  stored.blocks[0] = {
    ...stored.blocks[0],
    realized: { hash: HASH, text: 'hey, fibre at my place?' },
  } as never;
  const data = dataOf([stored], { [stored.specId]: spec as never });

  it('carries the sent text in the run detail, beside the authored one', () => {
    const detail = runDetailOf(data, stored);
    expect(detail.blocks[0]?.realized).toEqual({ hash: HASH, text: 'hey, fibre at my place?' });
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

  it('says the text was not stored when the run kept only its hash', () => {
    const hashed = structuredClone(stored);
    hashed.blocks[0] = { ...hashed.blocks[0], realized: { hash: HASH } } as never;
    const hashedData = dataOf([hashed], { [hashed.specId]: spec as never });
    for (const html of [renderRun(runDetailOf(hashedData, hashed)), renderHtml(buildScorecard(hashedData))]) {
      expect(html).toContain('User, as sent');
      expect(html).toContain(`not stored, only its hash ${HASH.slice(0, 12)}`);
      expect(html).not.toContain('hey, fibre at my place?');
    }
  });
});
