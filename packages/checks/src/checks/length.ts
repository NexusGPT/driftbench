import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { visibleText } from '../support/text';

/**
 * `expect.length`: the customer-visible text of the block, counted in words and in characters, against an
 * optional minimum and maximum for each. A word is a run of non-space characters; a character is a Unicode
 * code point, so an accented letter or an emoji counts once. One verdict per bound that the block declares,
 * named `words` or `chars`, with the count and the bound in its evidence. A block with no visible text
 * counts zero of each.
 */
type Bound = { min?: number; max?: number };

function judge(id: 'words' | 'chars', unit: string, count: number, bound: Bound): Verdict {
  const range = `${bound.min ?? 0} to ${bound.max ?? 'no maximum'}`;
  const plural = count === 1 ? unit : `${unit}s`;
  if (bound.min !== undefined && count < bound.min) {
    return machineVerdict('length', id, 'fail', `${count} ${plural}, below the minimum ${bound.min}`);
  }
  if (bound.max !== undefined && count > bound.max) {
    return machineVerdict('length', id, 'fail', `${count} ${plural}, above the maximum ${bound.max}`);
  }
  return machineVerdict('length', id, 'pass', `${count} ${plural}, within ${range}`);
}

export const length: Check = {
  name: 'length',
  applies: (ctx) => ctx.expect.length !== undefined,
  evaluate(ctx) {
    const declared = ctx.expect.length;
    if (!declared) return [];
    const text = visibleText(ctx.observed);
    const words = text.split(/\s+/).filter((word) => word !== '').length;
    const chars = [...text].length;
    const verdicts: Verdict[] = [];
    if (declared.words) verdicts.push(judge('words', 'word', words, declared.words));
    if (declared.chars) verdicts.push(judge('chars', 'character', chars, declared.chars));
    return verdicts;
  },
};
