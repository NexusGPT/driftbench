import { describe, expect, it } from 'vitest';
import { parseDecision, parseRating } from '../src/wp-annotator';
import { alignedBlockView, paragraphs, segmentsForBlock } from '../src/wp-segments';

// Fictional drafts; no benchmark rows.
const english = [
  'The lighthouse keeper Mara counted ships every dawn.',
  'A budget table follows: lamp oil 40 coins, rope 12 coins, total 52 coins.',
  'At dusk the storm broke the northern window and Mara climbed the stairs.',
].join('\n\n');
const chinese = ['小镇的面包师每天清晨烤面包。', '预算分配：面粉三百元，燃料一百元，合计四百元。', '冬天来了，河面结冰。'].join(
  '\n\n',
);

describe('segmentsForBlock', () => {
  it('finds the English paragraph that answers a budget block', () => {
    const segs = segmentsForBlock('a clear budget table with a total', english, 1, 1);
    expect(segs.map((s) => s.index)).toEqual([1]);
  });
  it('finds the Chinese paragraph that answers a budget block', () => {
    const segs = segmentsForBlock('给出预算分配和合计', chinese, 1, 1);
    expect(segs.map((s) => s.index)).toEqual([1]);
  });
  it('returns segments in reading order and never more than k', () => {
    const segs = segmentsForBlock('Mara storm stairs ships dawn', english, 2, 1);
    expect(segs.length).toBe(2);
    expect(segs[0]!.index).toBeLessThan(segs[1]!.index);
  });
  it('groups short paragraphs and keeps every character', () => {
    const groups = paragraphs(english, 10_000);
    expect(groups.length).toBe(1);
    expect(groups[0]!.replace(/\s/g, '')).toBe(english.replace(/\s/g, ''));
  });
  it('labels both drafts for a narrow judge', () => {
    const view = alignedBlockView('budget total', english, chinese, 1, 1);
    expect(view).toContain('<response_A paragraph_group="2">');
    expect(view).toContain('<response_B');
  });
});

describe('annotator parsers', () => {
  it('reads a level and placement and refuses out-of-range values', () => {
    expect(parseRating('{"level":2,"placement":1}')?.score).toBe(7);
    expect(parseRating('{"level":4,"placement":1}')).toBeUndefined();
    expect(parseRating('{"level":2}')).toBeUndefined();
  });
  it('reads only an explicit winner', () => {
    expect(parseDecision('{"reason":"x","winner":"B"}')).toBe('B');
    expect(parseDecision('B is better')).toBeUndefined();
  });
});
