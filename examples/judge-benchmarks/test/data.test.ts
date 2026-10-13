import { describe, expect, it } from 'vitest';
import {
  type PairItem,
  parseJudgeBench,
  parseLongJudgeVerify,
  parseLongJudgeWp,
  parseMmEval,
  stratifiedSample,
} from '../src/data';

/** Rows in each source's published format, with fictional text. */

describe('the loaders', () => {
  it('JudgeBench: A>B and B>A become labels A and B; the source names the group', () => {
    const line = (id: string, label: string) =>
      JSON.stringify({
        pair_id: id,
        source: 'mmlu-pro-math',
        question: 'q',
        response_A: 'a',
        response_B: 'b',
        label,
      });
    const items = parseJudgeBench(`${line('1', 'A>B')}\n${line('2', 'B>A')}\n`);
    expect(items.map((i) => [i.id, i.label, i.group])).toEqual([
      ['1', 'A', 'mmlu'],
      ['2', 'B', 'mmlu'],
    ]);
    expect(() => parseJudgeBench(line('3', 'A=B'))).toThrow(/label A=B/);
  });

  it('MM-Eval: chosen and rejected become A and B in a fixed order by row; the row index is the id', () => {
    const rows = [0, 1, 2, 3, 4, 5].map((row_idx) => ({
      row_idx,
      row: { prompt: 'p', chosen: 'GOOD', rejected: 'BAD', subset: 'chat', language: 'de', id: 7 },
    }));
    const items = parseMmEval(rows);
    for (const item of items) expect(item.label === 'A' ? item.a : item.b).toBe('GOOD');
    expect(new Set(items.map((i) => i.label)).size).toBe(2);
    expect(parseMmEval(rows)).toEqual(items);
    expect(items[0]).toMatchObject({ id: '0', group: 'chat', language: 'de' });
  });

  it('LongJudgeBench wp_bench: the label is the position of the chosen model', () => {
    const line = JSON.stringify({
      id: 'w1',
      instruction: 'Write a poem.',
      responses: [
        { model: 'm1', content: 'first' },
        { model: 'm2', content: 'second' },
      ],
      ground_truth: { chosen: { model: 'm2' }, rejected: { model: 'm1' } },
      meta: { language: 'en' },
    });
    expect(parseLongJudgeWp(line)[0]).toMatchObject({ a: 'first', b: 'second', label: 'B', group: 'en' });
  });

  it('LongJudgeBench verify_bench_hard: one response and its human label', () => {
    const line = JSON.stringify({
      id: 'v1',
      instruction: 'Compute 6 times 7.',
      responses: [{ content: 'The answer is 42.' }],
      ground_truth: { gold_correct: true },
    });
    expect(parseLongJudgeVerify(line)[0]).toMatchObject({
      kind: 'point',
      response: 'The answer is 42.',
      correct: true,
    });
  });
});

describe('stratifiedSample', () => {
  const items: PairItem[] = Array.from({ length: 100 }, (_, i) => ({
    kind: 'pair',
    id: `i${i}`,
    question: 'q',
    a: 'a',
    b: 'b',
    label: 'A',
    group: i < 70 ? 'big' : 'small',
  }));

  it('keeps the groups in proportion and picks the same items for the same seed', () => {
    const sample = stratifiedSample(items, 10, 's');
    expect(sample).toHaveLength(10);
    expect(sample.filter((i) => i.group === 'big')).toHaveLength(7);
    expect(stratifiedSample(items, 10, 's')).toEqual(sample);
    expect(stratifiedSample(items, 10, 'other')).not.toEqual(sample);
    expect(stratifiedSample(items, 500)).toHaveLength(100);
  });
});
