import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { message } from '../support/assert';
import { around, closestSpan, quote, visibleText } from '../support/text';

/**
 * For a literal pattern (no regular-expression syntax), the closest span of the reply and what differs from it: the same
 * text in another case, or the number of characters that differ. Undefined for a pattern with syntax, or a reply too
 * far from it to name a span.
 */
function literalNear(text: string, source: string, strict: boolean): string | undefined {
  if (/[\\^$.*+?()[\]{}|]/.test(source)) return undefined;
  const subject = strict ? text : text.toLowerCase();
  const needle = strict ? source : source.toLowerCase();
  const span = closestSpan(subject, needle);
  if (!span) return undefined;
  const shown = text.slice(span.start, span.end);
  const differs =
    span.distance === 0
      ? 'the same text in another case'
      : `differs by ${span.distance} character${span.distance === 1 ? '' : 's'}`;
  return `closest span ${quote(shown)}, ${differs}`;
}

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
      // Default: the reply's case and its trailing punctuation marks, of any script and whatever space follows
      // them, are ignored; a run such as "..." or "?!" is ignored whole. The strict option compares them exactly.
      const subjects = strict ? [text] : [text, text.replace(/(?:\p{P}\s*)+$/u, '')];
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
        const near = literalNear(text, source, strict);
        const missing =
          name === 'must'
            ? `/${source}/ is missing; ${near === undefined ? '' : `${near}; `}${where}`
            : `/${source}/ does not match; ${where}`;
        return machineVerdict(name, id, name === 'must' ? 'fail' : 'pass', missing);
      });
    },
  };
}

export const must: Check = patternCheck('must');
export const mustNot: Check = patternCheck('must_not');
