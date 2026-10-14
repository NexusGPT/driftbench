import { type Check, machineVerdict } from '@agent-nexus/driftbench-core';
import { visibleText } from '../support/text';

/**
 * `expect.starts_with`: the customer-visible text, without leading space, starts with the text given. Unlike a
 * line-start pattern (`^` with the m flag), it looks only at the start of the whole reply. The evidence names
 * the first line of the reply when the start does not match.
 */
export const startsWith: Check = {
  name: 'starts_with',
  applies: (ctx) => ctx.expect.starts_with !== undefined,
  evaluate(ctx) {
    const expected = ctx.expect.starts_with;
    if (expected === undefined) return [];
    const text = visibleText(ctx.observed).trimStart();
    if (text.startsWith(expected)) {
      return [machineVerdict('starts_with', '0', 'pass', `the reply starts with "${expected}"`)];
    }
    const first = (text.split('\n')[0] ?? '').trim();
    return [
      machineVerdict(
        'starts_with',
        '0',
        'fail',
        `the reply starts with "${first}", expected it to start with "${expected}"`,
      ),
    ];
  },
};
