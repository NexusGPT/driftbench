import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { message } from '../support/assert';
import { around, quote, visibleText } from '../support/text';

/**
 * `expect.regex`: regular expressions over the customer-visible text, compiled with the `m` flag and no `i` flag.
 * Case is significant here, as in a regular expression by default; `must` and `must_not` ignore case instead.
 * One verdict per pattern, each pattern a must (it has to match).
 */
export const regex: Check = {
  name: 'regex',
  applies: (ctx) => (ctx.expect.regex?.length ?? 0) > 0,
  evaluate(ctx) {
    const text = visibleText(ctx.observed);
    return (ctx.expect.regex ?? []).map((source, index): Verdict => {
      const id = String(index);
      let pattern: RegExp;
      try {
        pattern = new RegExp(source, 'm');
      } catch (cause) {
        return machineVerdict('regex', id, 'fail', `/${source}/ does not compile: ${message(cause)}`);
      }
      const match = pattern.exec(text);
      if (match) {
        const found = `/${source}/ matched ${JSON.stringify(match[0])} at offset ${match.index}: ${around(text, match.index, match[0].length)}`;
        return machineVerdict('regex', id, 'pass', found);
      }
      const where = text === '' ? 'the block has no visible text' : `visible text ${quote(text)}`;
      return machineVerdict('regex', id, 'fail', `/${source}/ is missing; ${where}`);
    });
  },
};
