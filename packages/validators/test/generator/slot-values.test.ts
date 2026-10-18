import { describe, expect, it } from 'vitest';
import { bankItems, type SeedData } from '../../src/ladders/generator/bank';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { type Generation, generateFrom } from '../../src/ladders/generator/measure';
import { renderMap } from '../../src/ladders/generator/render';

// Seed 3 draws no choice stage, so no phrase holds the list_options slot: its category values are said only
// at the end of a sentence ("...set to east."). The item reads them as words, and a product that never says
// a value, or says it only inside a longer word, still fails.

const item = bankItems().find((entry) => entry.id === 'phrases.slot-values');
const check = (generated: Generation) =>
  item?.check({ generated: async () => generated } as unknown as SeedData) ??
  Promise.reject(new Error('no item'));
const rewrite = (generated: Generation, edit: (text: string) => string) => {
  const out = structuredClone(generated);
  for (const { spec } of out.complete)
    for (const block of spec.blocks)
      if (block.when && 'user' in block.when) block.when.user = edit(block.when.user);
  return out;
};

describe('phrases.slot-values', () => {
  it('passes values said at the end of a sentence and fails values never said as a word', async () => {
    const hidden = hiddenSpec(3);
    const generated = await generateFrom(hidden, renderMap(hidden), 3, {}, { once: true });
    const listed = hidden.data
      .filter((value) => value.tool === 'list_options' && value.binds)
      .map((value) => String(value.value));
    expect(listed).toHaveLength(3);
    expect(await check(generated)).toMatchObject({ pass: true });
    const [first] = listed;
    if (!first) throw new Error('no list value');
    const word = new RegExp(`\\b${first}\\b`, 'g');
    // A product that never says the value.
    const silent = rewrite(generated, (text) => text.replace(word, 'that one'));
    expect(await check(silent)).toMatchObject({ pass: false, detail: expect.stringContaining(`.${first}`) });
    // A product that says it only inside a longer word.
    for (const longer of [`${first}ern`, `pre${first}`, `${first}-side`]) {
      const inside = rewrite(generated, (text) => text.replace(word, longer));
      expect(await check(inside), longer).toMatchObject({ pass: false });
    }
  }, 300000);
});
