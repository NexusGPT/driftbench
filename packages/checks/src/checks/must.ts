import { type Check, machineVerdict, type Verdict } from '@driftbench/core';
import { message } from '../support/assert';
import { around, quote, visibleText } from '../support/text';

/**
 * `must` and `must_not`: regular expressions over the customer-visible text of the block, compiled with the
 * `m` flag. One verdict per pattern; the evidence gives the matched text and its offset in the visible
 * text, or quotes the text the pattern was looked for in.
 */
function patternCheck(name: 'must' | 'must_not'): Check {
  return {
    name,
    applies: (ctx) => (ctx.expect[name]?.length ?? 0) > 0,
    evaluate(ctx) {
      const text = visibleText(ctx.observed);
      const strict = ctx.spec.rules?.match_case === true;
      // Default: the reply's case and a trailing punctuation mark are ignored. The strict option compares them exactly.
      const subjects = strict ? [text] : [text, text.replace(/[.,!?;:]+$/, '')];
      return (ctx.expect[name] ?? []).map((source, index): Verdict => {
        const id = String(index);
        let pattern: RegExp;
        try {
          pattern = new RegExp(source, strict ? 'm' : 'mi');
        } catch (cause) {
          return machineVerdict(name, id, 'fail', `/${source}/ does not compile: ${message(cause)}`);
        }
        let match: RegExpExecArray | null = null;
        let matchedIn = text;
        for (const subject of subjects) {
          match = pattern.exec(subject);
          if (match) {
            matchedIn = subject;
            break;
          }
        }
        if (match) {
          const found = `/${source}/ matched ${JSON.stringify(match[0])} at offset ${match.index}: ${around(matchedIn, match.index, match[0].length)}`;
          return machineVerdict(name, id, name === 'must' ? 'pass' : 'fail', found);
        }
        const where = text === '' ? 'the block has no visible text' : `visible text ${quote(text)}`;
        const missing =
          name === 'must' ? `/${source}/ is missing; ${where}` : `/${source}/ does not match; ${where}`;
        return machineVerdict(name, id, name === 'must' ? 'fail' : 'pass', missing);
      });
    },
  };
}

export const must: Check = patternCheck('must');
export const mustNot: Check = patternCheck('must_not');
