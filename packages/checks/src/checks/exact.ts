import { type Check, machineVerdict } from '@agent-nexus/driftbench-core';
import { visibleText } from '../support/text';

const NAME = 'exact';

/**
 * Drops everything that is not a letter, a digit or a space, trims, and lowers case. Both sides of an exact
 * comparison pass through it.
 */
export function normaliseExact(text: string): string {
  return [...text.trim()]
    .filter((char) => /[\p{L}\p{N}\s]/u.test(char))
    .join('')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** A number a text reads as: a finite number, or true and false as 1 and 0. Undefined for prose. */
function numberOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === 'true') return 1;
  if (trimmed === 'false') return 0;
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * `expect.exact`: the visible text of the reply equals the reference. Two numbers compare as numbers, so
 * `42.0` equals `42`; anything else compares after normalising. An empty reply never equals a reference,
 * because the spec refuses an empty reference.
 */
export const exact: Check = {
  name: NAME,
  applies: (ctx) => ctx.expect.exact !== undefined,
  evaluate(ctx) {
    const reference = ctx.expect.exact;
    if (reference === undefined) return [];
    const reply = visibleText(ctx.observed);
    const replyNumber = numberOf(reply);
    const referenceNumber = numberOf(reference);
    if (replyNumber !== undefined && referenceNumber !== undefined) {
      const same = replyNumber === referenceNumber;
      return [
        machineVerdict(
          NAME,
          '0',
          same ? 'pass' : 'fail',
          same
            ? `${reply.trim()} equals ${reference.trim()} as a number`
            : `${reply.trim()} is not ${reference.trim()} as a number`,
        ),
      ];
    }
    const left = normaliseExact(reply);
    const right = normaliseExact(reference);
    const same = left !== '' && left === right;
    return [
      machineVerdict(
        NAME,
        '0',
        same ? 'pass' : 'fail',
        `"${left}" ${same ? '==' : '!='} "${right}" after normalising`,
      ),
    ];
  },
};
